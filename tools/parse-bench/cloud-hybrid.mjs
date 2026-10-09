// Merge a LlamaParse pxd document with a local pxd document for the same page.
// Uses mergeCloudFigures from the extension. No network, no provider key.
//
//   node tools/parse-bench/cloud-hybrid.mjs --cloud a.pxd.json --local b.pxd.json --out merged.pxd.json
//   node tools/parse-bench/cloud-hybrid.mjs --cloud-dir /tmp/wo/pxd14/cloud-out/llamaparse --hybrid /tmp/wo/pxd14/local-pxd/web-ocr --out /tmp/wo/pxd14/cloud-out/hybrid
//
// A cloud file naca-accelerometer-1922.pdf.p3.llamaparse.pxd.json pairs with
// <hybrid>/naca-accelerometer-1922-p3.pxd.json (the scan-corpus --dump name).
// Batch output keeps the cloud basename with the provider segment replaced by "hybrid",
// so cloud-bench.mjs can score the directory as provider "hybrid" without calling LlamaParse
// when every page file is already there.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeCloudFigures } from "../../src/model/cloud-merge.js";

export function parseHybridArgs(argv) {
  const out = { cloud: "", local: "", cloudDir: "", hybrid: "", out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--cloud") { out.cloud = next || ""; i += 1; }
    else if (arg === "--local") { out.local = next || ""; i += 1; }
    else if (arg === "--cloud-dir") { out.cloudDir = next || ""; i += 1; }
    else if (arg === "--hybrid") { out.hybrid = next || ""; i += 1; }
    else if (arg === "--out") { out.out = next || ""; i += 1; }
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

// naca-accelerometer-1922.pdf.p3.llamaparse.pxd.json → naca-accelerometer-1922-p3
export function corpusIdFromCloud(filename) {
  const base = path.basename(String(filename || ""));
  const match = /^(.*?)\.pdf\.p(\d+)\.[^.]+\.pxd\.json$/i.exec(base);
  if (!match) return "";
  return `${match[1]}-p${match[2]}`;
}

export function hybridOutName(filename) {
  const base = path.basename(String(filename || ""));
  return base.replace(/\.([^.]+)\.pxd\.json$/i, ".hybrid.pxd.json");
}

export async function readPxd(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function mergePxdFiles(cloudPath, localPath) {
  const cloud = await readPxd(cloudPath);
  const local = localPath ? await readPxd(localPath) : null;
  return mergeCloudFigures(cloud, local);
}

export async function mergeCloudDir({ cloudDir, hybridDir, outDir }) {
  const names = (await readdir(cloudDir)).filter((name) => name.endsWith(".pxd.json"));
  await mkdir(outDir, { recursive: true });
  const written = [];
  const missing = [];
  for (const name of names) {
    const id = corpusIdFromCloud(name);
    const localName = id ? `${id}.pxd.json` : "";
    const localPath = localName ? path.join(hybridDir, localName) : "";
    let local = null;
    if (localPath) {
      try { local = await readPxd(localPath); } catch { local = null; }
    }
    if (!local) missing.push(id || name);
    const merged = await mergePxdFiles(path.join(cloudDir, name), local ? localPath : "");
    const outName = hybridOutName(name);
    const outPath = path.join(outDir, outName);
    await writeFile(outPath, JSON.stringify(merged));
    written.push(outPath);
  }
  return { written, missing };
}

async function main(argv) {
  const args = parseHybridArgs(argv);
  if (args.help || (!args.cloud && !args.cloudDir)) {
    process.stderr.write("usage: cloud-hybrid.mjs --cloud <pxd> --local <pxd> --out <pxd>\n       cloud-hybrid.mjs --cloud-dir <dir> --hybrid <localEngineDir> --out <dir>\n");
    process.exitCode = 2;
    return;
  }
  if (args.cloud) {
    if (!args.out) { process.stderr.write("missing --out\n"); process.exitCode = 2; return; }
    const merged = await mergePxdFiles(args.cloud, args.local);
    await mkdir(path.dirname(args.out), { recursive: true });
    await writeFile(args.out, JSON.stringify(merged));
    process.stdout.write(`${args.out}\n`);
    return;
  }
  if (!args.hybrid || !args.out) { process.stderr.write("missing --hybrid or --out\n"); process.exitCode = 2; return; }
  const result = await mergeCloudDir({ cloudDir: args.cloudDir, hybridDir: args.hybrid, outDir: args.out });
  process.stdout.write(`wrote ${result.written.length}\n`);
  if (result.missing.length) process.stderr.write(`no local pxd for ${result.missing.join(", ")}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
