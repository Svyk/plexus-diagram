// Cloud engine: LlamaParse client, confirm gate, converter, and the local key.
import assert from "node:assert/strict";
import test from "node:test";

import { createHelperClient } from "../src/host/parse-helper-client.js";
import {
  CLOUD_STORAGE,
  DEFAULT_RELAY_URL,
  cloudConfirmMessage,
  estimateCloudCost,
  estimateMistralCost,
  llamaRoute,
  mistralConfirmMessage,
  parseCloud,
  parseMistral,
  readCloudPrefs,
  readMistralKey,
  resolveCloudTransport,
  writeCloudPrefs,
  writeMistralKey,
} from "../src/host/cloud-parse.js";
import { createParseStore, restorableByUrl, restorableTitle } from "../src/host/parse-store.js";
import { layoutImageKind, layoutImagePage, llamaparseToParse, mistralToParse } from "../src/model/cloud-to-parse.js";
import { bestLocalDoc, mergeCloudFigures } from "../src/model/cloud-merge.js";
import { nextParsedTitle, parsedDocTitle, withKeptTitle } from "../src/model/pdf.js";
import { PARSE_REV } from "../src/model/parse/index.js";
import { validateParse } from "../src/model/parse-schema.js";
import { cloudRow, renderEnginesPanel } from "../src/view/engines-panel.js";
import { createParseView, engineChip } from "../src/view/parse-view.js";
import fixture from "./fixtures/llamaparse-synthetic.json" with { type: "json" };
import mistralFixture from "./fixtures/mistral-synthetic.json" with { type: "json" };
import { createDomStub } from "./fixtures/dom-stub.js";

const until = async (cond, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5));
};

function memory() {
  const bag = new Map();
  return {
    getItem: (id) => (bag.has(id) ? bag.get(id) : null),
    setItem: (id, value) => { bag.set(id, String(value)); },
  };
}

function jsonRes(status, body) {
  return { status, json: async () => body };
}

test("importing the cloud client fetches nothing", async () => {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (url) => { calls.push(url); throw new Error("fetch"); };
  try {
    await import("../src/host/cloud-parse.js");
  } finally {
    globalThis.fetch = prev;
  }
  assert.equal(calls.length, 0);
});

test("the helper endpoint is local and does not fetch", () => {
  const calls = [];
  const api = createHelperClient({
    fetch: () => { calls.push(1); throw new Error("fetch"); },
    settings: () => ({ "parse-helper-token": "helper-token" }),
    setSetting: async () => {},
  });
  assert.deepEqual(api.endpoint(), { url: "http://127.0.0.1:48765", token: "helper-token" });
  assert.equal(calls.length, 0);
});

test("parseCloud refuses to fetch until confirmed", async () => {
  let called = 0;
  await assert.rejects(
    () => parseCloud({
      fetch: () => { called += 1; throw new Error("fetch"); },
      transport: { kind: "relay", url: "https://relay.example" },
      bytes: new Uint8Array([1]),
      apiKey: "test-cloud-key",
      confirmed: false,
    }),
    (error) => error.code === "confirm",
  );
  assert.equal(called, 0);
});

test("the confirm text names LlamaParse, the pages, the estimate, and the 48 hour cache", () => {
  const est = estimateCloudCost({ pages: 2, tier: "agentic" });
  assert.equal(est.credits, 20);
  assert.equal(est.tierCredits, 10);
  assert.equal(est.layoutCredits, 0);
  assert.equal(est.usd, 0.025);
  const text = cloudConfirmMessage({ pages: 2, tier: "agentic", region: "eu" });
  assert.match(text, /LlamaParse \(EU, Agentic\)/);
  assert.match(text, /2 pages/);
  assert.match(text, /20 credits, 10 per page/);
  assert.doesNotMatch(text, /layout/i);
  assert.match(text, /48 h/);
  assert.match(text, /leaves this device/);
  assert.match(cloudConfirmMessage({ pages: 0, tier: "fast", region: "us" }), /page count unknown/);
});

test("a relay job uploads, polls, then fetches the expanded result", async () => {
  const calls = [];
  const sleeps = [];
  let polls = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", headers: init.headers, body: init.body });
    if (String(url).endsWith("/api/v1/beta/files")) return jsonRes(200, { id: "file1" });
    if (String(url).endsWith("/api/v2/parse") && init.method === "POST") return jsonRes(200, { id: "job1", status: "PENDING" });
    if (String(url).includes("expand=items")) return jsonRes(200, { job: { id: "job1", status: "COMPLETED" }, items: { pages: [] } });
    polls += 1;
    return jsonRes(200, { status: polls === 1 ? "RUNNING" : "COMPLETED", id: "job1" });
  };
  const result = await parseCloud({
    fetch,
    transport: { kind: "relay", url: "https://relay.example" },
    bytes: new Uint8Array([9, 8, 7]),
    apiKey: "test-cloud-key",
    region: "eu",
    tier: "agentic",
    confirmed: true,
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => 0,
  });
  assert.equal(result.transport, "relay");
  assert.equal(result.provider.job.status, "COMPLETED");
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [
    ["POST", "https://relay.example/api/v1/beta/files"],
    ["POST", "https://relay.example/api/v2/parse"],
    ["GET", "https://relay.example/api/v2/parse/job1"],
    ["GET", "https://relay.example/api/v2/parse/job1"],
    ["GET", "https://relay.example/api/v2/parse/job1?expand=items&expand=markdown&expand=usage&expand=images_content_metadata"],
  ]);
  assert.equal(calls[0].headers.Authorization, "Bearer test-cloud-key");
  assert.equal(calls[0].headers["X-Pxd-Region"], "eu");
  assert.equal(calls[0].body instanceof FormData, true);
  const started = JSON.parse(calls[1].body);
  assert.equal(started.tier, "agentic");
  assert.deepEqual(started.output_options.granular_bboxes, ["cell"]);
  assert.deepEqual(started.output_options.images_to_save, ["layout"]);
  assert.equal(started.page_ranges, undefined);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test("402 and 401 from the relay keep their status codes", async () => {
  const fetch402 = async (url, init = {}) => {
    if (String(url).endsWith("/files")) return jsonRes(200, { id: "file1" });
    return jsonRes(402, { detail: "out of credits" });
  };
  await assert.rejects(
    () => parseCloud({
      fetch: fetch402,
      transport: { kind: "relay", url: "https://relay.example" },
      bytes: new Uint8Array([1]),
      apiKey: "test-cloud-key",
      confirmed: true,
      sleep: async () => {},
      now: () => 0,
    }),
    (error) => error.code === "credits" && error.status === 402,
  );
  await assert.rejects(
    () => parseCloud({
      fetch: async () => jsonRes(401, { detail: "bad key" }),
      transport: { kind: "relay", url: "https://relay.example" },
      bytes: new Uint8Array([1]),
      apiKey: "test-cloud-key",
      confirmed: true,
    }),
    (error) => error.code === "unauthorized" && error.status === 401,
  );
});

