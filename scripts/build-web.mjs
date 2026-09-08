import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const destination = path.join(root, "dist/web");
const [packageJson, license, commitResult, statusResult] = await Promise.all([
  readFile(path.join(root, "package.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "LICENSE"), "utf8"),
  run("git", ["rev-parse", "HEAD"], { cwd: root }),
  run("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root }),
]);
const commit = commitResult.stdout.trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Expected a full Git commit SHA.");
const dirty = statusResult.stdout.trim().length > 0;
const repository = packageJson.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
const banner = [
  `PGM Viewer browser distribution v${packageJson.version}`,
  `Source: ${repository}/tree/${commit}${dirty ? " (working tree modified)" : ""}`,
  license.trim(),
].join("\n\n").replaceAll("*/", "*\\/");

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
const bundle = await build({
  absWorkingDir: root,
  banner: { js: `/*!\n${banner}\n*/` },
  bundle: true,
  entryPoints: ["src/browser.ts"],
  format: "esm",
  legalComments: "inline",
  logLevel: "info",
  metafile: true,
  minify: false,
  outfile: "dist/web/index.js",
  platform: "browser",
  sourcemap: "linked",
  sourcesContent: true,
  target: "es2021",
  treeShaking: true,
  write: false,
});

const inputs = Object.keys(bundle.metafile.inputs).sort();
if (inputs.some((name) => !name.startsWith("src/"))) {
  throw new Error("The browser viewer must only bundle this repository's shared source.");
}
if (Object.values(bundle.metafile.outputs).some((output) => output.imports.length > 0)) {
  throw new Error("The browser viewer must not require external runtime imports.");
}
for (const output of bundle.outputFiles) await writeFile(output.path, output.contents);

await run(process.execPath, [
  path.join(root, "node_modules/typescript/bin/tsc"),
  "--project", path.join(root, "tsconfig.web.json"),
], { cwd: root });
await Promise.all([
  copyFile(path.join(root, "styles.css"), path.join(destination, "styles.css")),
  copyFile(path.join(root, "LICENSE"), path.join(destination, "LICENSE")),
  writeFile(path.join(destination, "index.d.ts"), 'export * from "./types/browser";\n'),
]);

// Hash build inputs as well as recording the commit, including type-only pgm.ts.
// A local development build is explicitly marked dirty until rebuilt after commit.
const sourceFiles = [...new Set([
  ...inputs, "src/pgm.ts", "styles.css", "LICENSE", "package.json",
  "package-lock.json", "tsconfig.json", "tsconfig.web.json", "scripts/build-web.mjs",
])].sort();
const sources = Object.fromEntries(await Promise.all(sourceFiles.map(async (name) => [
  name, createHash("sha256").update(await readFile(path.join(root, name))).digest("hex"),
])));
await writeFile(path.join(destination, "source.json"), `${JSON.stringify({
  name: "pgm-viewer",
  version: packageJson.version,
  repository,
  commit,
  dirty,
  entry: "src/browser.ts",
  runtimeDependencies: [],
  runtimeSources: inputs,
  sourceSha256: sources,
}, null, 2)}\n`);
console.log(`Created dist/web for PGM Viewer ${packageJson.version} at ${commit}${dirty ? " (working tree modified)" : ""}`);
