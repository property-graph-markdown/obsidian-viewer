import { readFile } from "node:fs/promises";

const [manifest, packageJson, packageLock, versions] = await Promise.all(
  ["manifest.json", "package.json", "package-lock.json", "versions.json"].map(async (name) =>
    JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8")),
  ),
);

const failures = [];
const numericVersion = /^\d+\.\d+\.\d+$/;

if (!numericVersion.test(manifest.version)) failures.push("manifest.version must be numeric x.y.z");
if (manifest.id !== "pgm-viewer") failures.push("manifest.id must remain pgm-viewer");
if (manifest.name !== "PGM Viewer") failures.push("manifest.name must remain PGM Viewer");
if (manifest.version !== packageJson.version) failures.push("manifest.json and package.json versions differ");
if (manifest.version !== packageLock.version) failures.push("manifest.json and package-lock.json versions differ");
if (manifest.version !== packageLock.packages?.[""]?.version) {
  failures.push("manifest.json and package-lock root package versions differ");
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  failures.push("versions.json must map the release version to manifest.minAppVersion");
}
if (packageJson.license !== "MIT") failures.push("package.json license must remain MIT");
if (!String(packageJson.repository?.url).includes("property-graph-markdown/obsidian-viewer")) {
  failures.push("package.json repository must target property-graph-markdown/obsidian-viewer");
}

if (failures.length > 0) {
  throw new Error(`Release metadata is inconsistent:\n- ${failures.join("\n- ")}`);
}

console.log(`Release metadata verified: ${manifest.id} ${manifest.version}`);