test("a relay job times out and a cancel posts to the job", async () => {
  let clock = 0;
  await assert.rejects(
    () => parseCloud({
      fetch: async (url, init = {}) => {
        if (String(url).endsWith("/files")) return jsonRes(200, { id: "file1" });
        if (init.method === "POST") return jsonRes(200, { id: "job1", status: "PENDING" });
        return jsonRes(200, { status: "RUNNING" });
      },
      transport: { kind: "relay", url: "https://relay.example" },
      bytes: new Uint8Array([1]),
      apiKey: "test-cloud-key",
      confirmed: true,
      now: () => clock,
      sleep: async () => { clock += 300_000; },
      timeoutMs: 240_000,
    }),
    (error) => error.code === "timeout" && error.status === 504,
  );

  const ctrl = new AbortController();
  const calls = [];
  await assert.rejects(
    () => parseCloud({
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || "GET" });
        if (String(url).endsWith("/files")) return jsonRes(200, { id: "file1" });
        if (init.method === "POST" && String(url).endsWith("/parse")) return jsonRes(200, { id: "job1", status: "PENDING" });
        return jsonRes(200, { status: "CANCELLED" });
      },
      transport: { kind: "relay", url: "https://relay.example" },
      bytes: new Uint8Array([1]),
      apiKey: "test-cloud-key",
      confirmed: true,
      signal: ctrl.signal,
      now: () => 0,
      sleep: async () => {
        ctrl.abort();
        const error = new Error("cancelled");
        error.code = "cancelled";
        error.status = 499;
        throw error;
      },
    }),
    (error) => error.code === "cancelled",
  );
  assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/v2/parse/job1/cancel")));
});

test("the helper transport reads SSE and surfaces a 402 error event", async () => {
  const encoder = new TextEncoder();
  const stream = (text) => ({
    status: 200,
    body: {
      getReader() {
        let sent = false;
        return { async read() {
          if (sent) return { done: true };
          sent = true;
          return { done: false, value: encoder.encode(text) };
        } };
      },
    },
  });
  const ok = await parseCloud({
    fetch: async (url, init = {}) => {
      assert.equal(init.headers.Authorization, "Bearer helper-token");
      assert.equal(init.headers["X-Pxd-Cloud-Key"], "test-cloud-key");
      assert.equal(init.targetAddressSpace, "loopback");
      return stream('event: started\ndata: {"job":"c_abc"}\n\nevent: progress\ndata: {"status":"RUNNING","job":"c_abc"}\n\nevent: result\ndata: {"items":{"pages":[]}}\n\n');
    },
    transport: { kind: "helper", url: "http://127.0.0.1:48765", token: "helper-token" },
    bytes: new Uint8Array([1]),
    apiKey: "test-cloud-key",
    confirmed: true,
  });
  assert.equal(ok.transport, "helper");
  assert.deepEqual(ok.provider.items.pages, []);

  await assert.rejects(
    () => parseCloud({
      fetch: async () => stream('event: started\ndata: {"job":"c_x"}\n\nevent: error\ndata: {"code":"credits","message":"out","status":402}\n\n'),
      transport: { kind: "helper", url: "http://127.0.0.1:48765", token: "helper-token" },
      bytes: new Uint8Array([1]),
      apiKey: "test-cloud-key",
      confirmed: true,
    }),
    (error) => error.code === "credits" && error.status === 402,
  );
});

test("the cloud key is local storage only", () => {
  const storage = memory();
  const graph = [];
  const saved = writeCloudPrefs(storage, { key: "test-cloud-key", region: "eu", tier: "fast", relay: "https://relay.example/parse" });
  assert.equal(saved.key, "test-cloud-key");
  assert.deepEqual(readCloudPrefs(storage), saved);
  assert.equal(graph.length, 0);
  const kept = writeCloudPrefs(storage, { key: null, tier: "agentic" });
  assert.equal(kept.key, "test-cloud-key");
  assert.equal(kept.tier, "agentic");
  writeCloudPrefs(storage, { key: "" });
  assert.equal(readCloudPrefs(storage).key, "");
});

test("the engines sheet saves the key on this device and never calls setSetting", async () => {
  const stub = createDomStub();
  const parent = stub.document.createElement("div");
  const storage = memory();
  const settings = [];
  const toasts = [];
  const panel = renderEnginesPanel(stub.document, parent, {
    storage,
    setSetting: async (id) => { settings.push(id); },
    toast: (text) => toasts.push(text),
    setInterval: () => 1,
    clearInterval: () => {},
    client: { status: async () => ({ state: "not-installed", paired: false }) },
  });
  await until(() => panel.el.querySelector('[data-action="cloud-setup"]'));
  panel.el.querySelector('[data-action="cloud-setup"]').click();
  const input = panel.el.querySelector("[data-cloud-key]");
  assert.equal(input.getAttribute("type"), "password");
  input.value = "test-cloud-key";
  panel.el.querySelector("[data-cloud-region]").value = "eu";
  panel.el.querySelector("[data-cloud-tier]").value = "cost_effective";
  panel.el.querySelector("[data-cloud-relay]").value = "https://relay.example";
  panel.el.querySelector('[data-action="cloud-save"]').click();
  await until(() => storage.getItem("pxd-cloud-key") === "test-cloud-key");
  assert.deepEqual(settings, []);
  assert.equal(storage.getItem("pxd-cloud-region"), "eu");
  assert.equal(storage.getItem("pxd-cloud-tier"), "cost_effective");
  assert.match(toasts.at(-1), /this device/);
  const row = cloudRow(readCloudPrefs(storage), { state: "not-installed" });
  assert.equal(row.text, "LlamaParse · Cost-effective · EU · your relay. Mistral OCR: no install, cheaper, weaker tables.");
  assert.equal(row.button.label, "Edit");
  await until(() => /your relay/.test(panel.el.querySelector("[data-cloud-route]")?.textContent || ""));
  panel.el.querySelector('[data-action="cloud-clear"]').click();
  await until(() => storage.getItem("pxd-cloud-key") === "");
  assert.deepEqual(settings, []);
  panel.dispose();
});

