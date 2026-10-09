// Call LlamaParse or Mistral directly and cache the raw JSON plus pxd-parse/1.
// The key comes from the environment. This file never prints it.
// Layout images are on, the same request as the extension. `--no-layout` omits
// images_to_save so a credit comparison can use this script.
//   node tools/parse-bench/cloud-run.mjs --provider llamaparse|mistral --pdf <file> [--pages 1,3] [--no-layout] --out <dir>
//
// Corpus (LLAMA_CLOUD_API_KEY; cloud-bench.mjs skips a page that already has a pxd file):
//   node /tmp/wo/pxd14/cloud-bench.mjs <this repo> llamaparse
// Expected after a refetch: diesel p13 converts (the span behind cell-range:t4:31:0 is clamped).
// Each layout image becomes a figure. A chart that is also a table keeps the table with fromChart.
// Whether images_to_save changes credits is the with/without pair, not this default run.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CREDIT_USD,
  DEFAULT_TIER,
  TIER_CREDITS,
  estimateCloudCost,
  pageSpec,
  parseCloud,
  parseMistral,
} from "../../src/host/cloud-parse.js";
import { llamaparseToParse, mistralToParse } from "../../src/model/cloud-to-parse.js";

const LLAMA_US = "https://api.cloud.llamaindex.ai";
const LLAMA_EU = "https://api.cloud.eu.llamaindex.ai";

export function parseCloudRunArgs(argv) {
  const out = { provider: "", pdf: "", pages: "", outDir: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--provider") { out.provider = next || ""; i += 1; }
    else if (arg === "--pdf") { out.pdf = next || ""; i += 1; }
    else if (arg === "--pages") { out.pages = next || ""; i += 1; }
    else if (arg === "--out") { out.outDir = next || ""; i += 1; }
    else if (arg === "--no-layout") out.layout = false;
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

export function cloudSpend(provider, raw) {
  if (provider === "mistral") {
    const count = Number(raw?.usage_info?.pages_processed);
    const pages = Number.isFinite(count) ? count : 0;
    return { pages, credits: null, usd: pages * (4 / 1000), note: "usage_info.pages_processed × $4/1000" };
  }
  const usage = raw?.usage || raw?.job?.usage || {};
  const credits = Number(usage.credits ?? usage.total_credits ?? usage.credit_usage);
  const pageCount = Number(raw?.items?.pages?.length) || 0;
  const estimate = estimateCloudCost({ pages: pageCount, tier: DEFAULT_TIER });
  if (Number.isFinite(credits)) {
    return { pages: pageCount, credits, usd: credits * CREDIT_USD, note: "usage credits × $1.25/1000" };
  }
  return { pages: pageCount, credits: estimate.credits, usd: estimate.usd, note: "estimate; the result had no usage credits" };
}

function redact(text, key) {
  const secret = String(key || "");
  if (!secret) return String(text || "");
  return String(text || "").split(secret).join("[key]");
}

function fileTag(pdfPath, pages, provider) {
  const base = path.basename(pdfPath).replace(/[^\w.-]+/g, "_");
  const spec = pageSpec(pages).replace(/,/g, "-") || "all";
  return `${base}.p${spec}.${provider}`;
}

export async function runCloudBench({
  provider,
  pdfPath,
  pages = "",
  outDir,
  env = process.env,
  fetch: fetchFn = globalThis.fetch,
  readFile: read = readFile,
  writeFile: write = writeFile,
  mkdir: makeDir = mkdir,
  layout = true,
} = {}) {
  const which = provider === "mistral" ? "mistral" : provider === "llamaparse" ? "llamaparse" : "";
  if (!which) return { code: 1, message: "Pass --provider llamaparse or --provider mistral." };
  if (!pdfPath || !outDir) return { code: 1, message: "Pass --pdf <file> and --out <dir>." };
  const keyName = which === "mistral" ? "MISTRAL_API_KEY" : "LLAMA_CLOUD_API_KEY";
  const key = String(env?.[keyName] || "").trim();
  if (!key) {
    return {
      code: 2,
      message: `${keyName} is not set. Export it in the environment. This command does not read a key from a file, and it will not print one.`,
    };
  }
  let bytes;
  try {
    bytes = new Uint8Array(await read(pdfPath));
  } catch (error) {
    return { code: 1, message: redact(error?.message || "could not read the PDF", key) };
  }
  let raw;
  try {
    if (which === "mistral") {
      const result = await parseMistral({
        fetch: fetchFn,
        bytes,
        apiKey: key,
        pages: pages || undefined,
        confirmed: true,
      });
      raw = result.provider;
    } else {
      const region = String(env.LLAMA_CLOUD_REGION || "").toLowerCase() === "eu" ? "eu" : "us";
      const tier = Object.prototype.hasOwnProperty.call(TIER_CREDITS, env.LLAMA_CLOUD_TIER)
        ? env.LLAMA_CLOUD_TIER
        : DEFAULT_TIER;
      const result = await parseCloud({
        fetch: fetchFn,
        transport: { kind: "relay", url: region === "eu" ? LLAMA_EU : LLAMA_US, direct: true },
        bytes,
        apiKey: key,
        region,
        tier,
        pages: pages || undefined,
        layout,
        confirmed: true,
      });
      raw = result.provider;
    }
  } catch (error) {
    return { code: 1, message: redact(error?.message || "cloud parse failed", key) };
  }
  await makeDir(outDir, { recursive: true });
  const tag = fileTag(pdfPath, pages, which);
  const rawPath = path.join(outDir, `${tag}.raw.json`);
  const pxdPath = path.join(outDir, `${tag}.pxd.json`);
  await write(rawPath, `${JSON.stringify(raw, null, 2)}\n`);
  let doc;
  try {
    doc = which === "mistral"
      ? mistralToParse(raw, { sha256: null })
      : llamaparseToParse(raw, { sha256: null, tier: Object.prototype.hasOwnProperty.call(TIER_CREDITS, env.LLAMA_CLOUD_TIER) ? env.LLAMA_CLOUD_TIER : DEFAULT_TIER, region: String(env.LLAMA_CLOUD_REGION || "").toLowerCase() === "eu" ? "eu" : "us" });
  } catch (error) {
    return { code: 1, message: redact(`${error?.message || "cloud parse failed"}\n${rawPath}`, key), rawPath };
  }
  await write(pxdPath, `${JSON.stringify(doc, null, 2)}\n`);
  const spend = cloudSpend(which, raw);
  const credits = spend.credits == null ? "n/a" : String(spend.credits);
  const message = [
    `provider ${which}`,
    `pages ${spend.pages}`,
    `credits ${credits}`,
    `usd ${spend.usd.toFixed(4)}`,
    spend.note,
    rawPath,
    pxdPath,
  ].join("\n");
  return { code: 0, message: redact(message, key), rawPath, pxdPath, spend };
}

async function main() {
  const args = parseCloudRunArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("node tools/parse-bench/cloud-run.mjs --provider llamaparse|mistral --pdf <file> [--pages 1,3] [--no-layout] --out <dir>\n");
    return;
  }
  const result = await runCloudBench({
    provider: args.provider,
    pdfPath: args.pdf,
    pages: args.pages,
    outDir: args.outDir,
    layout: args.layout !== false,
  });
  const stream = result.code === 0 ? process.stdout : process.stderr;
  stream.write(`${result.message}\n`);
  process.exitCode = result.code;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();
