import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";
import builtins from "builtin-modules";

const production = process.argv[2] === "production";
const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
const [license, thirdPartyNotices] = await Promise.all([
  readFile(new URL("./LICENSE", import.meta.url), "utf8"),
  readFile(new URL("./THIRD_PARTY_NOTICES.md", import.meta.url), "utf8"),
]);
const legalBanner = [
  `PGM Viewer v${manifest.version}`,
  license.trim(),
  thirdPartyNotices.trim(),
]
  .join("\n\n")
  .replaceAll("*/", "*\\/");

const context = await esbuild.context({
  banner: { js: `/*!\n${legalBanner}\n*/` },
  bundle: true,
  entryPoints: ["src/main.ts"],
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins, ...builtinModules],
  format: "cjs",
  logLevel: "info",
  minify: production,
  outfile: "main.js",
  platform: "browser",
  sourcemap: production ? false : "inline",
  target: "es2021",
  treeShaking: true
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