test("the cloud row asks for a key, then a transport, then shows ready", () => {
  const missing = cloudRow(null, { state: "ready" });
  assert.equal(missing.text, "Needs a LlamaParse key. Mistral OCR: no install, cheaper, weaker tables.");
  assert.equal(missing.button.id, "cloud-setup");
  assert.equal(missing.disabled, undefined);
  // With no helper and no relay of its own, LlamaParse goes through the hosted relay.
  const hosted = cloudRow({ key: "test-cloud-key", tier: "agentic", region: "us", relay: "" }, { state: "not-paired" });
  assert.equal(hosted.text, "LlamaParse · Agentic · US · hosted relay. Mistral OCR: no install, cheaper, weaker tables.");
  assert.equal(llamaRoute({ key: "test-cloud-key", relay: "" }, { state: "not-paired" }, ""), "");
  const viaHelper = cloudRow({ key: "test-cloud-key", tier: "agentic", region: "us" }, { state: "ready" });
  assert.equal(viaHelper.text, "LlamaParse · Agentic · US · helper. Mistral OCR: no install, cheaper, weaker tables.");
  assert.equal(viaHelper.dot, "ok");
  const noCloudEngine = cloudRow(
    { key: "test-cloud-key", tier: "agentic", region: "us", relay: "https://relay.example" },
    { state: "ready", engines: ["docling", "ocr"] },
  );
  assert.match(noCloudEngine.text, /your relay/);
  const mistralSaved = cloudRow(
    { key: "test-cloud-key", mistralKey: "test-mistral-key", tier: "agentic", region: "us" },
    { state: "ready", engines: ["cloud"] },
  );
  assert.match(mistralSaved.text, /Mistral OCR: key saved/);
});

test("Read with LlamaParse does not fetch or read PDF bytes before confirm", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const storage = memory();
  writeCloudPrefs(storage, { key: "test-cloud-key", relay: "https://relay.example", tier: "agentic", region: "us" });
  const log = [];
  let dataReads = 0;
  let confirms = 0;
  stub.window.confirm = () => { confirms += 1; return true; };
  try {
    const view = createParseView({
      doc: stub.document,
      storage,
      getPdf: async () => ({
        numPages: 3,
        getData: async () => { dataReads += 1; log.push("bytes"); return new Uint8Array([1, 2, 3]); },
      }),
      fetch: () => { log.push("fetch"); throw new Error("fetch"); },
    });
    stub.document.body.append(view.element());
    view.element().querySelector(".pxd-parse__cloud").click();
    await until(() => view.element().querySelector(".pxd-cloud-confirm"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const sheet = view.element().querySelector(".pxd-cloud-confirm");
    assert.equal(sheet.querySelector("img"), null);
    assert.equal(sheet.querySelector("[data-cloud-provider]").textContent, "LlamaParse");
    assert.match(sheet.querySelector("[data-cloud-pages]").textContent, /3 pages/);
    assert.equal(log.length, 0);
    assert.equal(dataReads, 0);
    assert.equal(confirms, 0);
    sheet.querySelector("[data-cloud-cancel]").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(view.element().querySelector(".pxd-cloud-confirm"), null);
    assert.equal(log.length, 0);
    assert.equal(dataReads, 0);
  } finally {
    restore();
  }
});

test("after confirm, the view fetches, and a declined confirm never does", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const storage = memory();
  writeCloudPrefs(storage, { key: "test-cloud-key", relay: "https://relay.example" });
  const log = [];
  try {
    const view = createParseView({
      doc: stub.document,
      storage,
      getPdf: async () => ({ numPages: 1, getData: async () => new Uint8Array([4]) }),
      fetch: async () => { log.push("fetch"); return jsonRes(401, { detail: "bad key" }); },
      onToast: (message) => log.push(message),
    });
    stub.document.body.append(view.element());
    view.element().querySelector(".pxd-parse__cloud").click();
    await until(() => view.element().querySelector(".pxd-cloud-confirm"));
    assert.equal(log.length, 0);
    view.element().querySelector("[data-cloud-send]").click();
    await until(() => log.includes("fetch"));
    assert.equal(log[0], "fetch");
    assert.match(log.at(-1), /rejected the key/);
  } finally {
    restore();
  }
});

