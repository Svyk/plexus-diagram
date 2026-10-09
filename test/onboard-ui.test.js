// P-ONBOARD. Status strip: one snapshot per state. Engines panel: rows, one button each, sheet,
// copy, pair, progress, polling, dispose. DOM stub, no Roam.
import assert from "node:assert/strict";
import test from "node:test";

import { STRIP_ACTIONS, renderParseStatus, stripKind, stripModel } from "../src/view/parse-status.js";
import {
  DOCLING_COMMAND,
  INSTALL_COMMAND,
  RESTART_COMMAND,
  engineRows,
  helperSheet,
  loadEngineState,
  renderEnginesPanel,
} from "../src/view/engines-panel.js";
import { TIP_TEXT } from "../src/view/tooltip-text.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const base = {
  scanned: true,
  ocr: { state: "idle", modelsCached: false },
  helper: { state: "not-installed", paired: false },
};
const withOcr = (ocr, extra = {}) => ({ ...base, ...extra, ocr: { ...base.ocr, ...ocr } });

const CASES = [
  ["born-digital page", { ...base, scanned: false }, null],
  ["scanned, first time, helper not installed (the dead-end screenshot)", base, {
    kind: "scan-first",
    text: "This page is an image. Read its text on this device (one-time 30 MB download).",
    buttons: ["read-text", "use-helper", "not-now"],
  }],
  ["scanned, first time, helper not running with a token", withOcr({}, { helper: { state: "not-running", paired: true } }), {
    kind: "helper-off",
    text: "Local helper is off. Reading on this device instead.",
    buttons: ["read-text", "start-helper"],
  }],
  ["scanned, models cached", withOcr({ modelsCached: true }), {
    kind: "scan-cached",
    text: "This page is an image. Read its text on this device.",
    buttons: ["read-text", "not-now"],
  }],
  ["scanned, models cached, helper paired but off", withOcr({ modelsCached: true }, { helper: { state: "not-running", paired: true } }), {
    kind: "helper-off",
    text: "Local helper is off. Reading on this device instead.",
    buttons: ["start-helper"],
  }],
  ["reading", withOcr({ state: "running", progress: 0.4 }), {
    kind: "reading",
    text: "Reading text on this page…",
    buttons: ["cancel"],
  }],
  ["helper just read it", withOcr({ state: "done", source: "helper", ms: 1234 }), {
    kind: "helper-done",
    text: "Read with local helper · 1.2 s",
    buttons: [],
  }],
  ["device read finished: no strip", withOcr({ state: "done", source: "device", ms: 800 }, { scanned: false }), null],
  ["could not read", withOcr({ state: "failed" }), {
    kind: "unreadable",
    text: "Could not read this page. Try the local helper or a higher zoom.",
    buttons: ["setup-helper", "retry"],
  }],
  ["Not now pressed", { ...base, dismissed: true }, null],
];

for (const [name, input, want] of CASES) {
  test(`strip state: ${name}`, () => {
    const kind = stripKind(input);
    if (!want) {
      assert.equal(kind, null);
      return;
    }
    assert.equal(kind, want.kind);
    const model = stripModel(kind, input);
    assert.equal(model.text, want.text);
    assert.deepEqual(model.buttons.map((b) => b.id), want.buttons);
    for (const b of model.buttons) assert.ok(STRIP_ACTIONS.includes(b.id));
  });
}

test("every strip text that needs a decision has a button; the only button-less state auto-hides", () => {
  for (const [, input, want] of CASES) {
    if (!want) continue;
    const model = stripModel(stripKind(input), input);
    if (model.buttons.length === 0) assert.ok(model.autoHideMs > 0, model.kind);
  }
});

test("no default strip or engine label says Docling; tooltips and Settings may", () => {
  const strings = [];
  for (const [, input, want] of CASES) {
    if (!want) continue;
    const model = stripModel(stripKind(input), input);
    strings.push(model.text, ...model.buttons.map((b) => b.label));
  }
  for (const helper of [
    { state: "not-installed" }, { state: "not-paired" }, { state: "not-running" }, { state: "wrong-token" },
    { state: "models-missing", progress: { bytes: 500 * 1048576 } }, { state: "downloading", progress: { fraction: 0.4 } },
    { state: "newer-schema" }, { state: "ready", version: "0.1.0" },
  ]) {
    for (const row of engineRows({ device: { state: "not-downloaded" }, helper })) {
      strings.push(row.name, row.text, row.button?.label || "");
    }
  }
  for (const text of strings) assert.ok(!/docling/i.test(text), text);
  assert.ok(/Docling/.test(TIP_TEXT["engines.helper"].desc));
});

