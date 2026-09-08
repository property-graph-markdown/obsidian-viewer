import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});
const exampleAreas = new Set(["events", "people", "places", "timeline", "work"]);

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const versions = JSON.parse(await readFile(path.join(root, "versions.json"), "utf8"));

if (
  manifest.version !== packageJson.version ||
  manifest.version !== packageLock.version ||
  manifest.version !== packageLock.packages?.[""]?.version ||
  versions[manifest.version] !== manifest.minAppVersion
) {
  throw new Error("Release metadata mismatch; run npm run verify for details.");
}

const assetNames = [
  "main.js",
  "manifest.json",
  "styles.css",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
];
const exampleNames = await listFiles(path.join(root, "example-vault"), "example-vault");
const conceptCount = exampleNames.filter(
  (name) => name.endsWith(".md") && name !== "example-vault/index.md",
).length;
if (exampleNames.length !== 48 || conceptCount !== 46) {
  throw new Error(
    `Expected the approved example vault to contain 48 files and 46 Concepts; found ${exampleNames.length} files and ${conceptCount} Concepts.`,
  );
}
const archiveNames = [...assetNames, ...exampleNames];
const assets = await Promise.all(
  archiveNames.map(async (name) => ({ name, data: await readFile(path.join(root, name)) })),
);
const archive = createStoredZip(assets);
const releaseDirectory = path.join(root, "release");
const archivePath = path.join(releaseDirectory, `pgm-viewer-${manifest.version}.zip`);

await mkdir(releaseDirectory, { recursive: true });
await writeFile(archivePath, archive);
console.log(`Created ${path.relative(root, archivePath)} (${archive.length} bytes)`);

async function listFiles(directory, relativeDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )) {
    const relativeName = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!isAllowedExampleDirectory(relativeName)) {
        throw new Error(`Unexpected directory in release example vault: ${relativeName}`);
      }
      names.push(...(await listFiles(path.join(directory, entry.name), relativeName)));
    } else if (entry.isFile()) {
      if (!isAllowedExampleFile(relativeName)) {
        throw new Error(`Unexpected file in release example vault: ${relativeName}`);
      }
      names.push(relativeName);
    } else {
      throw new Error(`Links and special files are not allowed in the release example vault: ${relativeName}`);
    }
  }
  return names;
}

function isAllowedExampleDirectory(relativeName) {
  const parts = relativeName.split("/");
  return parts.length === 2 && parts[0] === "example-vault" && exampleAreas.has(parts[1]);
}

function isAllowedExampleFile(relativeName) {
  if (relativeName === "example-vault/index.md" || relativeName === "example-vault/ATTRIBUTION.txt") {
    return true;
  }
  const parts = relativeName.split("/");
  return (
    parts.length === 3 &&
    parts[0] === "example-vault" &&
    exampleAreas.has(parts[1]) &&
    parts[2].endsWith(".md") &&
    parts[2] !== "index.md" &&
    parts[2] !== "log.md"
  );
}

function createStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  // A fixed timestamp makes equal source files produce an equal archive.
  const dosTime = 0;
  const dosDate = (46 << 9) | (1 << 5) | 1; // 2026-01-01

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const checksum = crc32(file.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(file.data.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, file.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(file.data.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + file.data.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const value of data) crc = (crc >>> 8) ^ crcTable[(crc ^ value) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