test("a synthetic LlamaParse job becomes pxd-parse/1", () => {
  assert.equal(fixture._synthetic, true);
  const doc = llamaparseToParse(fixture, { sha256: "abc", tier: "agentic", region: "eu" });
  assert.equal(validateParse(doc).ok, true);
  assert.equal(doc.schema, "pxd-parse/1");
  assert.equal(doc.engine, "cloud");
  assert.equal(doc.engineVersion, "llamaparse/agentic");
  assert.deepEqual(doc.options, {
    provider: "llamaparse",
    tier: "agentic",
    region: "eu",
    ocr: "none",
    formula: false,
    tables: "llamaparse",
  });
  assert.equal(doc.title, "Trial results");
  assert.equal(doc.pages[0].parsed, true);
  assert.equal(doc.pages[1].parsed, false);
  assert.equal(doc.pages[1].n, 2);
  assert.equal(doc.order.some((id) => doc.blocks[id].page === 2), false);
  assert.equal(doc.removed.length, 1);
  assert.equal(doc.removed[0].reason, "running-header");
  assert.equal(doc.removed[0].text, "Journal of Trials");
  const blocks = doc.order.map((id) => doc.blocks[id]);
  assert.deepEqual(blocks.map((block) => block.type), ["heading", "para", "list", "table", "figure", "caption"]);
  assert.deepEqual(blocks[0].bbox, [72, 72, 372, 96]);
  assert.equal(blocks[2].items[0].text, "Arm A");
  assert.equal(blocks[2].items[1].text, "10 mg");
  assert.equal(blocks[2].items[1].level, 1);
  const table = blocks[3];
  assert.equal(table.rows, 3);
  assert.equal(table.cols, 2);
  assert.equal(table.headerRows, 1);
  assert.equal(table.method, "llamaparse");
  assert.equal(table.cells[0].text, "Arm");
  assert.equal(table.cells[0].colSpan, 2);
  assert.equal(table.cells[0].header, true);
  assert.equal(table.cells[1].text, "10 mg");
  assert.equal(table.cells[2].text, "12");
  assert.equal(table.cells[2].rowSpan, 2);
  assert.equal(table.cells[3].text, "20 mg");
  assert.deepEqual(table.cells[0].bbox, [72, 200, 312, 216]);
  assert.deepEqual(table.cells[2].bbox, [152, 216, 232, 248]);
  assert.equal(blocks[4].image.source, "llamaparse");
  assert.equal(blocks[4].caption, blocks[5].id);
  assert.equal(blocks[5].for, blocks[4].id);
  assert.equal(blocks[5].text, "Figure 1. Kaplan-Meier.");
  assert.equal(table.fromChart, undefined);
});

test("a layout image becomes a figure, and a chart table keeps its cells", () => {
  assert.equal(layoutImagePage("page_1_chart_1_v2.jpg", [10]), 10);
  assert.equal(layoutImagePage("page_1_chart_1_v2.jpg", [10, 11]), 10);
  assert.equal(layoutImagePage("page_2_chart_1_v2.jpg", [10, 11]), 11);
  assert.equal(layoutImagePage("page_10_chart_1_v2.jpg", [10, 11]), 10);
  assert.equal(layoutImagePage("page_11_chart_1_v2.jpg", [10, 11]), 11);
  assert.equal(layoutImagePage("page_2_chart_1_v2.jpg", [2, 10]), 2);
  const provider = {
    _synthetic: true,
    items: {
      pages: [{
        page_number: 10,
        page_width: 610,
        page_height: 792,
        success: true,
        items: [
          { type: "header", value: "N.A.C.A.", bbox: [{ x: 89, y: 45, w: 200, h: 12, label: "header" }] },
          { type: "text", value: "Fig. 2", bbox: [{ x: 486, y: 51, w: 40, h: 16, label: "header" }] },
          { type: "heading", level: 1, value: "Inside the chart", bbox: [{ x: 200, y: 249, w: 250, h: 40, label: "paragraph_title" }] },
          {
            type: "table",
            html: "<table><tr><th>Angle</th><th>CL</th></tr><tr><td>0</td><td>0.75</td></tr></table>",
            rows: [["Angle", "CL"], ["0", "0.75"]],
            parse_concerns: [{ type: "layout_lvm_disagreement", details: "layout detected [chart] but no table" }],
          },
          {
            type: "text",
            value: "Fig. 2 Characteristics of propeller section of camber .12",
            bbox: [{ x: 77, y: 683.47, w: 423.2, h: 22.99, label: "caption" }],
          },
        ],
      }],
    },
    images_content_metadata: {
      images: [{
        filename: "page_1_chart_1_v2.jpg",
        category: "layout",
        bbox: { x: 54, y: 79, w: 504, h: 611 },
      }],
    },
  };
  const doc = llamaparseToParse(provider, { tier: "agentic" });
  assert.equal(validateParse(doc).ok, true);
  assert.equal(doc.pages[0].n, 10);
  const blocks = doc.order.map((id) => doc.blocks[id]);
  const figure = blocks.find((block) => block.type === "figure");
  const caption = blocks.find((block) => block.type === "caption");
  const table = blocks.find((block) => block.type === "table");
  assert.deepEqual(figure.bbox, [54, 79, 558, 690]);
  assert.equal(figure.page, 10);
  assert.equal(figure.image.source, "llamaparse");
  assert.equal(figure.image.kind, "crop");
  assert.equal(figure.caption, caption.id);
  assert.equal(caption.for, figure.id);
  assert.equal(caption.text, "Fig. 2 Characteristics of propeller section of camber .12");
  assert.deepEqual(caption.bbox, [77, 683.47, 500.2, 706.46]);
  assert.equal(table.fromChart, true);
  assert.equal(table.rows, 2);
  assert.equal(table.cells[0].text, "Angle");
  assert.equal(blocks.some((block) => block.type === "para" && block.text === "Fig. 2"), true);
  assert.equal(blocks.some((block) => block.type === "heading" && block.text === "Inside the chart"), true);
  assert.equal(caption.text === "Inside the chart", false);
  assert.equal(figure.image.layout, true);
  assert.equal(JSON.stringify(doc).includes("presigned"), false);
});

test("a cell rowspan past the table is clamped instead of failing the schema", () => {
  const row = (cells) => `<tr>${cells}</tr>`;
  const body = [
    row("<th>x</th>"),
    ...Array.from({ length: 30 }, (_, i) => row(`<td>${i}</td>`)),
    row('<td rowspan="2">last</td>'),
  ].join("");
  const tiny = { type: "table", html: "<table><tr><td>a</td></tr></table>" };
  const provider = {
    items: {
      pages: [{
        page_number: 13,
        page_width: 612,
        page_height: 792,
        success: true,
        items: [tiny, tiny, tiny, { type: "table", html: `<table>${body}</table>` }],
      }],
    },
  };
  const doc = llamaparseToParse(provider, { tier: "agentic" });
  assert.equal(validateParse(doc).ok, true);
  const table = doc.blocks.t4;
  assert.equal(table.rows, 32);
  const last = table.cells.find((cell) => cell.text === "last");
  assert.equal(last.r, 31);
  assert.equal(last.c, 0);
  assert.equal(last.rowSpan, 1);
});