test("the model download size follows the injected value", () => {
  const model = stripModel("scan-first", withOcr({ modelMB: 41.6 }));
  assert.match(model.text, /one-time 42 MB download/);
});

test("renderParseStatus paints a state with its buttons, routes clicks, and swaps on update", () => {
  const stub = createDomStub();
  const parent = stub.document.createElement("div");
  const actions = [];
  const strip = renderParseStatus(stub.document, parent, base, { onAction: (id) => actions.push(id) });
  assert.equal(strip.kind(), "scan-first");
  assert.equal(strip.el.getAttribute("role"), "status");
  assert.equal(strip.el.hasAttribute("hidden"), false);
  const buttons = strip.el.querySelectorAll("button");
  assert.deepEqual(buttons.map((b) => b.getAttribute("data-action")), ["read-text", "use-helper", "not-now"]);
  assert.ok(buttons.every((b) => b.getAttribute("type") === "button" && TIP_TEXT[b.getAttribute("data-tip")]));
  assert.ok(buttons[0].className.includes("--primary"));
  buttons[0].click();
  buttons[1].click();
  buttons[2].click();
  assert.deepEqual(actions, ["read-text", "use-helper", "not-now"]);

  strip.update(withOcr({ state: "running", progress: 0.5 }));
  assert.equal(strip.kind(), "reading");
  assert.deepEqual(strip.el.querySelectorAll("button").map((b) => b.getAttribute("data-action")), ["cancel"]);
  const fill = strip.el.querySelector(".pxd-parse-status__fill");
  assert.equal(fill.style.width, "50%");
  strip.update(withOcr({ state: "running", progress: 0.75 }));
  assert.equal(strip.el.querySelector(".pxd-parse-status__fill").style.width, "75%");

  strip.update({ ...base, scanned: false });
  assert.equal(strip.kind(), null);
  assert.equal(strip.el.hasAttribute("hidden"), true);
  assert.equal(strip.el.querySelectorAll("button").length, 0);
  strip.dispose();
});

test("pointer and mouse downs on the strip do not reach the board", () => {
  const stub = createDomStub();
  const parent = stub.document.createElement("div");
  stub.document.body.append(parent);
  const strip = renderParseStatus(stub.document, parent, base, {});
  let seen = 0;
  parent.addEventListener("pointerdown", () => { seen += 1; });
  const ev = stub.dispatch(strip.el.querySelector("button"), "pointerdown");
  assert.equal(ev.propagationStopped, true);
  assert.equal(seen, 0);
});

test("the helper-done notice hides itself after 3 s and a stale timer does nothing", () => {
  const stub = createDomStub();
  const parent = stub.document.createElement("div");
  const timers = [];
  const later = (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return () => { t.cancelled = true; }; };
  const done = withOcr({ state: "done", source: "helper", ms: 900 });
  const strip = renderParseStatus(stub.document, parent, done, { later });
  assert.equal(strip.kind(), "helper-done");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 3000);
  strip.update(done);
  assert.equal(timers.length, 1);
  timers[0].fn();
  assert.equal(strip.kind(), null);
  assert.equal(strip.el.hasAttribute("hidden"), true);

  const again = renderParseStatus(stub.document, parent, done, { later });
  again.update(withOcr({ state: "failed" }));
  assert.equal(timers[1].cancelled, true);
  timers[1].fn();
  assert.equal(again.kind(), "unreadable");
  strip.dispose();
  again.dispose();
});

// ---------------------------------------------------------------- Engines panel

const HELPER_STATES = {
  "not-installed": { button: "setup", text: "Not installed" },
  "not-paired": { button: "pair", text: "Running, not paired" },
  "not-running": { button: "start", text: "Not running" },
  "wrong-token": { button: "pair", text: "Token does not match" },
  "models-missing": { button: "download", text: "Models not downloaded (500 MB)" },
  downloading: { button: "cancel", text: "Downloading models · 42%" },
  "newer-schema": { button: "update", text: "Newer than this Plexus" },
  ready: { button: null, text: "Ready · v0.1.0" },
};

