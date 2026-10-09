// Cloud confirm sheet: in the outline, keyboard, tier, page scope, usage, cancel, Mistral 429.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CLOUD_CACHE_NOTE,
  CLOUD_LEAVES_NOTE,
  MISTRAL_DISABLED_MESSAGE,
  MISTRAL_RATE_MESSAGE,
  cloudUsageCredits,
  defaultCloudScope,
  mistral429Message,
  parseCloud,
  parseMistral,
} from "../src/host/cloud-parse.js";
import { createParseView, engineChip } from "../src/view/parse-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const until = async (cond, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(Boolean(cond()), true);
};

function memory() {
  const bag = new Map();
  return {
    getItem: (id) => (bag.has(id) ? bag.get(id) : null),
    setItem: (id, value) => { bag.set(id, String(value)); },
  };
}

function jsonRes(status, body, headers = {}) {
  return {
    status,
    headers: {
      get(name) {
        const key = String(name || "").toLowerCase();
        return headers[key] ?? null;
      },
    },
    json: async () => body,
  };
}

function keydownCount(win) {
  return [...(win.listeners?.get("keydown")?.values() || [])].length;
}

test("cloud page scope defaults to this page only past 10 pages", () => {
  assert.equal(defaultCloudScope(10), "all");
  assert.equal(defaultCloudScope(11), "current");
  assert.equal(defaultCloudScope(0), "all");
  assert.equal(defaultCloudScope(undefined), "all");
});

test("Mistral 429 names a workspace with 0 requests per minute", () => {
  const headers = (value) => ({ headers: { get: (name) => (String(name).toLowerCase() === "x-ratelimit-limit-req-minute" ? value : null) } });
  assert.equal(mistral429Message(headers("0"), { message: "slow down" }), MISTRAL_DISABLED_MESSAGE);
  assert.equal(mistral429Message(headers("30"), { code: "1300", message: "0 requests per minute" }), MISTRAL_RATE_MESSAGE);
  assert.equal(mistral429Message({}, { code: "1300", message: "0 requests per minute" }), MISTRAL_DISABLED_MESSAGE);
  assert.equal(mistral429Message({}, { code: "1300", message: "Limit is 0" }), MISTRAL_DISABLED_MESSAGE);
  assert.equal(mistral429Message({}, { code: "1300", message: "Rate limit exceeded" }), MISTRAL_RATE_MESSAGE);
  assert.equal(mistral429Message({}, { message: "0 requests per minute" }), MISTRAL_RATE_MESSAGE);
});