test("the helper is told which pages to parse", async () => {
  let options = null;
  await parseCloud({
    fetch: async (url, init = {}) => {
      options = JSON.parse(init.headers["X-Pxd-Options"]);
      return {
        status: 200,
        body: {
          getReader() {
            let sent = false;
            return { async read() {
              if (sent) return { done: true };
              sent = true;
              return { done: false, value: new TextEncoder().encode('event: result\ndata: {"items":{"pages":[]}}\n\n') };
            } };
          },
        },
      };
    },
    transport: { kind: "helper", url: "http://127.0.0.1:9", token: "helper-token" },
    bytes: new Uint8Array([1]),
    apiKey: "test-cloud-key",
    pages: "4",
    confirmed: true,
  });
  assert.equal(options.pages, "4");
  assert.equal(options.tier, "agentic");
});

test("a stored cloud parse is what reopens, and a builtin-only lookup stays builtin", async () => {
  const store = createParseStore({ now: () => 1 });
  const plain = { ocr: "none", formula: false, tables: "builtin" };
  await store.indexUrl("paper.pdf", { sha256: "sha", pageCount: 1 });
  await store.putParse({
    schema: "pxd-parse/1", sha256: "sha", engine: "builtin", parseRev: PARSE_REV,
    options: plain, pages: [{ n: 1 }], blocks: {}, order: [], title: "Built-in",
  });
  await store.putParse({
    schema: "pxd-parse/1", sha256: "sha", engine: "cloud",
    options: { provider: "llamaparse", tier: "agentic", region: "us", ocr: "none", formula: false, tables: "llamaparse" },
    pages: [{ n: 1 }], blocks: {}, order: [], title: "Cloud",
  });
  assert.equal((await restorableByUrl(store, "paper.pdf", { plainOptions: plain })).title, "Cloud");
  assert.equal((await restorableByUrl(store, "paper.pdf", { plainOptions: plain, engines: ["builtin"] })).title, "Built-in");
});

test("the engine chip names LlamaParse", () => {
  assert.equal(engineChip({ engine: "cloud" }).text, "LlamaParse");
  assert.equal(engineChip({ engine: "cloud", ms: 1500 }).text, "LlamaParse · 1.5 s");
  assert.equal(engineChip({ phase: "running", engine: "cloud", page: 1, pageCount: 4 }).detail, "LlamaParse");
  assert.equal(engineChip({ engine: "cloud", provider: "mistral" }).text, "Mistral OCR");
  assert.equal(engineChip({ phase: "running", engine: "cloud", provider: "mistral", page: 1, pageCount: 2 }).detail, "Mistral OCR");
});

test("LlamaParse route is helper, then the saved relay, then the hosted default", () => {
  assert.equal(DEFAULT_RELAY_URL, "https://plexus-cloud-relay.svyk.workers.dev");
  assert.equal(llamaRoute({ key: "test-cloud-key" }, { state: "ready", engines: ["docling", "ocr", "cloud"] }), "helper");
  assert.equal(llamaRoute({ key: "test-cloud-key", relay: "https://mine.example" }, { state: "ready", engines: ["ocr"] }), "your relay");
  assert.equal(resolveCloudTransport({
    helper: { state: "ready", url: "http://127.0.0.1:48765", token: "t", engines: ["ocr"] },
    relayUrl: "",
    defaultRelay: "https://hosted.example",
  }).url, "https://hosted.example");
  assert.equal(resolveCloudTransport({ relayUrl: "https://mine.example/", defaultRelay: "https://hosted.example" }).url, "https://mine.example");
  const none = resolveCloudTransport({ relayUrl: "", defaultRelay: "" });
  assert.equal(none.kind, "none");
  assert.match(none.reason, /cloud engine/);
});

test("the Mistral key stays in its own localStorage slot", () => {
  const storage = memory();
  const graph = [];
  writeCloudPrefs(storage, { key: "test-cloud-key" });
  assert.equal(writeMistralKey(storage, "test-mistral-key"), "test-mistral-key");
  assert.equal(readMistralKey(storage), "test-mistral-key");
  assert.equal(storage.getItem(CLOUD_STORAGE.mistralKey), "test-mistral-key");
  assert.equal(storage.getItem(CLOUD_STORAGE.key), "test-cloud-key");
  writeMistralKey(storage, null);
  assert.equal(readMistralKey(storage), "test-mistral-key");
  writeCloudPrefs(storage, { key: "" });
  assert.equal(readMistralKey(storage), "test-mistral-key");
  assert.equal(graph.length, 0);
  const est = estimateMistralCost({ pages: 2 });
  assert.equal(est.usd, 0.008);
  assert.match(mistralConfirmMessage({ pages: 2 }), /Mistral OCR/);
  assert.match(mistralConfirmMessage({ pages: 2 }), /\$4 \/ 1,000 pages, model card checked 2026-10-09/);
  assert.match(mistralConfirmMessage({ pages: 2 }), /leaves this device/);
});