test("helper row: every state has its text, and every non-ready state exactly one button", () => {
  for (const [state, want] of Object.entries(HELPER_STATES)) {
    const helper = { state, paired: state !== "not-installed", version: "0.1.0", progress: { bytes: 500 * 1048576, fraction: 0.42, done: 1 } };
    const rows = engineRows({ device: { state: "ready" }, helper });
    const row = rows.find((r) => r.id === "helper");
    assert.equal(row.text, want.text, state);
    assert.equal(row.button?.id ?? null, want.button, state);
    if (state === "downloading") assert.equal(row.progress, 0.42);
  }
});

test("device and cloud rows: built-in ready, in-browser reading by state, cloud needs a key", () => {
  const ids = (device) => engineRows({ device, helper: { state: "ready" } }).map((r) => r.id);
  assert.deepEqual(ids({ state: "ready" }), ["device", "device-ocr", "helper", "cloud"]);
  const row = (device) => engineRows({ device, helper: { state: "ready" } }).find((r) => r.id === "device-ocr");
  assert.equal(row({ state: "ready" }).button, null);
  assert.equal(row({ state: "not-downloaded", mb: 30 }).button.id, "download-device");
  assert.equal(row({ state: "not-downloaded", mb: 30 }).text, "Not downloaded (30 MB, once)");
  assert.equal(row({ state: "downloading", progress: 0.5 }).button.id, "cancel-device");
  assert.equal(row({ state: "downloading", progress: 0.5 }).progress, 0.5);
  assert.equal(row({ state: "unavailable" }).disabled, true);
  assert.equal(row(undefined).button, null);
  const all = engineRows({ device: { state: "ready" }, helper: { state: "ready" } });
  assert.equal(all.find((r) => r.id === "device").button, null);
  const cloud = all.find((r) => r.id === "cloud");
  assert.equal(cloud.disabled, undefined);
  assert.equal(cloud.button.id, "cloud-setup");
  assert.equal(cloud.text, "Needs a LlamaParse key. Mistral OCR: no install, cheaper, weaker tables.");
  for (const r of engineRows({ device: { state: "not-downloaded" }, helper: { state: "not-installed" } })) {
    assert.ok(TIP_TEXT[r.tip], r.tip);
    if (r.button) assert.ok(TIP_TEXT[r.button.tip], r.button.tip);
  }
});

test("an OCR-only helper is ready for scans and explains the Docling add-on", async () => {
  const helper = {
    state: "ready",
    paired: true,
    version: "0.1.0-rs",
    ocr: true,
    docling: false,
    engines: ["ocr"],
  };
  const row = engineRows({ device: { state: "ready" }, helper }).find((r) => r.id === "helper");
  assert.equal(row.dot, "ok");
  assert.equal(row.text, "Ready for scans · v0.1.0-rs");
  assert.equal(row.button, null);
  assert.match(row.note, /Docling is an optional add-on/);
  assert.equal(row.command, DOCLING_COMMAND);
  assert.match(DOCLING_COMMAND, /--docling/);

  const full = engineRows({ device: { state: "ready" }, helper: { state: "ready", version: "0.1.0", ocr: true, docling: true } }).find((r) => r.id === "helper");
  assert.equal(full.text, "Ready · v0.1.0");
  assert.equal(full.note, undefined);
  assert.equal(full.button, null);

  const { panel } = mount({ client: fakeClient(helper) });
  await tick();
  const painted = panel.el.querySelector('[data-row="helper"]');
  assert.match(painted.querySelector(".pxd-engines__note").textContent, /optional add-on/);
  assert.equal(painted.querySelector(".pxd-engines__command").textContent, DOCLING_COMMAND);
  assert.equal(painted.querySelector("button"), null);
  panel.dispose();
});

test("the setup sheet gives the right command per state and platform", () => {
  assert.equal(helperSheet("not-installed", "mac").command, INSTALL_COMMAND);
  assert.equal(INSTALL_COMMAND, "curl -fsSL https://svyk.github.io/plexus-diagram/helper/install.sh | sh");
  assert.equal(helperSheet("not-running", "mac").command, RESTART_COMMAND);
  const other = helperSheet("not-installed", "linux");
  assert.match(other.command, /uv tool install/);
  assert.match(other.note, /another system/);
});

