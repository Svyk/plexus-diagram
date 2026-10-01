// PRE-4 baselines. Real CDP keys into one scratch block, then open-time of a board.
//   node tools/live/bench.mjs [titleSubstring]
import { writeFileSync } from "node:fs";

const PORT = process.env.CDP_PORT || 9223;
const sel = process.argv[2] || "Readwisenotes - ";
const KEYS = 200;
const sentence = "the quick brown fox jumps over the lazy dog ";
const text = sentence.repeat(Math.ceil(KEYS / sentence.length)).slice(0, KEYS);

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  return (await res.json()).filter((t) => t.type === "page");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

let nextId = 1;
function rpc(ws, method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) { ws.removeEventListener("message", onMsg); resolve(msg.result || msg); }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await rpc(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    includeCommandLineAPI: true,
    timeout: 60000,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails).slice(0, 500));
  }
  return result.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function keyParams(ch) {
  const space = ch === " ";
  return {
    key: space ? " " : ch,
    code: space ? "Space" : `Key${ch.toUpperCase()}`,
    text: ch,
    unmodifiedText: ch,
    windowsVirtualKeyCode: space ? 32 : ch.toUpperCase().charCodeAt(0),
  };
}

async function typeKeys(ws) {
  await evaluate(ws, `(() => {
    window.__pxdBench = { samples: [] };
    if (window.__pxdBenchOff) window.__pxdBenchOff();
    const onKey = (event) => {
      const t0 = performance.now();
      requestAnimationFrame(() => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => window.__pxdBench.samples.push(performance.now() - t0);
        channel.port2.postMessage(0);
      });
    };
    document.addEventListener("keydown", onKey, true);
    window.__pxdBenchOff = () => document.removeEventListener("keydown", onKey, true);
  })()`);
  const before = JSON.parse(await evaluate(ws, `JSON.stringify((performance.getEntriesByType && true))`) || "null");
  void before;
  const metricsBefore = await rpc(ws, "Performance.getMetrics");
  const taskBefore = (metricsBefore.metrics || []).find((m) => m.name === "TaskDuration")?.value || 0;
  for (const ch of text) {
    const params = keyParams(ch);
    await rpc(ws, "Input.dispatchKeyEvent", { type: "keyDown", ...params });
    await rpc(ws, "Input.dispatchKeyEvent", { type: "keyUp", ...params, text: undefined, unmodifiedText: undefined });
    await sleep(12);
  }
  await sleep(400);
  const metricsAfter = await rpc(ws, "Performance.getMetrics");
  const taskAfter = (metricsAfter.metrics || []).find((m) => m.name === "TaskDuration")?.value || 0;
  const samples = JSON.parse(await evaluate(ws, `JSON.stringify(window.__pxdBench.samples)`));
  await evaluate(ws, `window.__pxdBenchOff && window.__pxdBenchOff()`);
  const mean = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
  return {
    keys: text.length,
    samples: samples.length,
    meanMs: mean == null ? null : Math.round(mean * 100) / 100,
    taskMsPerKey: Math.round(((taskAfter - taskBefore) * 1000) / text.length * 100) / 100,
  };
}

async function clickEditor(ws) {
  const box = JSON.parse(await evaluate(ws, `(() => {
    const el = document.querySelector("textarea.rm-block__input, .rm-block__input");
    if (!el) return "null";
    const b = el.getBoundingClientRect();
    return JSON.stringify({ x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 14) });
  })()`));
  if (!box) throw new Error("no block editor");
  await rpc(ws, "Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
  await rpc(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(200);
  const active = await evaluate(ws, `document.activeElement && document.activeElement.className`);
  if (!String(active).includes("rm-block__input")) throw new Error(`editor not focused: ${active}`);
}

async function main() {
  const list = await targets();
  const candidates = list.filter((t) => (t.title || "").includes(sel) && !/plx typing bench/.test(t.title || ""));
  if (!candidates.length) throw new Error(`no target ${sel}`);
  let ws = await connect(candidates[0].webSocketDebuggerUrl);
  let live = await evaluate(ws, `!!window.__pxdLive`);
  if (!live && candidates[1]) {
    ws.close();
    ws = await connect(candidates[1].webSocketDebuggerUrl);
    live = await evaluate(ws, `!!window.__pxdLive`);
  }
  const title = await evaluate(ws, `document.title`);
  await evaluate(ws, `(async () => {
    const api = window.roamAlphaAPI;
    const page = "Plexus Diagram/Test Lab";
    await api.ui.mainWindow.openPage({ page: { title: page } });
    await new Promise((r) => setTimeout(r, 400));
    const uid = "SQo1XCFLi";
    await api.ui.mainWindow.openBlock({ block: { uid } });
    await new Promise((r) => setTimeout(r, 500));
    return location.hash;
  })()`);
  await clickEditor(ws);
  const injected = live ? await typeKeys(ws) : null;

  const listeners = JSON.parse(await evaluate(ws, `(() => {
    const count = (target) => { try { const map = getEventListeners(target); return Object.values(map).reduce((n, list) => n + list.length, 0); } catch (e) { return String(e); } };
    return JSON.stringify({ window: count(window), document: count(document), pxd: document.querySelectorAll("[class*=pxd-]").length, watches: window.__plexusDiagram && window.__plexusDiagram.stats && window.__plexusDiagram.stats.watches });
  })()`));

  if (live) await evaluate(ws, `window.__pxdLive.unload().then(() => { delete window.__pxdLive; })`);
  await sleep(300);
  const afterUnload = JSON.parse(await evaluate(ws, `JSON.stringify({ pxd: document.querySelectorAll("[class*=pxd-]").length, global: typeof window.__plexusDiagram, watches: window.__plexusDiagram && window.__plexusDiagram.stats && window.__plexusDiagram.stats.watches })`));
  const unloadedListeners = JSON.parse(await evaluate(ws, `(() => {
    const count = (target) => { const map = getEventListeners(target); return Object.values(map).reduce((n, list) => n + list.length, 0); };
    return JSON.stringify({ window: count(window), document: count(document) });
  })()`));

  await evaluate(ws, `(async () => {
    const api = window.roamAlphaAPI;
    await api.data.block.update({ block: { uid: "SQo1XCFLi", string: "" } });
    await api.ui.mainWindow.openBlock({ block: { uid: "SQo1XCFLi" } });
    await new Promise((r) => setTimeout(r, 400));
  })()`);
  await clickEditor(ws);
  const unloaded = await typeKeys(ws);

  const out = { title, injected, listenersBeforeUnload: listeners, afterUnload, unloadedListeners, unloaded, deltaMeanMs: injected && unloaded.meanMs != null ? Math.round((injected.meanMs - unloaded.meanMs) * 100) / 100 : null };
  writeFileSync(new URL("../../.live/bench.json", import.meta.url), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  ws.close();
}

main().catch((error) => { console.error(error); process.exit(1); });