test("parseMistral posts one OCR request and maps 401, 429, timeout, and cancel", async () => {
  let called = 0;
  await assert.rejects(
    () => parseMistral({
      fetch: () => { called += 1; throw new Error("fetch"); },
      bytes: new Uint8Array([1]),
      apiKey: "test-mistral-key",
      confirmed: false,
    }),
    (error) => error.code === "confirm",
  );
  assert.equal(called, 0);

  const calls = [];
  const ok = await parseMistral({
    fetch: async (url, init) => {
      calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return jsonRes(200, { pages: [], model: "mistral-ocr-latest" });
    },
    bytes: new Uint8Array([1, 2, 3]),
    apiKey: "test-mistral-key",
    pages: "1,3",
    confirmed: true,
  });
  assert.equal(ok.transport, "direct");
  assert.equal(calls[0].url, "https://api.mistral.ai/v1/ocr");
  assert.equal(calls[0].headers.Authorization, "Bearer test-mistral-key");
  assert.equal(calls[0].body.model, "mistral-ocr-latest");
  assert.equal(calls[0].body.table_format, "html");
  assert.equal(calls[0].body.extract_header, true);
  assert.equal(calls[0].body.include_blocks, true);
  assert.equal(calls[0].body.include_image_base64, false);
  assert.deepEqual(calls[0].body.pages, [0, 2]);
  assert.match(calls[0].body.document.document_url, /^data:application\/pdf;base64,/);
  assert.equal(calls[0].body.document.document_url.includes("test-mistral-key"), false);

  await assert.rejects(
    () => parseMistral({
      fetch: async () => jsonRes(401, { message: "bad key" }),
      bytes: new Uint8Array([1]),
      apiKey: "test-mistral-key",
      confirmed: true,
    }),
    (error) => error.code === "unauthorized" && error.status === 401,
  );
  await assert.rejects(
    () => parseMistral({
      fetch: async () => jsonRes(429, { message: "slow down" }),
      bytes: new Uint8Array([1]),
      apiKey: "test-mistral-key",
      confirmed: true,
    }),
    (error) => error.code === "rate" && error.status === 429,
  );

  await assert.rejects(
    () => parseMistral({
      fetch: (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
      bytes: new Uint8Array([1]),
      apiKey: "test-mistral-key",
      confirmed: true,
      timeoutMs: 15,
    }),
    (error) => error.code === "timeout" && error.status === 504,
  );

  const ctrl = new AbortController();
  await assert.rejects(
    () => parseMistral({
      fetch: async (url, init) => {
        ctrl.abort();
        const error = new Error("aborted");
        error.name = "AbortError";
        if (init.signal.aborted || ctrl.signal.aborted) throw error;
        return jsonRes(200, { pages: [] });
      },
      bytes: new Uint8Array([1]),
      apiKey: "test-mistral-key",
      confirmed: true,
      signal: ctrl.signal,
    }),
    (error) => error.code === "cancelled",
  );
});

test("the engines sheet saves a Mistral key without a graph write", async () => {
  const stub = createDomStub();
  const parent = stub.document.createElement("div");
  const storage = memory();
  const settings = [];
  const graph = [];
  const panel = renderEnginesPanel(stub.document, parent, {
    storage,
    setSetting: async (id) => { settings.push(id); graph.push(id); },
    toast: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    client: { status: async () => ({ state: "ready", engines: ["docling", "ocr", "cloud"] }) },
  });
  await until(() => panel.el.querySelector('[data-action="cloud-setup"]'));
  panel.el.querySelector('[data-action="cloud-setup"]').click();
  panel.el.querySelector("[data-cloud-key]").value = "test-cloud-key";
  panel.el.querySelector("[data-mistral-key]").value = "test-mistral-key";
  panel.el.querySelector('[data-action="cloud-save"]').click();
  await until(() => storage.getItem("pxd-cloud-mistral-key") === "test-mistral-key");
  assert.deepEqual(settings, []);
  assert.deepEqual(graph, []);
  assert.equal(storage.getItem("pxd-cloud-key"), "test-cloud-key");
  const rowText = () => panel.el.querySelector('[data-row="cloud"]')?.querySelector(".pxd-engines__text")?.textContent || "";
  await until(() => /Mistral OCR: key saved/.test(rowText()));
  assert.match(rowText(), /helper/);
  const labels = [...panel.el.querySelectorAll(".pxd-engines__sheet-title")].map((node) => node.textContent);
  assert.deepEqual(labels, ["Cloud", "Mistral OCR"]);
  panel.dispose();
});

test("Read with Mistral OCR confirms before fetch and does not store the key on the graph", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const storage = memory();
  writeMistralKey(storage, "test-mistral-key");
  const log = [];
  const graph = [];
  try {
    const view = createParseView({
      doc: stub.document,
      storage,
      getPdf: async () => ({
        numPages: 2,
        getData: async () => { log.push("bytes"); return new Uint8Array([9]); },
      }),
      fetch: () => { log.push("fetch"); throw new Error("fetch"); },
      session: { insertParsed: () => { graph.push("write"); } },
    });
    const menu = [...view.element().querySelectorAll(".pxd-parse__pop button")].map((node) => node.textContent);
    const llamaAt = menu.indexOf("Read with LlamaParse");
    const mistralAt = menu.indexOf("Read with Mistral OCR");
    assert.ok(llamaAt >= 0 && mistralAt > llamaAt);
    stub.document.body.append(view.element());
    view.element().querySelector(".pxd-parse__mistral").click();
    await until(() => view.element().querySelector(".pxd-cloud-confirm"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const sheet = view.element().querySelector(".pxd-cloud-confirm");
    assert.equal(sheet.querySelector("[data-cloud-provider]").textContent, "Mistral OCR");
    assert.match(sheet.querySelector("[data-cloud-pages]").textContent, /2 pages/);
    assert.match(sheet.textContent, /\$4 \/ 1,000 pages, model card checked 2026-10-09/);
    assert.match(sheet.textContent, /leaves this device/);
    assert.equal(log.length, 0);
    assert.equal(graph.length, 0);
    assert.equal(readMistralKey(storage), "test-mistral-key");
  } finally {
    restore();
  }
});

test("a synthetic Mistral response becomes pxd-parse/1", () => {
  assert.equal(mistralFixture._synthetic, true);
  const doc = mistralToParse(mistralFixture, { sha256: "abc" });
  assert.equal(validateParse(doc).ok, true);
  assert.equal(doc.schema, "pxd-parse/1");
  assert.equal(doc.engine, "cloud");
  assert.equal(doc.engineVersion, "mistral-ocr-latest");
  assert.equal(doc.options.provider, "mistral");
  assert.equal(doc.options.tables, "mistral");
  assert.equal(doc.title, "Trial results");
  assert.equal(doc.pages[0].n, 1);
  assert.equal(doc.pages[0].w, 612);
  assert.equal(doc.pages[0].h, 792);
  assert.equal(doc.pages[1].w, 1700);
  assert.equal(doc.pages[1].h, 2200);
  assert.equal(doc.removed[0].reason, "running-header");
  assert.equal(doc.removed[0].text, "Journal of Trials");
  assert.equal(doc.removed.some((row) => row.reason === "running-footer" && row.text === "1"), true);
  const blocks = doc.order.map((id) => doc.blocks[id]);
  assert.deepEqual(blocks.map((block) => block.type), ["heading", "para", "list", "table", "figure", "caption", "table", "figure", "caption"]);
  assert.equal(blocks[0].text, "Trial results");
  assert.deepEqual(blocks[0].bbox, [72, 72, 372, 96]);
  assert.equal(blocks[0].confidence, 0.91);
  assert.equal(blocks[2].items[0].text, "Arm A");
  assert.equal(blocks[2].items[1].text, "10 mg");
  assert.equal(blocks[2].items[1].level, 1);
  const table = blocks[3];
  assert.equal(table.method, "mistral");
  assert.equal(table.rows, 3);
  assert.equal(table.cols, 2);
  assert.equal(table.headerRows, 1);
  assert.equal(table.cells[0].text, "Arm");
  assert.equal(table.cells[0].colSpan, 2);
  assert.equal(table.cells[2].text, "12");
  assert.equal(table.cells[2].rowSpan, 2);
  assert.deepEqual(table.bbox, [72, 200, 312, 260]);
  assert.deepEqual(blocks[4].bbox, [72, 300, 272, 420]);
  assert.equal(blocks[4].image.source, "mistral");
  assert.equal(blocks[5].text, "Figure 1. Kaplan-Meier.");
  assert.equal(blocks[5].for, blocks[4].id);
  assert.equal(blocks[6].rows, 2);
  assert.equal(blocks[6].cols, 2);
  assert.equal(blocks[6].cells[0].text, "Arm");
  assert.equal(blocks[6].cells[3].text, "10 mg");
  assert.equal(blocks[8].text, "Figure 2. The chart.");
  assert.deepEqual(blocks[7].bbox, [80, 100, 400, 280]);
  assert.equal(JSON.stringify(doc).includes("synthetic-image"), false);
  const zero = mistralToParse({
    model: "mistral-ocr-latest",
    pages: [{ index: 0, markdown: "Hello", dimensions: { width: 10, height: 20 } }],
  });
  assert.equal(zero.pages[0].n, 1);
  assert.equal(zero.blocks[zero.order[0]].text, "Hello");
});

test("a table layout image is not a figure, and the heading above it stays the title", () => {
  assert.equal(layoutImageKind("page_1_table_1_v2.jpg"), "table");
  assert.equal(layoutImageKind("page_1_chart_1_v2.jpg"), "chart");
  assert.equal(layoutImageKind("page_1_screenshot_1.jpg"), "screenshot");
  const heading = "NOTIFIABLE DISEASES — Summary of reported cases per 100,000 population, United States, 1971-1980";
  const provider = {
    items: {
      pages: [{
        page_number: 1,
        page_width: 597.1,
        page_height: 404.9,
        success: true,
        items: [
          { type: "heading", level: 2, value: heading, bbox: [{ x: 186.89, y: 9.72, w: 304.52, h: 6.7, label: "caption" }] },
          {
            type: "table",
            html: "<table><tr><th>Disease</th><th>1980</th></tr><tr><td>Cholera</td><td>0</td></tr></table>",
            bbox: [{ x: 102.1, y: 17.41, w: 466.94, h: 317.44, label: "table" }],
          },
        ],
      }],
    },
    images_content_metadata: {
      images: [{ filename: "page_1_table_1_v2.jpg", category: "layout", bbox: { x: 102, y: 17, w: 467, h: 317 } }],
    },
  };
  const doc = llamaparseToParse(provider, { tier: "agentic" });
  assert.equal(validateParse(doc).ok, true);
  const blocks = doc.order.map((id) => doc.blocks[id]);
  assert.deepEqual(blocks.map((block) => block.type), ["heading", "table"]);
  assert.equal(blocks[0].text, heading);
  assert.equal(blocks[1].title, heading);
  assert.equal(blocks[1].fromChart, undefined);
  assert.deepEqual(blocks[1].bbox, [102.1, 17.41, 569.04, 334.85]);
  assert.match(parsedDocTitle(doc), /^NOTIFIABLE DISEASES/);
  const bare = llamaparseToParse({
    items: { pages: [{ page_number: 1, page_width: 600, page_height: 400, success: true, items: [
      { type: "table", html: "<table><tr><td>a</td><td>b</td></tr></table>" },
    ] }] },
    images_content_metadata: { images: [{ filename: "page_1_table_1_v2.jpg", category: "layout", bbox: { x: 40, y: 50, w: 400, h: 200 } }] },
  });
  const bareTable = bare.order.map((id) => bare.blocks[id]).find((block) => block.type === "table");
  assert.deepEqual(bareTable.bbox, [40, 50, 440, 250]);
  assert.equal(bare.order.some((id) => bare.blocks[id].type === "figure"), false);
});

test("an unknown layout image is a figure only when no table covers it", () => {
  const provider = {
    items: { pages: [{
      page_number: 1, page_width: 600, page_height: 800, success: true,
      items: [
        { type: "table", html: "<table><tr><td>a</td></tr></table>", bbox: [{ x: 40, y: 40, w: 200, h: 200, label: "table" }] },
        { type: "text", value: "Table 2. Rates by year", bbox: [{ x: 40, y: 250, w: 180, h: 16 }] },
      ],
    }] },
    images_content_metadata: { images: [
      { filename: "page_1_screenshot_1_v2.jpg", category: "layout", bbox: { x: 40, y: 40, w: 200, h: 200 } },
      { filename: "page_1_mark_1_v2.jpg", category: "layout", bbox: { x: 360, y: 500, w: 160, h: 140 } },
    ] },
  };
  const doc = llamaparseToParse(provider);
  const blocks = doc.order.map((id) => doc.blocks[id]);
  const figures = blocks.filter((block) => block.type === "figure");
  assert.equal(figures.length, 1);
  assert.deepEqual(figures[0].bbox, [360, 500, 520, 640]);
  assert.equal(blocks.some((block) => block.type === "caption" && block.text.startsWith("Table 2")), false);
});

test("hybrid figures keep a local match, add a miss, and drop a layout figure on a table", () => {
  const cloud = {
    schema: "pxd-parse/1", engine: "cloud", pageCount: 1,
    pages: [{ n: 1, w: 600, h: 800, parsed: true }],
    order: ["f1", "c1", "f2", "t1"],
    blocks: {
      f1: { id: "f1", type: "figure", page: 1, bbox: [10, 10, 200, 200], caption: "c1", image: { kind: "crop", source: "llamaparse", layout: true }, confidence: 0.9, engine: "cloud" },
      c1: { id: "c1", type: "caption", page: 1, bbox: [10, 200, 200, 220], text: "Fig. 1 short", for: "f1", confidence: 0.9, engine: "cloud" },
      f2: { id: "f2", type: "figure", page: 1, bbox: [300, 300, 500, 500], caption: null, image: { kind: "crop", source: "llamaparse", layout: true }, confidence: 0.9, engine: "cloud" },
      t1: { id: "t1", type: "table", page: 1, bbox: [300, 300, 500, 500], rows: 1, cols: 1, cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "a" }], confidence: 0.9, engine: "cloud" },
    },
  };
  const local = {
    schema: "pxd-parse/1", engine: "builtin", pageCount: 1,
    pages: [{ n: 1, w: 600, h: 800, parsed: true }],
    order: ["f9", "c9", "f8", "c8"],
    blocks: {
      f9: { id: "f9", type: "figure", page: 1, bbox: [12, 12, 198, 198], caption: "c9", image: { kind: "crop", source: "drawing" }, confidence: 0.9, engine: "builtin" },
      c9: { id: "c9", type: "caption", page: 1, bbox: [12, 202, 190, 230], text: "Fig. 1 The local caption is longer", for: "f9", confidence: 0.9, engine: "builtin" },
      f8: { id: "f8", type: "figure", page: 1, bbox: [20, 600, 120, 760], caption: "c8", image: { kind: "crop", source: "drawing" }, confidence: 0.9, engine: "builtin" },
      c8: { id: "c8", type: "caption", page: 1, bbox: [20, 762, 140, 780], text: "Fig. 3 missed", for: "f8", confidence: 0.9, engine: "builtin" },
    },
  };
  assert.equal(mergeCloudFigures(cloud, null), cloud);
  const merged = mergeCloudFigures(cloud, local);
  assert.equal(validateParse(merged).ok, true);
  const figures = merged.order.map((id) => merged.blocks[id]).filter((block) => block.type === "figure");
  assert.equal(figures.length, 2);
  const hybrid = figures.find((block) => block.source === "hybrid");
  const added = figures.find((block) => block.source === "local");
  assert.deepEqual(hybrid.bbox, [12, 12, 198, 198]);
  assert.equal(merged.blocks[hybrid.caption].text, "Fig. 1 The local caption is longer");
  assert.equal(added.page, 1);
  assert.deepEqual(added.bbox, [20, 600, 120, 760]);
  assert.equal(merged.blocks[added.caption].text, "Fig. 3 missed");
  assert.equal(figures.some((block) => block.id === "f2"), false);
  const plain = { engine: "builtin", options: { ocr: "none" }, pages: [{ n: 1 }] };
  const browser = { engine: "builtin", options: { ocr: "vision" }, ocr: { source: "browser" }, pages: [{ n: 1, ocr: true }] };
  const helper = { engine: "builtin", options: { ocr: "vision" }, ocr: { source: "helper", pages: [1] }, pages: [{ n: 1, ocr: true }] };
  assert.equal(bestLocalDoc([
    { engine: "builtin", doc: plain, at: 5 },
    { engine: "builtin", doc: browser, at: 4 },
    { engine: "builtin", doc: helper, at: 1 },
    { engine: "cloud", doc: { engine: "cloud", title: "Paid" }, at: 9 },
  ]), helper);
  assert.equal(bestLocalDoc([{ engine: "builtin", doc: plain, at: 1 }]), plain);
});