test("the confirm sheet is in the outline, traps focus, and does not keep a key listener", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const storage = memory();
  storage.setItem("pxd-cloud-key", "test-cloud-key");
  storage.setItem("pxd-cloud-tier", "agentic");
  storage.setItem("pxd-cloud-region", "eu");
  storage.setItem("pxd-cloud-relay", "https://relay.example");
  const fetches = [];
  try {
    const view = createParseView({
      doc: stub.document,
      storage,
      pageNow: () => 4,
      getPdf: async () => ({ numPages: 3, getData: async () => new Uint8Array([1]) }),
      fetch: () => { fetches.push(1); return jsonRes(401, { detail: "no" }); },
    });
    stub.document.body.append(view.element());
    const seen = [];
    const spy = (event) => seen.push(event.key);
    stub.window.addEventListener("keydown", spy);
    const before = keydownCount(stub.window);
    view.element().querySelector(".pxd-parse__cloud").click();
    await until(() => view.element().querySelector(".pxd-cloud-confirm"));
    const sheet = view.element().querySelector(".pxd-cloud-confirm");
    assert.equal(sheet.parentElement, view.element());
    assert.equal(sheet.getAttribute("role"), "dialog");
    assert.equal(sheet.querySelector("img, svg"), null);
    assert.equal(sheet.querySelector("[data-cloud-provider]").textContent, "LlamaParse");
    assert.equal(sheet.querySelector("[data-cloud-region]").textContent, "Region · EU");
    assert.equal(sheet.querySelector("[data-cloud-cache]").textContent, CLOUD_CACHE_NOTE);
    assert.equal(sheet.querySelector("[data-cloud-leaves]").textContent, CLOUD_LEAVES_NOTE);
    assert.equal(sheet.querySelector('[data-tier="agentic"]').getAttribute("aria-checked"), "true");
    assert.match(sheet.querySelector('[data-tier="fast"]').textContent, /1 credit/);
    assert.match(sheet.querySelector('[data-tier="fast"]').textContent, /\$0\.00125/);
    assert.match(sheet.querySelector('[data-tier="agentic"]').textContent, /10 credits/);
    assert.match(sheet.querySelector('[data-scope="all"]').textContent, /All 3 pages/);
    assert.equal(sheet.querySelector('[data-scope="all"]').getAttribute("aria-checked"), "true");
    assert.equal(keydownCount(stub.window), before + 1);
    assert.equal(fetches.length, 0);
    const send = sheet.querySelector("[data-cloud-send]");
    assert.equal(stub.document.activeElement, send);
    send.dispatchEvent({ type: "keydown", key: "Tab" });
    assert.equal(stub.document.activeElement, sheet.querySelector("[data-tier]"));
    send.focus();
    send.dispatchEvent({ type: "keydown", key: "Tab", shiftKey: true });
    assert.equal(stub.document.activeElement, sheet.querySelector("[data-cloud-cancel]"));
    stub.document.body.dispatchEvent({ type: "keydown", key: "x" });
    assert.deepEqual(seen, []);
    const escaped = send.dispatchEvent({ type: "keydown", key: "Escape" });
    assert.equal(escaped.defaultPrevented, true);
    await until(() => !view.element().querySelector(".pxd-cloud-confirm"));
    assert.equal(keydownCount(stub.window), before);
    assert.equal(fetches.length, 0);
    stub.document.body.dispatchEvent({ type: "keydown", key: "x" });
    assert.deepEqual(seen, ["x"]);
    const after = stub.document.body.dispatchEvent({ type: "keydown", key: "Escape" });
    assert.equal(after.defaultPrevented, false);
    stub.window.removeEventListener("keydown", spy);
  } finally {
    restore();
  }
});

test("Enter sends, a tier is remembered, and this page reaches LlamaParse target_pages", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const storage = memory();
  storage.setItem("pxd-cloud-key", "test-cloud-key");
  storage.setItem("pxd-cloud-tier", "agentic");
  storage.setItem("pxd-cloud-region", "us");
  storage.setItem("pxd-cloud-relay", "https://relay.example");
  const calls = [];
  try {
    const view = createParseView({
      doc: stub.document,
      storage,
      pageNow: () => 4,
      getPdf: async () => ({
        numPages: 12,
        getData: async () => new Uint8Array([1, 2]),
      }),
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || "GET", body: init.body });
        if (String(url).endsWith("/files")) return jsonRes(200, { id: "file1" });
        return jsonRes(401, { detail: "stop" });
      },
      onToast: () => {},
    });
    stub.document.body.append(view.element());
    view.element().querySelector(".pxd-parse__cloud").click();
    await until(() => view.element().querySelector(".pxd-cloud-confirm"));
    const sheet = view.element().querySelector(".pxd-cloud-confirm");
    assert.equal(sheet.querySelector('[data-scope="current"]').getAttribute("aria-checked"), "true");
    assert.match(sheet.querySelector("[data-cloud-pages]").textContent, /12 pages/);
    assert.match(sheet.querySelector("[data-cloud-estimate]").textContent, /1 page, 10 credits, about \$0\.0125/);
    assert.equal(calls.length, 0);
    sheet.querySelector('[data-tier="cost_effective"]').click();
    assert.equal(storage.getItem("pxd-cloud-tier"), "cost_effective");
    assert.match(sheet.querySelector("[data-cloud-estimate]").textContent, /1 page, 3 credits/);
    sheet.querySelector("[data-cloud-cancel]").click();
    await until(() => !view.element().querySelector(".pxd-cloud-confirm"));
    assert.equal(calls.length, 0);
    assert.equal(storage.getItem("pxd-cloud-tier"), "cost_effective");

    view.element().querySelector(".pxd-parse__cloud").click();
    await until(() => view.element().querySelector(".pxd-cloud-confirm"));
    const again = view.element().querySelector(".pxd-cloud-confirm");
    assert.equal(again.querySelector('[data-tier="cost_effective"]').getAttribute("aria-checked"), "true");
    again.querySelector('[data-scope="all"]').click();
    assert.match(again.querySelector("[data-cloud-estimate]").textContent, /12 pages, 36 credits/);
    again.querySelector('[data-scope="current"]').click();
    again.querySelector("[data-cloud-send]").dispatchEvent({ type: "keydown", key: "Enter" });
    await until(() => calls.some((call) => call.method === "POST" && String(call.url).endsWith("/api/v2/parse")));
    const started = calls.find((call) => call.method === "POST" && String(call.body || "").startsWith("{"));
    const body = JSON.parse(started.body);
    assert.equal(body.tier, "cost_effective");
    assert.equal(body.page_ranges.target_pages, "4");
  } finally {
    restore();
  }
});

