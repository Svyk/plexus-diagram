// P-ONBOARD. Helper client: status states, pair, model progress, nothing fetched at load.
import assert from "node:assert/strict";
import test from "node:test";

import { createHelperClient } from "../src/host/parse-helper-client.js";
import { SCHEMA } from "../src/model/parse-schema.js";

const ready = { helper: "plexus-parse-helper", version: "0.1.0", schema: SCHEMA, models: { layout: "ready", tableformer: "ready", ocr: "ready" }, busy: 0 };
const missing = { ...ready, models: { layout: "missing", tableformer: "missing", ocr: "ready" } };

const KEY = "plexus-diagram:parse-helper-token";

function memoryStorage(initial) {
  const local = new Map(initial ? [[KEY, initial]] : []);
  const storage = { getItem: (k) => (local.has(k) ? local.get(k) : null), setItem: (k, v) => { local.set(k, String(v)); }, removeItem: (k) => { local.delete(k); } };
  return { local, storage };
}

function make(handler, { token = "", clock = () => 0 } = {}) {
  const { local, storage } = memoryStorage(token);
  const store = { get "parse-helper-token"() { return local.get(KEY) ?? ""; } };
  const calls = [];
  const api = createHelperClient({
    fetch: async (url, init = {}) => {
      calls.push({ url, method: init.method || "GET", headers: init.headers, targetAddressSpace: init.targetAddressSpace });
      return handler(url, init, calls);
    },
    now: clock,
    settings: () => ({}),
    storage,
  });
  return { api, calls, store };
}

const res = (status, body) => ({ status, json: async () => body });

test("creating the client fetches nothing", () => {
  const { calls } = make(() => { throw new Error("no fetch"); });
  assert.equal(calls.length, 0);
});

test("status without a token: not-installed when nothing answers, not-paired when the helper answers 401", async () => {
  const off = make(() => { throw new Error("refused"); });
  assert.deepEqual(await off.api.status(), { state: "not-installed", paired: false });
  assert.equal(off.calls[0].url, "http://127.0.0.1:48765/v1/health");
  assert.equal(off.calls[0].headers, undefined);
  assert.equal(off.calls[0].targetAddressSpace, "loopback");

  const other = make(() => res(200, { hello: "world" }));
  assert.equal((await other.api.status()).state, "not-installed");

  const up = make(() => res(401, { helper: "plexus-parse-helper", auth: "required" }));
  assert.deepEqual(await up.api.status(), { state: "not-paired", paired: false });
});

test("status with a token: not-running, wrong-token, newer-schema, ready", async () => {
  const down = make(() => { throw new Error("refused"); }, { token: "t" });
  assert.deepEqual(await down.api.status(), { state: "not-running", paired: true });
  const wrong = make(() => res(401, { helper: "plexus-parse-helper" }), { token: "t" });
  assert.equal((await wrong.api.status()).state, "wrong-token");
  const newer = make(() => res(200, { ...ready, schema: "pxd-parse/2" }), { token: "t" });
  assert.equal((await newer.api.status()).state, "newer-schema");
  const ok = make(() => res(200, ready), { token: "t" });
  const s = await ok.api.status();
  assert.equal(s.state, "ready");
  assert.equal(s.version, "0.1.0");
  assert.equal(s.paired, true);
});

test("status reports missing models, then downloading with progress from /v1/models", async () => {
  let phase = "idle";
  const { api, calls } = make((url) => {
    if (url.endsWith("/v1/health")) return res(200, missing);
    if (url.endsWith("/v1/models")) {
      return phase === "idle"
        ? res(200, { state: "missing", items: [], bytes: 506 * 1048576, done: 0, fraction: 0 })
        : res(200, { state: "downloading", items: [], bytes: 1000, done: 250, fraction: 0.25 });
    }
    throw new Error(url);
  }, { token: "t" });
  const idle = await api.status({ force: true });
  assert.equal(idle.state, "models-missing");
  assert.equal(idle.progress.bytes, 506 * 1048576);
  phase = "busy";
  const busy = await api.status({ force: true });
  assert.equal(busy.state, "downloading");
  assert.deepEqual(busy.progress, { bytes: 1000, done: 250, fraction: 0.25 });
  assert.ok(calls.every((c) => c.headers?.Authorization === "Bearer t"));
});

test("status caches for 60 s and force skips the cache, for both the probe and health", async () => {
  let now = 0;
  const probe = make(() => res(401, { helper: "plexus-parse-helper" }), { clock: () => now });
  await probe.api.status();
  now = 59_000;
  await probe.api.status();
  assert.equal(probe.calls.length, 1);
  await probe.api.status({ force: true });
  assert.equal(probe.calls.length, 2);
  now = 200_000;
  await probe.api.status();
  assert.equal(probe.calls.length, 3);

  const health = make(() => res(200, ready), { token: "t", clock: () => now });
  await health.api.status();
  await health.api.status();
  assert.equal(health.calls.length, 1);
  await health.api.status({ force: true });
  assert.equal(health.calls.length, 2);
});

