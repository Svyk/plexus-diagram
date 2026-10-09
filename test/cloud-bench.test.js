// The cloud bench hook. Fake fetch only. No provider key is printed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { cloudSpend, parseCloudRunArgs, runCloudBench } from "../tools/parse-bench/cloud-run.mjs";

function jsonRes(status, body) {
  return { status, json: async () => body };
}

test("cloud-run without a key exits before it reads the PDF", () => {
  const env = { ...process.env };
  delete env.MISTRAL_API_KEY;
  delete env.LLAMA_CLOUD_API_KEY;
  const result = spawnSync(process.execPath, [
    "tools/parse-bench/cloud-run.mjs",
    "--provider", "mistral",
    "--pdf", "missing.pdf",
    "--out", "nowhere",
  ], { encoding: "utf8", env });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /MISTRAL_API_KEY is not set/);
  assert.equal(result.stdout.includes("test-mistral-key"), false);
  assert.equal(result.stderr.includes("test-mistral-key"), false);
});

test("cloud-run caches a fake Mistral response and does not print the key", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pxd-cloud-"));
  const pdf = path.join(dir, "paper.pdf");
  await writeFile(pdf, Buffer.from("%PDF-1.1"));
  const out = path.join(dir, "out");
  const key = "test-mistral-key";
  try {
    const result = await runCloudBench({
      provider: "mistral",
      pdfPath: pdf,
      pages: "1,3",
      outDir: out,
      env: { MISTRAL_API_KEY: key },
      fetch: async (url, init) => {
        assert.equal(String(url), "https://api.mistral.ai/v1/ocr");
        assert.equal(init.headers.Authorization, `Bearer ${key}`);
        const body = JSON.parse(init.body);
        assert.deepEqual(body.pages, [0, 2]);
        assert.equal(JSON.stringify(body).includes(key), false);
        return jsonRes(200, {
          model: "mistral-ocr-latest",
          usage_info: { pages_processed: 2 },
          pages: [{ index: 1, markdown: "Hello", dimensions: { width: 10, height: 20 } }],
        });
      },
    });
    assert.equal(result.code, 0);
    assert.match(result.message, /provider mistral/);
    assert.match(result.message, /pages 2/);
    assert.match(result.message, /usd 0.0080/);
    assert.equal(result.message.includes(key), false);
    const raw = JSON.parse(await readFile(result.rawPath, "utf8"));
    const pxd = JSON.parse(await readFile(result.pxdPath, "utf8"));
    assert.equal(raw.usage_info.pages_processed, 2);
    assert.equal(pxd.schema, "pxd-parse/1");
    assert.equal(pxd.options.provider, "mistral");
    assert.equal(JSON.stringify(raw).includes(key), false);
    assert.equal(JSON.stringify(pxd).includes(key), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloud-run calls LlamaParse on its own host and reports usage credits", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pxd-cloud-"));
  const pdf = path.join(dir, "paper.pdf");
  await writeFile(pdf, Buffer.from("%PDF-1.1"));
  const key = "test-cloud-key";
  try {
    const result = await runCloudBench({
      provider: "llamaparse",
      pdfPath: pdf,
      pages: "1,3",
      outDir: path.join(dir, "out"),
      env: { LLAMA_CLOUD_API_KEY: key, LLAMA_CLOUD_REGION: "eu" },
      fetch: async (url, init = {}) => {
        const href = String(url);
        assert.equal(href.startsWith("https://api.cloud.eu.llamaindex.ai"), true);
        assert.equal(init.headers?.Authorization, `Bearer ${key}`);
        assert.equal(init.headers?.["X-Pxd-Region"], undefined);
        if (href.endsWith("/api/v1/beta/files")) return jsonRes(200, { id: "file1" });
        if (init.method === "POST" && href.endsWith("/api/v2/parse")) {
          const body = JSON.parse(init.body);
          assert.equal(body.page_ranges.target_pages, "1,3");
          return jsonRes(200, { id: "job1", status: "COMPLETED" });
        }
        return jsonRes(200, {
          job: { id: "job1", status: "COMPLETED", usage: { credits: 4 } },
          items: { pages: [] },
        });
      },
    });
    assert.equal(result.code, 0);
    assert.match(result.message, /credits 4/);
    assert.match(result.message, /usd 0.0050/);
    assert.equal(result.message.includes(key), false);
    assert.deepEqual(cloudSpend("llamaparse", { job: { usage: { credits: 4 } }, items: { pages: [] } }).credits, 4);
    assert.deepEqual(parseCloudRunArgs(["--provider", "mistral", "--pdf", "a.pdf", "--pages", "2", "--out", "o"]), {
      provider: "mistral", pdf: "a.pdf", pages: "2", outDir: "o",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