test("All pages omits target_pages, and Mistral sends a 0-based page", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const storage = memory();
  storage.setItem("pxd-cloud-key", "test-cloud-key");
  storage.setItem("pxd-cloud-relay", "https://relay.example");
  storage.setItem("pxd-cloud-mistral-key", "test-mistral-key");
  const llama = [];
  try {
    const view = createParseView({
      doc: stub.document,
      storage,
      pageNow: () => 2,
      getPdf: async () => ({ numPages: 8, getData: async () => new Uint8Array([1]) }),
      fetch: async (url, init = {}) => {
        llama.push({ url: String(url), method: init.method || "GET", body: init.body });
        if (String(url).endsWith("/files")) return jsonRes(200, { id: "file1" });
        return jsonRes(401, { detail: "stop" });
      },
      onToast: () => {},
    });
    stub.document.body.append(view.element());
    view.element().querySelector(".pxd-parse__cloud").click();
    await until(() => view.element().querySelector("[data-cloud-send]"));
    assert.equal(view.element().querySelector('[data-scope="all"]').getAttribute("aria-checked"), "true");
    view.element().querySelector("[data-cloud-send]").click();
    await until(() => llama.some((call) => String(call.body || "").startsWith("{")));
    const all = JSON.parse(llama.find((call) => String(call.body || "").startsWith("{")).body);
    assert.equal(all.page_ranges, undefined);
    view.dispose();
  } finally {
    restore();
  }

  const stub2 = createDomStub();
  const restore2 = stub2.install();
  const calls = [];
  try {
    const view = createParseView({
      doc: stub2.document,
      storage,
      pageNow: () => 4,
      getPdf: async () => ({ numPages: 12, getData: async () => new Uint8Array([9]) }),
      fetch: async (url, init = {}) => {
        calls.push(JSON.parse(init.body));
        return jsonRes(401, { message: "stop" });
      },
      onToast: () => {},
    });
    stub2.document.body.append(view.element());
    view.element().querySelector(".pxd-parse__mistral").click();
    await until(() => view.element().querySelector("[data-cloud-send]"));
    assert.equal(view.element().querySelector('[data-scope="current"]').getAttribute("aria-checked"), "true");
    assert.equal(view.element().querySelector("[data-tier]"), null);
    view.element().querySelector("[data-cloud-send]").click();
    await until(() => calls.length > 0);
    assert.deepEqual(calls[0].pages, [3]);
    assert.equal(calls[0].model, "mistral-ocr-latest");
  } finally {
    restore2();
  }
});