test("pair stores the token and the next status is ready", async () => {
  const { api, store, calls } = make((url) => {
    if (url.endsWith("/v1/pair")) return res(200, { token: "abc123", helper: "plexus-parse-helper", version: "0.1.0" });
    if (url.endsWith("/v1/health")) return res(200, ready);
    throw new Error(url);
  });
  assert.equal((await api.status()).state, "not-installed");
  const result = await api.pair();
  assert.deepEqual(result, { ok: true, version: "0.1.0" });
  assert.equal(store["parse-helper-token"], "abc123");
  const pairCall = calls.find((c) => c.url.endsWith("/v1/pair"));
  assert.equal(pairCall.method, "GET");
  assert.equal(pairCall.headers, undefined);
  assert.equal(pairCall.targetAddressSpace, "loopback");
  assert.equal((await api.status()).state, "ready");
});

test("pair failure modes: window closed, not running, foreign answer, no storage", async () => {
  const closed = make(() => res(404, { error: "not found" }));
  assert.deepEqual(await closed.api.pair(), { ok: false, reason: "window-closed" });
  assert.equal(closed.store["parse-helper-token"], "");

  const off = make(() => { throw new Error("refused"); });
  assert.deepEqual(await off.api.pair(), { ok: false, reason: "not-running" });

  const foreign = make(() => res(200, { token: "x", helper: "something-else" }));
  assert.equal((await foreign.api.pair()).ok, false);
  assert.equal(foreign.store["parse-helper-token"], "");

  const bare = createHelperClient({ fetch: async () => res(200, { token: "x", helper: "plexus-parse-helper" }), settings: () => ({}) });
  assert.deepEqual(await bare.pair(), { ok: false, reason: "no-storage" });
});

test("download and cancel hit /v1/models/download with the bearer token", async () => {
  const { api, calls } = make((url, init) => res(init.method === "POST" ? 202 : 200, {}), { token: "t" });
  assert.equal(await api.downloadModels(), true);
  assert.equal(await api.cancelModels(), true);
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [
    ["POST", "http://127.0.0.1:48765/v1/models/download"],
    ["DELETE", "http://127.0.0.1:48765/v1/models/download"],
  ]);
  const none = make(() => { throw new Error("no fetch"); });
  assert.equal(await none.api.downloadModels(), false);
  assert.equal(none.calls.length, 0);
});

function makePair(handler, { token = "", backup = "", clock, storage: storageOverride } = {}) {
  const store = { "parse-helper-token": token };
  const sets = [];
  const { local, storage } = memoryStorage(backup);
  let t = 0;
  const calls = [];
  const api = createHelperClient({
    fetch: async (url, init = {}) => { calls.push({ url, method: init.method || "GET", headers: init.headers }); return handler(url, init, calls); },
    now: clock || (() => t),
    sleep: async (ms) => { t += ms; },
    settings: () => store,
    setSetting: async (id, value) => { sets.push([id, value]); store[id] = value; },
    storage: storageOverride || storage,
  });
  return { api, calls, store, sets, local };
}

test("a device-storage token is used and the settings are never written", async () => {
  const { api, sets } = makePair(() => res(401, { helper: "plexus-parse-helper" }), { backup: "kept" });
  assert.equal(api.endpoint().token, "kept");
  assert.equal(api.endpoint().token, "kept");
  await Promise.resolve();
  assert.deepEqual(sets, []);
});

test("a legacy settings token moves to device storage and the setting is cleared once", async () => {
  const { api, sets, store, local } = makePair(() => res(200, {}), { token: "fresh", backup: "old" });
  assert.equal(api.endpoint().token, "old");
  assert.equal(api.endpoint().token, "old");
  await Promise.resolve();
  assert.deepEqual(sets, [["parse-helper-token", ""]]);
  assert.equal(store["parse-helper-token"], "");
  assert.equal(local.get(KEY), "old");
});

test("pair with no window asks the Mac, polls, and stores the token and the backup", async () => {
  let polls = 0;
  let waiting = 0;
  const { api, calls, sets, local } = makePair((url, init) => {
    if (url.endsWith("/v1/pair/request")) return res(202, { status: "asking" });
    if (url.endsWith("/v1/pair")) {
      polls += 1;
      return polls < 3 ? res(404, { error: "not found" }) : res(200, { token: "tok", helper: "plexus-parse-helper", version: "0.1.1" });
    }
    throw new Error(url);
  });
  const result = await api.pair({ onWaiting: () => { waiting += 1; } });
  assert.deepEqual(result, { ok: true, version: "0.1.1" });
  assert.equal(waiting, 1);
  assert.equal(local.get(KEY), "tok");
  assert.deepEqual(sets, []);
  const request = calls.find((c) => c.url.endsWith("/v1/pair/request"));
  assert.equal(request.method, "POST");
  assert.equal(request.headers, undefined);
});

test("pair request answered 403 is declined, 404 is window-closed, endless 404 polling is a timeout", async () => {
  const declined = makePair((url) => (url.endsWith("/request") ? res(403, {}) : res(404, {})));
  assert.deepEqual(await declined.api.pair(), { ok: false, reason: "declined" });
  const older = makePair((url) => res(url.endsWith("/request") ? 405 : 404, {}));
  assert.deepEqual(await older.api.pair(), { ok: false, reason: "window-closed" });
  const slow = makePair((url) => (url.endsWith("/request") ? res(202, {}) : res(404, {})));
  assert.deepEqual(await slow.api.pair(), { ok: false, reason: "timeout" });
  const gone = makePair((url) => { if (url.endsWith("/request")) throw new Error("refused"); return res(404, {}); });
  assert.deepEqual(await gone.api.pair(), { ok: false, reason: "not-running" });
});