function fakeClient(initial) {
  const state = { value: initial, calls: [] };
  const api = {
    state,
    status: async (opts) => { state.calls.push(["status", Boolean(opts?.force)]); return state.value; },
    pair: async () => { state.calls.push(["pair"]); state.value = { state: "ready", paired: true, version: "0.1.0" }; return { ok: true }; },
    downloadModels: async () => { state.calls.push(["download"]); state.value = { state: "downloading", paired: true, progress: { fraction: 0.1 } }; return true; },
    cancelModels: async () => { state.calls.push(["cancel"]); state.value = { state: "models-missing", paired: true, progress: { bytes: 5e8 } }; return true; },
    invalidate: () => state.calls.push(["invalidate"]),
  };
  return api;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function mount(deps) {
  const stub = createDomStub();
  const parent = stub.document.createElement("div");
  stub.document.body.append(parent);
  const intervals = [];
  const cleared = [];
  const panel = renderEnginesPanel(stub.document, parent, {
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: (id) => cleared.push(id),
    ...deps,
  });
  return { stub, panel, intervals, cleared };
}

const rowsOf = (panel) => panel.el.querySelectorAll(".pxd-engines__row");
const actionOf = (panel, row) => row.querySelectorAll("button").map((b) => b.getAttribute("data-action"));

test("the panel loads on open, paints one button per non-ready row, and polls while visible", async () => {
  const client = fakeClient({ state: "not-installed", paired: false });
  const toasts = [];
  const { panel, intervals, cleared } = mount({ client, toast: (t) => toasts.push(t), pollMs: 2500 });
  assert.equal(client.state.calls.length, 1, "one status call on open, forced");
  assert.deepEqual(client.state.calls[0], ["status", true]);
  await tick();
  const rows = rowsOf(panel);
  assert.deepEqual(rows.map((r) => r.getAttribute("data-row")), ["device", "device-ocr", "helper", "cloud"]);
  for (const row of rows) assert.ok(actionOf(panel, row).length <= 1);
  assert.deepEqual(actionOf(panel, rows[2]), ["setup"]);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 2500);

  await panel.refresh();
  intervals[0].fn();
  await tick();
  assert.ok(client.state.calls.filter((c) => c[0] === "status").length >= 3);

  panel.setVisible(false);
  assert.equal(panel.el.hasAttribute("hidden"), true);
  assert.deepEqual(cleared, [1]);
  panel.setVisible(true);
  assert.equal(intervals.length, 2);
  panel.dispose();
  assert.deepEqual(cleared, [1, 2]);
});

test("Set up opens the sheet with the command; Copy needs a trusted click; Pair finishes and the row turns ready", async () => {
  const client = fakeClient({ state: "not-installed", paired: false });
  const copied = [];
  const toasts = [];
  const { stub, panel } = mount({ client, copy: async (t) => { copied.push(t); }, toast: (t) => toasts.push(t) });
  await tick();
  panel.el.querySelector('[data-action="setup"]').click();
  const code = panel.el.querySelector(".pxd-engines__command");
  assert.equal(code.textContent, INSTALL_COMMAND);

  const copyBtn = panel.el.querySelector('[data-action="copy"]');
  stub.dispatch(copyBtn, "click", { isTrusted: false });
  await tick();
  assert.deepEqual(copied, []);
  stub.dispatch(copyBtn, "click", { isTrusted: true });
  await tick();
  assert.deepEqual(copied, [INSTALL_COMMAND]);
  assert.ok(toasts.includes("Command copied"));

  panel.el.querySelector('.pxd-engines__sheet [data-action="pair"]').click();
  await tick();
  await tick();
  assert.ok(client.state.calls.some((c) => c[0] === "pair"));
  assert.ok(toasts.includes("Helper paired"));
  const helperRow = rowsOf(panel).find((r) => r.getAttribute("data-row") === "helper");
  assert.equal(helperRow.getAttribute("data-dot"), "ok");
  assert.deepEqual(actionOf(panel, helperRow), []);
  assert.equal(panel.el.querySelector(".pxd-engines__sheet"), null, "the sheet closes once the helper is ready");
});