test("the parse chip tooltip shows LlamaParse usage credits", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const storage = memory();
  storage.setItem("pxd-cloud-key", "test-cloud-key");
  storage.setItem("pxd-cloud-relay", "https://relay.example");
  let t = 0;
  try {
    const view = createParseView({
      doc: stub.document,
      storage,
      clock: () => t,
      getPdf: async () => ({ numPages: 1, getData: async () => new Uint8Array([1]) }),
      fetch: async (url, init = {}) => {
        t = 2500;
        if (String(url).endsWith("/files")) return jsonRes(200, { id: "file1" });
        if (init.method === "POST") return jsonRes(200, { id: "job1", status: "COMPLETED" });
        return jsonRes(200, {
          job: { id: "job1", status: "COMPLETED", usage: { credits: 10 } },
          items: { pages: [] },
        });
      },
    });
    stub.document.body.append(view.element());
    view.element().querySelector(".pxd-parse__cloud").click();
    await until(() => view.element().querySelector("[data-cloud-send]"));
    view.element().querySelector("[data-cloud-send]").click();
    await until(() => view.chipText() === "LlamaParse · 2.5 s");
    const chip = view.element().querySelector(".pxd-parse__engine");
    assert.equal(chip.getAttribute("data-tip-extra"), "LlamaParse · 2.5 s · 10 credits");
    assert.equal(engineChip({ engine: "cloud", provider: "llamaparse", ms: 2500, credits: 10 }).tip, "LlamaParse · 2.5 s · 10 credits");
    assert.equal(engineChip({ engine: "cloud", provider: "llamaparse", ms: 2500, credits: 1 }).tip, "LlamaParse · 2.5 s · 1 credit");
    assert.equal(cloudUsageCredits({ job: { usage: { credits: 10 } } }), 10);
  } finally {
    restore();
  }
});

test("Cancel in the parse menu aborts a relay job and a helper job", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const storage = memory();
  storage.setItem("pxd-cloud-key", "test-cloud-key");
  storage.setItem("pxd-cloud-relay", "https://relay.example");
  const calls = [];
  const toasts = [];
  try {
    const view = createParseView({
      doc: stub.document,
      storage,
      getPdf: async () => ({ numPages: 1, getData: async () => new Uint8Array([1]) }),
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || "GET" });
        if (String(url).endsWith("/files")) return jsonRes(200, { id: "file1" });
        if (init.method === "POST" && String(url).endsWith("/api/v2/parse")) return jsonRes(200, { id: "job1", status: "PENDING" });
        if (String(url).endsWith("/cancel")) return jsonRes(200, {});
        return jsonRes(200, { status: "RUNNING", id: "job1" });
      },
      onToast: (message) => toasts.push(message),
    });
    stub.document.body.append(view.element());
    view.element().querySelector(".pxd-parse__cloud").click();
    await until(() => view.element().querySelector("[data-cloud-send]"));
    view.element().querySelector("[data-cloud-send]").click();
    await until(() => calls.some((call) => call.method === "POST" && call.url.endsWith("/api/v2/parse")));
    await new Promise((resolve) => setTimeout(resolve, 20));
    view.element().querySelector(".pxd-parse__engine").click();
    view.element().querySelector(".pxd-parse__cancel").click();
    await until(() => calls.some((call) => call.method === "POST" && call.url.endsWith("/api/v2/parse/job1/cancel")));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(toasts.length, 0);
    view.dispose();
  } finally {
    restore();
  }

  const stub2 = createDomStub();
  const restore2 = stub2.install();
  const helperCalls = [];
  try {
    const view = createParseView({
      doc: stub2.document,
      storage,
      helper: {
        health: async () => ({ state: "ready", engines: ["cloud"] }),
        endpoint: () => ({ url: "http://127.0.0.1:48765", token: "helper-token" }),
      },
      pageNow: () => 2,
      getPdf: async () => ({ numPages: 2, getData: async () => new Uint8Array([2]) }),
      fetch: async (url, init = {}) => {
        helperCalls.push({ url: String(url), method: init.method || "GET", options: init.headers?.["X-Pxd-Options"] });
        if (init.method === "DELETE") return jsonRes(204, {});
        const signal = init.signal;
        const encoder = new TextEncoder();
        return {
          status: 200,
          body: {
            getReader() {
              let sent = false;
              return {
                async read() {
                  if (!sent) {
                    sent = true;
                    return { done: false, value: encoder.encode('event: started\ndata: {"job":"c_abc"}\n\n') };
                  }
                  return new Promise((resolve, reject) => {
                    const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
                    if (signal?.aborted) { abort(); return; }
                    signal?.addEventListener?.("abort", abort, { once: true });
                  });
                },
              };
            },
          },
        };
      },
      onToast: (message) => toasts.push(message),
    });
    stub2.document.body.append(view.element());
    view.element().querySelector(".pxd-parse__cloud").click();
    await until(() => view.element().querySelector('[data-scope="current"]'));
    view.element().querySelector('[data-scope="current"]').click();
    view.element().querySelector("[data-cloud-send]").click();
    await until(() => helperCalls.some((call) => call.method === "POST"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    view.element().querySelector(".pxd-parse__engine").click();
    view.element().querySelector(".pxd-parse__cancel").click();
    await until(() => helperCalls.some((call) => call.method === "DELETE" && call.url.endsWith("/v1/cloud/parse/c_abc")));
    const posted = helperCalls.find((call) => call.method === "POST");
    assert.equal(JSON.parse(posted.options).pages, "2");
  } finally {
    restore2();
  }
});

