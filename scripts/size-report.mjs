import { build as esbuild } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { artifactBanner, renderBundle } from "../build.mjs";
import { CSS_BUDGET_BYTES, JS_BUDGET_BYTES } from "./size-gate.mjs";

const thisFile = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(thisFile), "..");

export const TOP_MODULES = 15;

export function modulesByOutputBytes(metafile, limit = TOP_MODULES) {
  const outputs = metafile && metafile.outputs ? metafile.outputs : {};
  const names = Object.keys(outputs);
  const key = names.find((name) => name.endsWith("extension.js")) ?? names[0];
  const inputs = key && outputs[key] && outputs[key].inputs ? outputs[key].inputs : {};
  const rows = Object.entries(inputs).map(([path, info]) => ({
    path,
    bytes: info && typeof info.bytesInOutput === "number" ? info.bytesInOutput : 0,
  }));
  rows.sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return rows.slice(0, limit);
}

export function formatSizeReport({ jsBytes, startBytes, cssBytes, modules, measured, pieces = {} }) {
  const lines = [
    "# Bundle size",
    "",
    `Measured ${measured}. The size gate fails when an artifact is at or over its budget. 1 KB = 1024 bytes.`,
    "",
    "| artifact | bytes | budget |",
    "| --- | ---: | --- |",
    `| extension.js | ${jsBytes} | ${JS_BUDGET_BYTES} (900 KB) |`,
    `| extension.css | ${cssBytes} | ${CSS_BUDGET_BYTES} (90 KB) |`,
    "",
    `Start code in extension.js: ${startBytes} bytes. The rest of the file is the pieces below, kept as deflated text and only inflated and evaluated on first use. Roam Depot publishes extension.js and extension.css alone and remote code is ruled out, so pieces cannot leave the file, and extension.js cannot reach its budget.`,
    "",
    "| piece | code bytes | CSS bytes | stored bytes |",
    "| --- | ---: | ---: | ---: |",
    ...Object.entries(pieces).map(([name, row]) => `| ${name} | ${row.bytes} | ${row.cssBytes} | ${row.stored} |`),
    "",
    "Regenerate with `node scripts/size-report.mjs --write docs/size.md`.",
    "",
    "## Top 15 modules by output bytes",
    "",
    "| bytes | module |",
    "| ---: | --- |",
    ...modules.map((row) => `| ${row.bytes} | \`${row.path}\` |`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function localDay(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function collectSizeReport(rootDirectory = defaultRoot) {
  const packageMetadata = JSON.parse(await readFile(resolve(rootDirectory, "package.json"), "utf8"));
  const { javascript, css, metafile, report } = await renderBundle({
    rootDirectory,
    banner: artifactBanner(packageMetadata.version),
  });
  return {
    jsBytes: Buffer.byteLength(javascript, "utf8"),
    startBytes: report.coreBytes,
    cssBytes: Buffer.byteLength(css, "utf8"),
    pieces: report.pieces,
    modules: modulesByOutputBytes(metafile, TOP_MODULES),
  };
}

function writeArg(argv) {
  const index = argv.indexOf("--write");
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error("--write needs an output path");
  return value;
}

async function main() {
  const report = await collectSizeReport();
  const text = formatSizeReport({ ...report, measured: localDay(new Date()) });
  process.stdout.write(text);
  const target = writeArg(process.argv);
  if (!target) return;
  const path = resolve(target);
  await writeFile(path, text, "utf8");
  process.stderr.write(`Wrote ${path}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === thisFile) await main();