test("pair failure shows the reason instead of nothing", async () => {
  const client = fakeClient({ state: "not-paired", paired: false });
  client.pair = async () => ({ ok: false, reason: "window-closed" });
  const toasts = [];
  const { panel } = mount({ client, toast: (t) => toasts.push(t) });
  await tick();
  panel.el.querySelector('[data-action="pair"]').click();
  await tick();
  assert.match(toasts[0], /Pairing window closed/);
});

test("model download shows progress with a Cancel, and cancel returns the Download button", async () => {
  const client = fakeClient({ state: "models-missing", paired: true, progress: { bytes: 500 * 1048576 } });
  const { panel } = mount({ client });
  await tick();
  const helper = () => rowsOf(panel).find((r) => r.getAttribute("data-row") === "helper");
  assert.deepEqual(actionOf(panel, helper()), ["download"]);
  helper().querySelector('[data-action="download"]').click();
  await tick();
  await tick();
  assert.deepEqual(actionOf(panel, helper()), ["cancel"]);
  assert.equal(helper().querySelector(".pxd-engines__fill").style.width, "10%");
  assert.equal(helper().querySelector(".pxd-engines__bar").getAttribute("aria-valuenow"), "10");
  helper().querySelector('[data-action="cancel"]').click();
  await tick();
  await tick();
  assert.deepEqual(actionOf(panel, helper()), ["download"]);
});

test("the in-browser reading row uses the injected device source", async () => {
  const device = {
    value: { state: "not-downloaded", mb: 30 },
    status() { return this.value; },
    download() { this.value = { state: "downloading", progress: 0.2 }; },
    cancel() { this.value = { state: "not-downloaded", mb: 30 }; },
  };
  const { panel } = mount({ client: fakeClient({ state: "ready", paired: true, version: "0.1.0" }), device });
  await tick();
  const ocr = () => rowsOf(panel).find((r) => r.getAttribute("data-row") === "device-ocr");
  assert.deepEqual(actionOf(panel, ocr()), ["download-device"]);
  ocr().querySelector("button").click();
  await tick();
  await tick();
  assert.deepEqual(actionOf(panel, ocr()), ["cancel-device"]);
  ocr().querySelector("button").click();
  await tick();
  await tick();
  assert.deepEqual(actionOf(panel, ocr()), ["download-device"]);
});

test("a manual token is saved through setSetting and clears the field", async () => {
  const saved = [];
  const client = fakeClient({ state: "not-paired", paired: false });
  const { panel } = mount({ client, setSetting: async (id, v) => { saved.push([id, v]); }, toast: () => {} });
  await tick();
  const input = panel.el.querySelector(".pxd-engines__token");
  assert.equal(input.getAttribute("type"), "password");
  input.value = "  hand-token ";
  panel.el.querySelector('[data-action="save-token"]').click();
  await tick();
  assert.deepEqual(saved, [["parse-helper-token", "hand-token"]]);
  assert.equal(input.value, "");
  assert.ok(client.state.calls.some((c) => c[0] === "invalidate"));
});

test("rendering the panel and the strip fetches nothing by itself without a client", async () => {
  const stub = createDomStub();
  const parent = stub.document.createElement("div");
  const panel = renderEnginesPanel(stub.document, parent, { setInterval: () => 1, clearInterval: () => {} });
  await tick();
  const helper = rowsOf(panel).find((r) => r.getAttribute("data-row") === "helper");
  assert.deepEqual(actionOf(panel, helper), ["setup"]);
  panel.dispose();
});

test("loadEngineState survives a throwing client and a throwing device", async () => {
  const state = await loadEngineState({
    client: { status: async () => { throw new Error("x"); } },
    device: { status: () => { throw new Error("y"); } },
  });
  assert.equal(state.helper.state, "not-installed");
  assert.equal(state.device.state, "unavailable");
});

test("dispose removes the panel and later refreshes are ignored", async () => {
  const client = fakeClient({ state: "ready", paired: true });
  const { panel } = mount({ client });
  await tick();
  panel.dispose();
  const before = client.state.calls.length;
  await panel.refresh();
  assert.equal(client.state.calls.length, before);
});