test("a Mistral 429 with a 0 per minute limit says billing is off", async () => {
  const stopped = await parseMistral({
    fetch: async () => jsonRes(429, { code: "1300", message: "Rate limit exceeded" }),
    bytes: new Uint8Array([1]),
    apiKey: "test-mistral-key",
    confirmed: true,
  }).then(() => null, (error) => error);
  assert.equal(stopped.code, "rate");
  assert.equal(stopped.message, MISTRAL_RATE_MESSAGE);

  const hidden = await parseMistral({
    fetch: async () => jsonRes(429, { code: "1300", message: "0 requests per minute" }),
    bytes: new Uint8Array([1]),
    apiKey: "test-mistral-key",
    confirmed: true,
  }).then(() => null, (error) => error);
  assert.equal(hidden.message, MISTRAL_DISABLED_MESSAGE);

  const stub = createDomStub();
  const restore = stub.install();
  const storage = memory();
  storage.setItem("pxd-cloud-mistral-key", "test-mistral-key");
  const toasts = [];
  try {
    const view = createParseView({
      doc: stub.document,
      storage,
      getPdf: async () => ({ numPages: 1, getData: async () => new Uint8Array([1]) }),
      fetch: async () => jsonRes(429, { message: "slow down" }, { "x-ratelimit-limit-req-minute": "0" }),
      onToast: (message) => toasts.push(message),
    });
    stub.document.body.append(view.element());
    view.element().querySelector(".pxd-parse__mistral").click();
    await until(() => view.element().querySelector("[data-cloud-send]"));
    assert.equal(toasts.length, 0);
    view.element().querySelector("[data-cloud-send]").click();
    await until(() => toasts.length > 0);
    assert.equal(toasts.at(-1), MISTRAL_DISABLED_MESSAGE);
  } finally {
    restore();
  }
});

test("the confirm sheet selection is a border, not a fill", async () => {
  const css = await readFile(new URL("../src/css/parse.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-cloud-confirm__choice--on \{[^}]*border-color: var\(--pxd-border-strong\)/);
  assert.match(css, /\.pxd-cloud-confirm__choice--on \{[^}]*background: transparent/);
  assert.match(css, /var\(--pxd-chrome-bg\)/);
  assert.equal(CLOUD_LEAVES_NOTE, "The PDF leaves this device");
});
