import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(thisFile), "..");

export const KB = 1024;
export const JS_BUDGET_BYTES = 900 * KB;
export const CSS_BUDGET_BYTES = 90 * KB;

export function assessSizes({ js, css }) {
  const failures = [];
  if (js >= JS_BUDGET_BYTES) {
    failures.push(`extension.js is ${js} bytes, budget is ${JS_BUDGET_BYTES} bytes (900 KB)`);
  }
  if (css >= CSS_BUDGET_BYTES) {
    failures.push(`extension.css is ${css} bytes, budget is ${CSS_BUDGET_BYTES} bytes (90 KB)`);
  }
  return {
    ok: failures.length === 0,
    js,
    css,
    message: failures.join("\n"),
  };
}

async function bytesFromStat(statFn, path) {
  const result = await statFn(path);
  if (typeof result === "number") return result;
  if (result && typeof result.size === "number") return result.size;
  throw new TypeError(`stat did not return a size for ${path}`);
}

export async function gateSizes({ rootDirectory = defaultRoot, stat: statFn = stat } = {}) {
  const [js, css] = await Promise.all([
    bytesFromStat(statFn, resolve(rootDirectory, "extension.js")),
    bytesFromStat(statFn, resolve(rootDirectory, "extension.css")),
  ]);
  return assessSizes({ js, css });
}

async function main() {
  const result = await gateSizes();
  if (!result.ok) {
    process.stderr.write(`${result.message}\n`);
    process.exit(1);
  }
  process.stdout.write(`extension.js ${result.js} bytes, extension.css ${result.css} bytes\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === thisFile) await main();
