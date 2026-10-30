import { readFileSync, readdirSync } from "node:fs";

// The stylesheet as written. The built extension.css is minified and split (scripts/pieces.mjs).
export function sourceCss() {
  const dir = new URL("../src/css/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".css")).sort();
  return [new URL("../src/extension.css", import.meta.url), ...files.map((name) => new URL(name, dir))]
    .map((url) => readFileSync(url, "utf8")).join("\n");
}
