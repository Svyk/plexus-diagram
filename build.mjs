import { build as esbuild } from "esbuild";
import { copyFile, mkdir, readFile, readdir, rm, watch, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const defaultRoot = dirname(thisFile);

const rejectRemoteImports = {
  name: "reject-remote-imports",
  setup(build) {
    build.onResolve({ filter: /^(?:https?:)?\/\// }, ({ path }) => ({
      errors: [{ text: `Remote import is not allowed in a self-contained Roam extension: ${path}` }],
    }));
  },
};

export function artifactBanner(version) {
  return `/* Plexus Diagram v${version} | MIT | generated; edit src/ */`;
}

// Shared by the extension build and scripts/size-report.mjs. Callers add
// metafile: true; they do not copy this option list.
export function bundleBuildOptions({
  rootDirectory = defaultRoot,
  entryPoint = "src/extension.js",
  banner = "",
  metafile = false,
} = {}) {
  return {
    absWorkingDir: resolve(rootDirectory),
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    outfile: "extension.js",
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    charset: "utf8",
    legalComments: "none",
    minify: false,
    sourcemap: false,
    treeShaking: true,
    logLevel: "silent",
    plugins: [rejectRemoteImports],
    banner: banner ? { js: banner } : undefined,
    metafile: Boolean(metafile),
  };
}

export async function bundleEntry({
  rootDirectory = defaultRoot,
  entryPoint = "src/extension.js",
  banner = "",
  metafilePath,
} = {}) {
  const result = await esbuild(bundleBuildOptions({
    rootDirectory,
    entryPoint,
    banner,
    metafile: Boolean(metafilePath),
  }));
  const output = result.outputFiles.find((file) => file.path.endsWith("extension.js"));
  if (!output) throw new Error("esbuild did not emit extension.js");
  if (metafilePath) {
    if (!result.metafile) throw new Error("esbuild did not emit a metafile");
    const target = resolve(metafilePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(result.metafile)}\n`, "utf8");
  }
  return output.text;
}

// Served by Pages as /helper/install.sh. The source lives beside the helper it installs.
const HELPER_INSTALLER = "tools/parse-helper/install.sh";

export async function readCss(rootDirectory = defaultRoot) {
  const root = resolve(rootDirectory);
  const parts = [await readFile(resolve(root, "src/extension.css"), "utf8")];
  let names = [];
  try {
    names = await readdir(resolve(root, "src/css"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const name of names.filter((n) => n.endsWith(".css")).sort()) {
    parts.push(await readFile(resolve(root, "src/css", name), "utf8"));
  }
  return parts.join("\n");
}

export async function syncChangelogText(rootDirectory = defaultRoot) {
  const root = resolve(rootDirectory);
  const text = await readFile(resolve(root, "CHANGELOG.md"), "utf8");
  const out = `// Generated from CHANGELOG.md. build.mjs rewrites this file.\nexport const CHANGELOG_TEXT = ${JSON.stringify(text)};\n`;
  const path = resolve(root, "src/changelog-text.js");
  let prev = "";
  try { prev = await readFile(path, "utf8"); } catch { /* first build */ }
  if (prev !== out) await writeFile(path, out, "utf8");
}

export async function renderArtifacts(rootDirectory = defaultRoot, options = {}) {
  await syncChangelogText(rootDirectory);
  const packageMetadata = JSON.parse(await readFile(resolve(rootDirectory, "package.json"), "utf8"));
  const banner = artifactBanner(packageMetadata.version);
  return {
    javascript: await bundleEntry({ rootDirectory, banner, metafilePath: options.metafilePath }),
    css: await readCss(rootDirectory),
  };
}

export async function build(rootDirectory = defaultRoot, options = {}) {
  const { javascript, css } = await renderArtifacts(rootDirectory, options);
  const deployDir = resolve(rootDirectory, "deploy");
  await Promise.all([
    writeFile(resolve(rootDirectory, "extension.js"), javascript, "utf8"),
    writeFile(resolve(rootDirectory, "extension.css"), css, "utf8"),
  ]);
  await rm(deployDir, { recursive: true, force: true });
  await mkdir(resolve(deployDir, "helper"), { recursive: true });
  await Promise.all([
    copyFile(resolve(rootDirectory, HELPER_INSTALLER), resolve(deployDir, "helper", "install.sh")),
    writeFile(resolve(deployDir, "extension.js"), javascript, "utf8"),
    writeFile(resolve(deployDir, "extension.css"), css, "utf8"),
    ...["README.md", "CHANGELOG.md", "LICENSE"].map((name) => (
      copyFile(resolve(rootDirectory, name), resolve(deployDir, name))
    )),
    writeFile(resolve(deployDir, ".nojekyll"), "", "utf8"),
  ]);
  process.stdout.write(`Built extension.js, extension.css, and ${deployDir}\n`);
}

export async function verifyGeneratedArtifacts(rootDirectory = defaultRoot) {
  const expected = await renderArtifacts(rootDirectory);
  const comparisons = [
    ["extension.js", expected.javascript],
    ["extension.css", expected.css],
    ["deploy/extension.js", expected.javascript],
    ["deploy/extension.css", expected.css],
    ["deploy/README.md", await readFile(resolve(rootDirectory, "README.md"), "utf8")],
    ["deploy/CHANGELOG.md", await readFile(resolve(rootDirectory, "CHANGELOG.md"), "utf8")],
    ["deploy/LICENSE", await readFile(resolve(rootDirectory, "LICENSE"), "utf8")],
    ["deploy/helper/install.sh", await readFile(resolve(rootDirectory, HELPER_INSTALLER), "utf8")],
    ["deploy/.nojekyll", ""],
  ];
  const drift = [];
  for (const [filename, expectedContent] of comparisons) {
    let actual;
    try {
      actual = await readFile(resolve(rootDirectory, filename), "utf8");
    } catch {
      drift.push(`${filename} is missing`);
      continue;
    }
    if (actual !== expectedContent) drift.push(`${filename} is stale`);
  }
  if (drift.length) throw new Error(`Generated artifact drift:\n- ${drift.join("\n- ")}`);
}

function metafilePathFromArgv(argv) {
  const index = argv.indexOf("--metafile");
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error("--metafile needs an output path");
  return value;
}

async function main() {
  const options = { metafilePath: metafilePathFromArgv(process.argv) };
  await build(defaultRoot, options);
  if (!process.argv.includes("--watch")) return;
  process.stdout.write("Watching src/ for changes. Press Ctrl-C to stop.\n");
  const watcher = watch(resolve(defaultRoot, "src"), { recursive: true });
  let pending = Promise.resolve();
  for await (const event of watcher) {
    if (!event.filename || !/\.(?:js|css)$/.test(event.filename)) continue;
    pending = pending.then(() => build(defaultRoot, options), () => build(defaultRoot, options));
    await pending;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === thisFile) await main();
