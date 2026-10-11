import assert from "node:assert/strict";
import test from "node:test";

import * as liveai from "../src/host/liveai.js";

function fakeWindow(api) {
  const listeners = new Map();
  return {
    LiveAI_API: api,
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); },
    emit(type) { for (const fn of listeners.get(type) || []) fn(); },
    count(type) { return (listeners.get(type) || []).length; },
  };
}

const MODELS = [
  { id: "a", name: "Model A", provider: "X", isDefault: false },
  { id: "b", name: "Model B", provider: "Y", isDefault: true },
];

function api(over = {}) {
  return { version: "1.0", isAvailable: () => true, listModels: () => MODELS, getDefaultModel: () => "b", generate: async () => ({ text: "hi", model: "b", provider: "Y", usage: null }), ...over };
}

test("absent API: inert, no throw", async () => {
  const w = fakeWindow(undefined);
  assert.equal(liveai.available(w), false);
  assert.equal(liveai.present(w), false);
  assert.deepEqual(liveai.listModels(w), []);
  assert.equal(liveai.defaultModel(w), "");
  const res = await liveai.ask({ context: "c", prompt: "p", window: w });
  assert.equal(res.ok, false);
  assert.equal(res.code, "UNAVAILABLE");
  assert.match(res.error, /Enable Public API/);
});

test("available / models / default", () => {
  const w = fakeWindow(api());
  assert.equal(liveai.available(w), true);
  assert.deepEqual(liveai.listModels(w).map((m) => m.id), ["a", "b"]);
  assert.equal(liveai.defaultModel(w), "b");
  const noKey = fakeWindow(api({ isAvailable: () => false }));
  assert.equal(liveai.available(noKey), false);
  assert.equal(liveai.present(noKey), true);
  const broken = fakeWindow(api({ listModels: () => { throw new Error("x"); }, getDefaultModel: () => { throw new Error("x"); } }));
  assert.deepEqual(liveai.listModels(broken), []);
  assert.equal(liveai.defaultModel(broken), "");
});

test("ask passes caller, context, systemPrompt, model, signal and streams chunks", async () => {
  let seen = null;
  const w = fakeWindow(api({
    generate: async (options) => {
      seen = options;
      options.onChunk("he");
      options.onChunk("llo");
      return { text: "hello", model: "a", provider: "X", usage: { outputTokens: 2 } };
    },
  }));
  const chunks = [];
  const ctl = new AbortController();
  const res = await liveai.ask({ context: "CTX", prompt: "Q", systemPrompt: "SYS", model: "a", onChunk: (c) => chunks.push(c), signal: ctl.signal, window: w });
  assert.equal(seen.caller, "Plexus Diagram");
  assert.equal(seen.context, "CTX");
  assert.equal(seen.prompt, "Q");
  assert.equal(seen.systemPrompt, "SYS");
  assert.equal(seen.model, "a");
  assert.equal(seen.signal, ctl.signal);
  assert.equal(seen.roamContext, undefined);
  assert.deepEqual(chunks, ["he", "llo"]);
  assert.deepEqual({ ok: res.ok, text: res.text, model: res.model }, { ok: true, text: "hello", model: "a" });
});

test("error codes map to friendly messages", async () => {
  const cases = {
    RATE_LIMIT: /rate limited/i,
    INVALID_MODEL: /Pick another model/,
    NO_API_KEY: /no API key/,
    EMPTY_RESPONSE: /returned nothing/,
    PROVIDER_ERROR: /provider/i,
  };
  for (const [code, re] of Object.entries(cases)) {
    const w = fakeWindow(api({ generate: async () => { throw Object.assign(new Error(`[LiveAI_API] ${code}`), { code }); } }));
    const res = await liveai.ask({ prompt: "p", window: w });
    assert.equal(res.ok, false);
    assert.equal(res.code, code);
    assert.match(res.error, re);
  }
  const odd = fakeWindow(api({ generate: async () => { throw new Error("[LiveAI_API] Something odd"); } }));
  assert.equal((await liveai.ask({ prompt: "p", window: odd })).error, "Something odd");
  const abort = fakeWindow(api({ generate: async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); } }));
  assert.equal((await liveai.ask({ prompt: "p", window: abort })).error, "Stopped.");
});

test("onReady follows ready/unloaded events and cleans up", () => {
  const w = fakeWindow(undefined);
  const seen = [];
  const off = liveai.onReady((ok) => seen.push(ok), w);
  assert.deepEqual(seen, [false]);
  w.LiveAI_API = api();
  w.emit("liveai:api-ready");
  w.LiveAI_API = undefined;
  w.emit("liveai:api-unloaded");
  assert.deepEqual(seen, [false, true, false]);
  off();
  assert.equal(w.count("liveai:api-ready"), 0);
  assert.equal(w.count("liveai:api-unloaded"), 0);
  assert.equal(typeof liveai.onReady(null, w), "function");
});