test("a cloud read with no title keeps the title the PDF already has", async () => {
  assert.equal(nextParsedTitle("Notifiable diseases summary", ""), "Notifiable diseases summary");
  assert.equal(nextParsedTitle("Notifiable diseases summary", "A better cloud title"), "A better cloud title");
  assert.equal(nextParsedTitle("", ""), "");
  const local = {
    schema: "pxd-parse/1", engine: "builtin",
    order: ["h1"],
    blocks: { h1: { id: "h1", type: "heading", level: 1, page: 1, text: "Notifiable diseases summary" } },
  };
  const cloud = { schema: "pxd-parse/1", engine: "cloud", title: null, order: [], blocks: {} };
  assert.equal(withKeptTitle(cloud, local).title, "Notifiable diseases summary");
  assert.equal(withKeptTitle({ ...cloud, title: "Cloud title from the read" }, local).title, "Cloud title from the read");
  const store = createParseStore({ now: () => 1 });
  const plain = { ocr: "none", formula: false, tables: "builtin" };
  await store.indexUrl("scan.pdf", { sha256: "sha2", pageCount: 1 });
  await store.putParse({
    schema: "pxd-parse/1", sha256: "sha2", engine: "builtin", parseRev: PARSE_REV,
    options: plain, pages: [{ n: 1 }], order: ["h1"],
    blocks: { h1: { id: "h1", type: "heading", level: 1, page: 1, text: "Notifiable diseases summary" } },
  });
  await store.putParse({
    schema: "pxd-parse/1", sha256: "sha2", engine: "cloud", title: null,
    options: { provider: "llamaparse", tier: "agentic", region: "us", ocr: "none", formula: false, tables: "llamaparse" },
    pages: [{ n: 1 }], blocks: {}, order: [],
  });
  const found = await restorableTitle(store, "scan.pdf", plain);
  assert.equal(found.doc.engine, "cloud");
  assert.equal(found.title, "Notifiable diseases summary");
});
