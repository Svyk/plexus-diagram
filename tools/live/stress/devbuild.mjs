// Dev-only: the Depot variant (one file, no lazy pieces), unminified, so function names in CPU profiles are readable.
// Timings from this build are not baselines. Never shipped.
//   node tools/live/stress/devbuild.mjs <repoRoot> <outDir>
import { resolve } from "node:path";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

if (process.argv.length < 4 || process.argv.includes("--help")) {
  console.error("usage: node tools/live/stress/devbuild.mjs <repoRoot> <outDir>\n  writes <outDir>/extension.js (unminified Depot bundle) and extension.css (copied from deploy/)");
  process.exit(2);
}
const root = resolve(process.argv[2]); const out = resolve(process.argv[3]);
const b = await import(pathToFileURL(resolve(root, "build.mjs")).href);
if (typeof b.bundleBuildOptions !== "function") { console.error("build.mjs has no bundleBuildOptions export in " + root); process.exit(2); }
const { build: esbuild } = await import(pathToFileURL(resolve(root, "node_modules/esbuild/lib/main.js")).href);
const opts = b.bundleBuildOptions({ rootDirectory: root, depot: true });
const r = await esbuild({ ...opts, minify: false });
await mkdir(out, { recursive: true });
await writeFile(resolve(out, "extension.js"), r.outputFiles.find((f) => f.path.endsWith("extension.js")).text);
await copyFile(resolve(root, "deploy/extension.css"), resolve(out, "extension.css"));
console.log("dev build", out);
