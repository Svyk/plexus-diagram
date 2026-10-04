// PRE-4 baselines. Real CDP keys into one scratch block, then open-time of a board.
//   node tools/live/bench.mjs [titleSubstring]
//   BENCH_ARMS=1 node tools/live/bench.mjs "Readwisenotes - Plexus"
// BENCH_ARMS=1 runs eight arms, five interleaved rounds of 200 keys, BENCH_VIEW=page.
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appendEntry } from "./ledger.mjs";

const PORT = process.env.CDP_PORT || 9223;
const sel = process.argv[2] || "Readwisenotes - ";
const KEYS = 200;
const VIEW = process.env.BENCH_VIEW === "page" ? "page" : "block";
let lastKeySeries = [];
const sentence = "the quick brown fox jumps over the lazy dog ";
const text = sentence.repeat(Math.ceil(KEYS / sentence.length)).slice(0, KEYS);

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  return (await res.json()).filter((t) => t.type === "page");
}

const pending = new Map();
const eventHandlers = [];

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("cdp socket error")));
    ws.addEventListener("close", () => {
      for (const [id, waiter] of pending) {
        if (waiter.ws !== ws) continue;
        pending.delete(id);
        clearTimeout(waiter.timer);
        waiter.reject(new Error("socket closed"));
      }
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id != null && pending.has(msg.id)) {
        const waiter = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
        return;
      }
      for (const fn of eventHandlers) {
        try { fn(msg); } catch { /* a collector must not break the socket */ }
      }
    });
  });
}

let nextId = 1;
function rpc(ws, method, params, timeoutMs = 60000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, timeoutMs);
    pending.set(id, {
      ws,
      timer,
      reject,
      resolve: (msg) => {
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error).slice(0, 400)}`));
        else resolve(msg.result ?? msg);
      },
    });
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

async function typeKeys(ws, count = KEYS) {
  const sampleText = text.slice(0, count);
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
  for (const ch of sampleText) {
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
  lastKeySeries = samples;
  return {
    keys: sampleText.length,
    samples: samples.length,
    meanMs: mean == null ? null : Math.round(mean * 100) / 100,
    taskMsPerKey: Math.round(((taskAfter - taskBefore) * 1000) / sampleText.length * 100) / 100,
  };
}

async function clickEditor(ws, uid, view = VIEW, scrollBlock = "center") {
  const pick = view === "page" ? `document.querySelector('.rm-block__input[id$="-${uid}"], textarea[id$="-${uid}"]')` : `document.querySelector("textarea.rm-block__input, .rm-block__input")`;
  const locate = `(() => {
    document.querySelectorAll(".iziToast-overlay, .iziToast-wrapper").forEach((node) => node.remove());
    const el = ${pick};
    if (el) el.scrollIntoView({ block: ${JSON.stringify(scrollBlock)} });
    if (!el) return "null";
    const b = el.getBoundingClientRect();
    const x = b.x + Math.min(48, Math.max(12, b.width / 2));
    const y = b.y + Math.min(b.height / 2, 14);
    const hit = document.elementFromPoint(x, y);
    return JSON.stringify({ x, y, hit: hit ? String(hit.className || hit.tagName).slice(0, 80) : "" });
  })()`;
  let active = "";
  let box = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    box = JSON.parse(await evaluate(ws, locate));
    if (!box) throw new Error("no block editor");
    await rpc(ws, "Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
    await rpc(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(250);
    active = await evaluate(ws, `document.activeElement && document.activeElement.className`);
    if (String(active).includes("rm-block__input")) return;
  }
  throw new Error(`editor not focused: ${active} hit ${box?.hit || ""}`);
}

const ARM_IDS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const ARM_LABELS = {
  a: "unloaded",
  b: "injected, no board",
  c: "40-task board, Better Tasks loaded, Task Status Tags absent",
  d: "40-task board, Better Tasks disabled in Depot, hard-reloaded",
  e: "display none on .pxd-root",
  f: "Plexus window and document listeners removed",
  g: "contain content on .pxd-item and .pxd-root",
  h: "40 note cards",
};
const TRACE_KEYS = 40;
const PAGE = "Plexus Diagram/Test Lab";
const WINDOW = "Readwisenotes - Plexus Diagram/Test Lab";
const HOLD = "pxd bench hold";

function round2(n) {
  return Math.round(n * 100) / 100;
}

function percentile(values, p) {
  const sorted = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return round2(sorted[lo]);
  return round2(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

function runTool(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "tool failed").slice(0, 800));
  return result.stdout || "";
}

async function placeBoardsInPage(config) {
  const api = window.roamAlphaAPI;
  await api.ui.mainWindow.openPage({ page: { title: config.page } });
  await new Promise((r) => setTimeout(r, 300));
  const pageUid = api.q('[:find ?u . :where [?p :node/title "' + config.page + '"] [?p :block/uid ?u]]');
  if (!pageUid) throw new Error("Test Lab page missing");
  const find = (string) => api.q("[:find ?u . :where [?b :block/string " + JSON.stringify(string) + "] [?b :block/uid ?u]]") || null;
  let holdUid = find(config.hold);
  let createdHold = false;
  if (!holdUid) {
    holdUid = api.util.generateUID();
    await api.data.block.create({ location: { "parent-uid": pageUid, order: "last" }, block: { uid: holdUid, string: config.hold, open: false } });
    createdHold = true;
  }
  await api.data.block.update({ block: { uid: holdUid, open: false } });
  const show = config.which === "task" ? config.task : config.which === "notes" ? config.notes : null;
  for (const uid of [config.task, config.notes]) {
    if (uid && uid !== show) await api.data.block.move({ location: { "parent-uid": holdUid, order: "last" }, block: { uid } });
  }
  if (config.scratch) await api.data.block.move({ location: { "parent-uid": pageUid, order: "first" }, block: { uid: config.scratch } });
  if (show) await api.data.block.move({ location: { "parent-uid": pageUid, order: 1 }, block: { uid: show } });
  await new Promise((r) => setTimeout(r, 400));
  return { holdUid, createdHold, mounts: document.querySelectorAll(".pxd-mount .pxd-root").length, diagrams: document.querySelectorAll(".rm-diagram").length };
}

async function depotSwitchPoint() {
  const dialog = () => document.querySelector(".rm-modal-dialog--settings, .rm-settings");
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!dialog()) {
    const more = document.querySelector(".rm-topbar .bp3-icon-more");
    if (!more) return { error: "no topbar menu" };
    more.click();
    let item = null;
    for (let i = 0; i < 20 && !item; i += 1) {
      await pause(100);
      item = [...document.querySelectorAll(".bp3-menu-item")].find((el) => (el.innerText || "").trim() === "Settings");
    }
    if (!item) return { error: "no Settings menu item" };
    item.click();
    for (let i = 0; i < 30 && !dialog(); i += 1) await pause(100);
  }
  const root = dialog();
  if (!root) return { error: "settings dialog did not open" };
  const tab = [...root.querySelectorAll("button, [role='tab'], a, span, div")].find((el) => {
    const own = [...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent.trim()).join("");
    return own === "Roam Depot" || (el.childElementCount === 0 && (el.innerText || "").trim() === "Roam Depot");
  });
  if (!tab) return { error: "no Roam Depot tab" };
  tab.click();
  await pause(400);
  const rowOf = (scope) => {
    let best = null;
    for (const el of scope.querySelectorAll("div, li, tr, section, article")) {
      const lines = (el.innerText || "").split("\n").map((line) => line.trim()).filter(Boolean);
      if (!lines.includes("Better Tasks")) continue;
      if (lines.includes("Task Status Tags")) continue;
      const boxes = [...el.querySelectorAll("input[type='checkbox'], [role='switch']")];
      if (boxes.length !== 1) continue;
      if (!best || (el.innerText || "").length < (best.el.innerText || "").length) best = { el, box: boxes[0] };
    }
    return best;
  };
  const scroller = root.querySelector(".rm-settings-content, .bp3-dialog-body") || root;
  let row = rowOf(root);
  for (let i = 0; i < 40 && !row; i += 1) {
    const before = scroller.scrollTop;
    scroller.scrollTop += Math.max(200, scroller.clientHeight * 0.8);
    await pause(80);
    row = rowOf(root);
    if (scroller.scrollTop === before) break;
  }
  if (!row) return { error: "Better Tasks Installed toggle was not found" };
  const clickEl = row.box.closest("label") || row.box;
  clickEl.scrollIntoView({ block: "center" });
  const rect = clickEl.getBoundingClientRect();
  const checked = row.box.checked === true || row.box.getAttribute("aria-checked") === "true";
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, checked };
}

async function extensionPresence(ws) {
  return evaluate(ws, `({
    betterTasks: Boolean(window.betterTasks),
    taskStatusTags: typeof window.RoamTaskStatusTags === "undefined" ? "absent" : "present",
    betterTasksTools: ((window.RoamExtensionTools && window.RoamExtensionTools["better-tasks"] && window.RoamExtensionTools["better-tasks"].tools) || []).length,
  })`);
}

async function pressEscape(ws) {
  await rpc(ws, "Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await rpc(ws, "Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(150);
}

async function readBetterTasksDepot(ws) {
  return evaluate(ws, `(() => {
    const rows = Object.values(window.roamAlphaAPI.depot.getInstalledExtensions() || {});
    const isBt = (item) => {
      if (!item) return false;
      const id = String(item.id || "");
      const name = String(item.name || "");
      return name === "Better Tasks" || (id + " " + name).toLowerCase().includes("better-tasks");
    };
    const matches = rows.filter(isBt);
    if (!matches.length) return null;
    const stable = matches.find((item) => item.version !== "DEV" && !String(item.id || "").startsWith("http"));
    const row = stable || matches[0];
    return { id: row.id, name: row.name, enabled: row.enabled === true, version: row.version || "" };
  })()`);
}

async function closeSettings(ctx) {
  for (let i = 0; i < 3; i += 1) {
    const open = await evaluate(ctx.ws, `Boolean(document.querySelector(".rm-modal-dialog--settings, .rm-settings"))`);
    if (!open) return;
    await pressEscape(ctx.ws);
    await sleep(200);
  }
}

// This graph installs Better Tasks as the developer URL https://svyk.github.io/better-tasks/.
// That row has no Installed checkbox. The cross removes the URL for the whole graph; Load remote extension puts the same URL back.
async function changeDevExtension(url, enabled) {
  const previousConfirm = window.confirm;
  window.confirm = () => true;
  try {
  const dialog = () => document.querySelector(".rm-modal-dialog--settings, .rm-settings");
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const names = () => [...document.querySelectorAll(".rm-extension-installed__name")].map((el) => (el.textContent || "").trim());
  const present = () => names().includes(url) || Object.values(window.roamAlphaAPI.depot.getInstalledExtensions() || {}).some((item) => String(item && (item.id || item.name) || "") === url);
  if (!dialog()) {
    const more = document.querySelector(".rm-topbar .bp3-icon-more");
    if (!more) return { error: "no topbar menu" };
    more.click();
    let item = null;
    for (let i = 0; i < 20 && !item; i += 1) {
      await pause(100);
      item = [...document.querySelectorAll(".bp3-menu-item")].find((el) => (el.innerText || "").trim() === "Settings");
    }
    if (!item) return { error: "no Settings menu item" };
    item.click();
    for (let i = 0; i < 30 && !dialog(); i += 1) await pause(100);
  }
  const root = dialog();
  if (!root) return { error: "settings dialog did not open" };
  const tab = [...root.querySelectorAll("button, [role='tab'], a, span, div")].find((el) => {
    const own = [...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent.trim()).join("");
    return own === "Roam Depot" || (el.childElementCount === 0 && (el.innerText || "").trim() === "Roam Depot");
  });
  if (!tab) return { error: "no Roam Depot tab" };
  tab.click();
  await pause(400);
  if (enabled) {
    if (present()) return { ok: true, present: true, already: true };
    const header = [...root.querySelectorAll(".rm-extensions-installed__header")].find((el) => (el.innerText || "").startsWith("Developer Extensions"));
    const link = header && header.querySelector("button.bp3-icon-link");
    if (!link) return { error: "no developer URL button" };
    link.click();
    await pause(300);
    const input = [...document.querySelectorAll("input")].find((el) => /roam-ext-1|test\.com/.test(el.placeholder || ""));
    if (!input) return { error: "no developer URL input" };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, url);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await pause(200);
    const load = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Load remote extension");
    if (!load) return { error: "no Load remote extension button" };
    if (input.value !== url) return { error: "URL input did not stick" };
    load.click();
    for (let i = 0; i < 20; i += 1) {
      await pause(200);
      if (present()) return { ok: true, present: true };
    }
    return { error: "developer URL was not added" };
  }
  const row = [...document.querySelectorAll(".rm-extension-installed")].find((el) => (el.querySelector(".rm-extension-installed__name")?.textContent || "").trim() === url);
  if (!row) {
    for (let i = 0; i < 10; i += 1) {
      if (!present()) return { ok: true, present: false, already: true };
      await pause(150);
    }
    return present() ? { error: "developer URL still installed" } : { ok: true, present: false, already: true };
  }
  const cross = [...row.querySelectorAll("button")].find((b) => /bp3-icon-cross/.test(b.className || ""));
  if (!cross) return { error: "no remove button for " + url };
  cross.click();
  await pause(400);
  if (names().includes(url)) {
    const pop = [...document.querySelectorAll(".bp3-popover")].find((el) => /remove|uninstall|delete/i.test(el.innerText || "") && !/delete my account/i.test(el.innerText || ""));
    const confirm = pop && [...pop.querySelectorAll("button")].find((b) => /^(remove|uninstall|delete|yes|confirm)$/i.test((b.innerText || "").trim()));
    if (!confirm) return { error: "developer row still present", pop: pop ? pop.innerText.slice(0, 180) : "" };
    confirm.click();
    await pause(400);
  }
  for (let i = 0; i < 10; i += 1) {
    if (!present()) return { ok: true, present: false };
    await pause(150);
  }
  return { error: "developer URL still installed" };
  } finally {
    window.confirm = previousConfirm;
  }
}

// Marketplace rows use the Installed switch. A developer URL has no switch; removing and restoring that URL persists for the whole graph. Typing happens only after Page.reload.
async function setBetterTasksInstalled(ctx, enabled) {
  const current = await readBetterTasksDepot(ctx.ws);
  const dev = !current || current.version === "DEV" || /^https?:/i.test(String(current.id || ""));
  if (!dev) {
    if (current.enabled === enabled) return current;
    ctx.depotMethod = "installed-toggle";
    const point = await evaluate(ctx.ws, `(${depotSwitchPoint.toString()})()`);
    if (!point || point.error) throw new Error(point?.error || "Depot Installed toggle was not found");
    await rpc(ctx.ws, "Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
    await rpc(ctx.ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
    let next = null;
    for (let i = 0; i < 20; i += 1) {
      await sleep(150);
      next = await readBetterTasksDepot(ctx.ws);
      if (next && next.enabled === enabled) break;
    }
    await pressEscape(ctx.ws);
    next = await readBetterTasksDepot(ctx.ws);
    if (!next || next.enabled !== enabled) throw new Error(`Depot Installed toggle did not persist enabled=${enabled}`);
    return next;
  }
  const url = (current && /^https?:/i.test(String(current.id || "")) && current.id) || ctx.betterTasksUrl || "https://svyk.github.io/better-tasks/";
  ctx.betterTasksUrl = url;
  ctx.depotMethod = "developer-url";
  if (Boolean(current) === enabled) {
    await closeSettings(ctx);
    return current || { id: url, enabled, version: "DEV" };
  }
  let result;
  try {
    result = await evaluate(ctx.ws, `(${changeDevExtension.toString()})(${JSON.stringify(url)}, ${enabled ? "true" : "false"})`);
  } finally {
    try { await closeSettings(ctx); } catch { /* the dialog may already be gone */ }
  }
  if (!result || result.error) throw new Error(result?.error || "developer extension change failed");
  const next = await readBetterTasksDepot(ctx.ws);
  if (Boolean(next) !== enabled) throw new Error(`developer extension did not persist enabled=${enabled}`);
  return next || { id: url, enabled: false, version: "DEV" };
}

async function hardReload(ctx) {
  const old = ctx.ws;
  try { await rpc(old, "Page.reload", { ignoreCache: true }, 8000); } catch { /* the socket closes with the page */ }
  try { old.close(); } catch { /* already closed */ }
  ctx.ws = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await sleep(500);
    let list = [];
    try { list = await targets(); } catch { continue; }
    const hit = list.find((t) => t.title === WINDOW);
    if (!hit?.webSocketDebuggerUrl) continue;
    if ((hit.title || "").startsWith("Svy") || /plx typing bench/.test(hit.title || "")) continue;
    try {
      const ws = await connect(hit.webSocketDebuggerUrl);
      const ready = await evaluate(ws, `document.title === ${JSON.stringify(WINDOW)} && Boolean(window.roamAlphaAPI && document.querySelector(".roam-app"))`);
      if (!ready) { ws.close(); continue; }
      ctx.ws = ws;
      ctx.targetId = hit.id;
      ctx.title = WINDOW;
      return ws;
    } catch { /* renderer still booting */ }
  }
  throw new Error("hard reload did not reconnect");
}

async function waitForBetterTasks(ws) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { if (await evaluate(ws, `Boolean(window.betterTasks)`)) return true; } catch { /* the page may still be swapping sockets */ }
    await sleep(500);
  }
  return false;
}

async function ensureInjected(ctx) {
  if (await evaluate(ctx.ws, `Boolean(window.__pxdLive)`)) return;
  const out = runTool(ctx.livePath, ["inject", ctx.targetId]);
  if (out.includes("REFUSED")) throw new Error(out.slice(0, 400));
  await sleep(300);
  if (!await evaluate(ctx.ws, `Boolean(window.__pxdLive)`)) throw new Error(`inject did not set __pxdLive: ${out.slice(0, 300)}`);
}

async function unloadLive(ctx) {
  if (!await evaluate(ctx.ws, `Boolean(window.__pxdLive)`)) return;
  runTool(ctx.livePath, ["unload", ctx.targetId]);
  await sleep(300);
}

async function waitForCount(ws, expression, want, ms) {
  const deadline = Date.now() + ms;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(ws, expression);
    if (last === want) return last;
    await sleep(200);
  }
  return last;
}

async function prepare(ctx, which) {
  if (which === "none") await unloadLive(ctx);
  else await ensureInjected(ctx);
  const placed = await evaluate(ctx.ws, `(${placeBoardsInPage.toString()})(${JSON.stringify({
    which, page: PAGE, scratch: ctx.scratch, task: ctx.task, notes: ctx.notes, hold: HOLD,
  })})`);
  if (placed.createdHold) appendEntry({ uid: placed.holdUid, why: "bench hold", page: PAGE, graph: ctx.graph });
  const expr = which === "none"
    ? `document.querySelectorAll(".rm-diagram").length`
    : `document.querySelectorAll(".pxd-mount .pxd-root").length`;
  const got = await waitForCount(ctx.ws, expr, which === "none" ? 0 : 1, 8000);
  if (got !== (which === "none" ? 0 : 1)) throw new Error(`arm layout ${which} expected ${which === "none" ? 0 : 1} boards, saw ${got}`);
  return placed;
}

async function focusScratch(ctx) {
  const uid = ctx.scratch;
  await evaluate(ctx.ws, `window.roamAlphaAPI.data.block.update({ block: { uid: ${JSON.stringify(uid)}, string: "" } })`);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const height = await evaluate(ctx.ws, `(() => {
      const el = document.querySelector('.rm-block__input[id$="-${uid}"], textarea[id$="-${uid}"]');
      return el ? el.getBoundingClientRect().height : 0;
    })()`);
    if (height && height < 80) break;
    await sleep(150);
  }
  await evaluate(ctx.ws, `(() => {
    document.querySelectorAll(".iziToast-overlay, .iziToast-wrapper").forEach((node) => node.remove());
    const wrap = document.querySelector(".rm-article-wrapper");
    if (wrap) wrap.scrollTop = 0;
  })()`);
  await sleep(200);
  await clickEditor(ctx.ws, uid, "page", "nearest");
}

async function typeMounted(ctx) {
  await focusScratch(ctx);
  let preRoots = 0;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    preRoots = await evaluate(ctx.ws, `document.querySelectorAll(".pxd-mount .pxd-root").length`);
    if (preRoots) break;
    await evaluate(ctx.ws, `(() => {
      const wrap = document.querySelector(".rm-article-wrapper");
      if (wrap) wrap.scrollTop = 0;
      const el = document.querySelector('[id$="-${ctx.task}"]') || document.querySelector(".rm-diagram");
      if (el) el.scrollIntoView({ block: "nearest" });
    })()`);
    await sleep(300);
  }
  if (!preRoots) throw new Error("board not mounted (preRoots 0); scratch must sit above the board");
  const typed = await typeKeys(ctx.ws, KEYS);
  return { ...typed, preRoots, keySeries: lastKeySeries.slice() };
}

async function typePlain(ctx) {
  await focusScratch(ctx);
  const typed = await typeKeys(ctx.ws, KEYS);
  return { ...typed, preRoots: await evaluate(ctx.ws, `document.querySelectorAll(".pxd-root").length`), keySeries: lastKeySeries.slice() };
}

async function withCss(ctx, css, run) {
  await evaluate(ctx.ws, `(() => {
    document.getElementById("pxd-bench-css")?.remove();
    const style = document.createElement("style");
    style.id = "pxd-bench-css";
    style.textContent = ${JSON.stringify(css)};
    document.head.append(style);
  })()`);
  try {
    return await run();
  } finally {
    await evaluate(ctx.ws, `document.getElementById("pxd-bench-css")?.remove()`);
  }
}

async function listenerEntries(ws, expression) {
  const evaluated = await rpc(ws, "Runtime.evaluate", { expression, includeCommandLineAPI: true });
  if (evaluated.exceptionDetails) throw new Error("getEventListeners failed");
  const rootId = evaluated.result?.objectId;
  if (!rootId) return [];
  const props = await rpc(ws, "Runtime.getProperties", { objectId: rootId, ownProperties: true });
  const entries = [];
  for (const prop of props.result || []) {
    if (!prop.value?.objectId || prop.name === "__proto__") continue;
    const list = await rpc(ws, "Runtime.getProperties", { objectId: prop.value.objectId, ownProperties: true });
    for (const item of list.result || []) {
      if (!/^\d+$/.test(item.name) || !item.value?.objectId) continue;
      const fields = await rpc(ws, "Runtime.getProperties", { objectId: item.value.objectId, ownProperties: true });
      const map = new Map((fields.result || []).map((row) => [row.name, row.value]));
      const listener = map.get("listener");
      if (!listener?.objectId) continue;
      entries.push({
        type: prop.name,
        listenerId: listener.objectId,
        useCapture: Boolean(map.get("useCapture")?.value),
        passive: Boolean(map.get("passive")?.value),
        once: Boolean(map.get("once")?.value),
      });
    }
  }
  return entries;
}

async function functionScriptId(ws, objectId) {
  const props = await rpc(ws, "Runtime.getProperties", { objectId, ownProperties: true });
  const loc = (props.internalProperties || []).find((row) => row.name === "[[FunctionLocation]]");
  return loc?.value?.value?.scriptId || null;
}

async function scriptIsPlexus(ws, scriptId, cache) {
  if (cache.has(scriptId)) return cache.get(scriptId);
  const got = await rpc(ws, "Debugger.getScriptSource", { scriptId });
  const yes = String(got.scriptSource || "").includes("/* Plexus Diagram");
  cache.set(scriptId, yes);
  return yes;
}

async function removePlexusListeners(ws) {
  await rpc(ws, "Debugger.enable");
  const cache = new Map();
  try {
    let removed = 0;
    for (const target of ["window", "document"]) {
      for (const entry of await listenerEntries(ws, `getEventListeners(${target})`)) {
        const scriptId = await functionScriptId(ws, entry.listenerId);
        if (!scriptId || !await scriptIsPlexus(ws, scriptId, cache)) continue;
        const called = await rpc(ws, "Runtime.callFunctionOn", {
          objectId: entry.listenerId,
          functionDeclaration: `function(meta) {
            const node = meta.target === "window" ? window : document;
            node.removeEventListener(meta.type, this, meta.useCapture);
            (window.__pxdBenchFnBag || (window.__pxdBenchFnBag = [])).push({
              target: meta.target, type: meta.type, useCapture: meta.useCapture, passive: meta.passive, once: meta.once, fn: this,
            });
            return true;
          }`,
          arguments: [{ value: { target, type: entry.type, useCapture: entry.useCapture, passive: entry.passive, once: entry.once } }],
          returnByValue: true,
        });
        if (called.exceptionDetails) throw new Error("removeEventListener failed");
        removed += 1;
      }
    }
    return removed;
  } finally {
    try { await rpc(ws, "Debugger.disable"); } catch { /* already off */ }
  }
}

async function restorePlexusListeners(ws) {
  return evaluate(ws, `(() => {
    const bag = window.__pxdBenchFnBag || [];
    for (const row of bag) {
      const node = row.target === "window" ? window : document;
      node.addEventListener(row.type, row.fn, { capture: Boolean(row.useCapture), passive: Boolean(row.passive), once: Boolean(row.once) });
    }
    window.__pxdBenchFnBag = [];
    return bag.length;
  })()`);
}

async function installMoWrap(ws) {
  await evaluate(ws, `(() => {
    if (window.__pxdBenchMoRestore) return "already";
    const Original = window.MutationObserver;
    let bucket = 0;
    const counts = [];
    const onKey = () => { counts.push(bucket); bucket = 0; };
    document.addEventListener("keydown", onKey, true);
    function Wrapped(callback) {
      if (typeof callback !== "function") return new Original(callback);
      return new Original(function(records, observer) {
        bucket += 1;
        return callback.call(this, records, observer);
      });
    }
    Wrapped.prototype = Original.prototype;
    window.MutationObserver = Wrapped;
    window.__pxdBenchMoRestore = () => {
      document.removeEventListener("keydown", onKey, true);
      counts.push(bucket);
      window.MutationObserver = Original;
      const perKey = counts.slice(1);
      const total = perKey.reduce((sum, n) => sum + n, 0);
      const report = { perKey, total, keys: perKey.length, meanPerKey: perKey.length ? Math.round((total / perKey.length) * 100) / 100 : 0 };
      delete window.__pxdBenchMoRestore;
      window.__pxdBenchMo = report;
      return report;
    };
    return "wrapped";
  })()`);
}

async function restoreMoWrap(ws) {
  return evaluate(ws, `(() => {
    if (typeof window.__pxdBenchMoRestore === "function") return window.__pxdBenchMoRestore();
    return window.__pxdBenchMo || { perKey: [], total: 0, keys: 0, meanPerKey: 0 };
  })()`);
}

function scriptUrlOf(event) {
  const data = event?.args?.data || {};
  return data.url || event?.args?.url || data.scriptName || "(no url)";
}

function summarizeTrace(events, keys) {
  const sums = { UpdateLayoutTree: 0, Layout: 0, Paint: 0 };
  const v8 = new Map();
  for (const event of events) {
    if (!event || event.ph === "B" || event.ph === "E") continue;
    const dur = Number(event.dur) || 0;
    if (Object.prototype.hasOwnProperty.call(sums, event.name)) sums[event.name] += dur;
    const cat = String(event.cat || "");
    const isV8 = cat.includes("v8") || event.name === "FunctionCall" || event.name === "EvaluateScript";
    if (!isV8 || sums[event.name] != null) continue;
    const url = scriptUrlOf(event);
    v8.set(url, (v8.get(url) || 0) + dur);
  }
  const perKey = (us) => Math.round((us / 1000 / keys) * 100) / 100;
  return {
    keys,
    events: events.length,
    updateLayoutTreeMsPerKey: perKey(sums.UpdateLayoutTree),
    layoutMsPerKey: perKey(sums.Layout),
    paintMsPerKey: perKey(sums.Paint),
    v8ByUrl: [...v8.entries()].map(([url, us]) => ({ url, inclusiveMsPerKey: perKey(us) })).sort((a, b) => b.inclusiveMsPerKey - a.inclusiveMsPerKey).slice(0, 15),
  };
}

// 40-key sample only. Tracing.end and the MutationObserver constructor restore both run in finally.
async function traceSample(ws) {
  const events = [];
  let tracingComplete = false;
  const onEvent = (msg) => {
    if (msg.method === "Tracing.dataCollected") {
      for (const row of msg.params?.value || []) events.push(row);
    } else if (msg.method === "Tracing.tracingComplete") tracingComplete = true;
  };
  eventHandlers.push(onEvent);
  const bag = { typing: null, trace: null, mo: null };
  try {
    await installMoWrap(ws);
    await rpc(ws, "Tracing.start", {
      categories: "devtools.timeline,v8.execute,blink.user_timing",
      transferMode: "ReportEvents",
    });
    bag.typing = await typeKeys(ws, TRACE_KEYS);
  } finally {
    try {
      await rpc(ws, "Tracing.end", {}, 20000);
      const deadline = Date.now() + 15000;
      while (!tracingComplete && Date.now() < deadline) await sleep(50);
      bag.trace = summarizeTrace(events, TRACE_KEYS);
    } catch (error) {
      bag.trace = { error: String(error.message || error), ...summarizeTrace(events, TRACE_KEYS) };
    } finally {
      const at = eventHandlers.indexOf(onEvent);
      if (at >= 0) eventHandlers.splice(at, 1);
      try { bag.mo = await restoreMoWrap(ws); } catch (error) { bag.mo = { error: String(error.message || error) }; }
    }
  }
  return bag;
}

async function restoreBetterTasks(ctx) {
  if (!ctx.depotDisabled) return;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (!ctx.ws) await hardReload(ctx);
      await setBetterTasksInstalled(ctx, true);
      await hardReload(ctx);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      console.error(error);
      ctx.ws = null;
    }
  }
  if (lastError || !ctx.ws || !await waitForBetterTasks(ctx.ws)) {
    console.error("refusing to exit: window.betterTasks is missing");
    await new Promise(() => {});
  }
  ctx.depotDisabled = false;
  await ensureInjected(ctx);
}

async function measureDepotOff(ctx) {
  const before = await extensionPresence(ctx.ws);
  if (!before.betterTasks) throw new Error("arm d: window.betterTasks is missing before the Depot toggle");
  ctx.depotDisabled = true;
  try {
    await setBetterTasksInstalled(ctx, false);
    await hardReload(ctx);
    await ensureInjected(ctx);
    await prepare(ctx, "task");
    const after = await extensionPresence(ctx.ws);
    ctx.armD = after;
    if (after.betterTasks) throw new Error("arm d: window.betterTasks still loaded after Depot disable and hard reload");
    return await typeMounted(ctx);
  } finally {
    await restoreBetterTasks(ctx);
  }
}

async function measureListenersOff(ctx) {
  await prepare(ctx, "task");
  const removed = await removePlexusListeners(ctx.ws);
  let typed = null;
  let listenersRestored = 0;
  try {
    typed = await typeMounted(ctx);
  } finally {
    listenersRestored = await restorePlexusListeners(ctx.ws);
  }
  return { ...typed, listenersRemoved: removed, listenersRestored };
}

async function measureArm(ctx, id) {
  if (id === "a") {
    await prepare(ctx, "none");
    return typePlain(ctx);
  }
  if (id === "b") {
    await prepare(ctx, "none");
    await ensureInjected(ctx);
    const roots = await waitForCount(ctx.ws, `document.querySelectorAll(".pxd-mount .pxd-root").length`, 0, 4000);
    if (roots !== 0) throw new Error(`arm b: board still mounted (${roots})`);
    return typePlain(ctx);
  }
  if (id === "c") {
    await prepare(ctx, "task");
    const presence = await extensionPresence(ctx.ws);
    ctx.presence = presence;
    if (!presence.betterTasks) throw new Error("arm c: Better Tasks is not loaded");
    const typed = await typeMounted(ctx);
    return { ...typed, taskStatusTags: presence.taskStatusTags, betterTasks: true };
  }
  if (id === "d") return measureDepotOff(ctx);
  if (id === "e") {
    await prepare(ctx, "task");
    return withCss(ctx, ".pxd-root { display: none }", () => typeMounted(ctx));
  }
  if (id === "f") return measureListenersOff(ctx);
  if (id === "g") {
    await prepare(ctx, "task");
    // Run-only. This rule is not written into the repo.
    return withCss(ctx, ".pxd-item, .pxd-root { contain: content }", () => typeMounted(ctx));
  }
  if (id === "h") {
    await prepare(ctx, "notes");
    return typeMounted(ctx);
  }
  throw new Error(`unknown arm ${id}`);
}

async function ensureScratch(ctx) {
  const existing = process.env.BENCH_SCRATCH || "";
  const uid = await evaluate(ctx.ws, `(async () => {
    const api = window.roamAlphaAPI;
    const page = ${JSON.stringify(PAGE)};
    await api.ui.mainWindow.openPage({ page: { title: page } });
    await new Promise((r) => setTimeout(r, 400));
    const pageUid = api.q('[:find ?u . :where [?p :node/title "' + page + '"] [?p :block/uid ?u]]');
    const have = ${existing ? "true" : "false"};
    const uid = ${existing ? JSON.stringify(existing) : "api.util.generateUID()"};
    if (!have) await api.data.block.create({ location: { "parent-uid": pageUid, order: "first" }, block: { uid, string: "" } });
    else await api.data.block.move({ location: { "parent-uid": pageUid, order: "first" }, block: { uid } });
    return uid;
  })()`);
  if (!existing) appendEntry({ uid, why: "bench scratch block", page: PAGE, graph: ctx.graph });
  return uid;
}

async function ensureBoard(ctx, title, notes) {
  const string = `{{[[diagram]]:${title}}}`;
  const query = `[:find ?u . :where [?b :block/string ${JSON.stringify(string)}] [?b :block/uid ?u]]`;
  const uid = await evaluate(ctx.ws, `window.roamAlphaAPI.q(${JSON.stringify(query)}) || null`);
  if (uid) return uid;
  const args = [ctx.targetId, "--count", "40", "--title", title];
  if (notes) args.push("--notes");
  const parsed = JSON.parse(runTool(ctx.taskboardPath, args).trim());
  if (!parsed.done || parsed.error) throw new Error(parsed.error || "taskboard failed");
  return parsed.boardUid;
}

function slimRound(row) {
  const slim = { round: row.round };
  for (const id of ARM_IDS) {
    const copy = { ...row[id] };
    delete copy.keySeries;
    slim[id] = copy;
  }
  return slim;
}

function publishArms(out) {
  mkdirSync(fileURLToPath(new URL("../../.live/", import.meta.url)), { recursive: true });
  writeFileSync(new URL("../../.live/bench-arms.json", import.meta.url), JSON.stringify(out, null, 1));
}

async function runArms(ctx) {
  if (!WINDOW.includes(sel) && !sel.includes(WINDOW)) throw new Error(`refusing selector ${sel}`);
  const list = await targets();
  const candidates = list.filter((t) => t.title === WINDOW);
  if (!candidates.length) throw new Error(`no target ${WINDOW}`);
  const chosen = candidates[0];
  if ((chosen.title || "").startsWith("Svy") || /plx typing bench/.test(chosen.title || "")) throw new Error(`refusing window ${chosen.title}`);
  ctx.ws = await connect(chosen.webSocketDebuggerUrl);
  ctx.targetId = chosen.id;
  ctx.title = await evaluate(ctx.ws, `document.title`);
  if (ctx.title !== WINDOW) throw new Error(`refusing window ${ctx.title}`);
  console.log(`window ${ctx.title} target ${ctx.targetId}`);
  ctx.livePath = fileURLToPath(new URL("./plexus-live.mjs", import.meta.url));
  ctx.taskboardPath = fileURLToPath(new URL("./taskboard.mjs", import.meta.url));
  ctx.graph = await evaluate(ctx.ws, `(location.hash.match(/#\\/app\\/([^/]+)/) || [])[1] || ""`);
  ctx.sawBetterTasks = Boolean(await evaluate(ctx.ws, `Boolean(window.betterTasks)`));
  ctx.depotDisabled = false;
  await ensureInjected(ctx);
  ctx.scratch = await ensureScratch(ctx);
  console.log(`scratch ${ctx.scratch} above the board`);
  console.log("rebuild RE bench 40 if the page has no task board");
  ctx.task = await ensureBoard(ctx, "RE bench 40", false);
  console.log(`task board ${ctx.task}`);
  console.log("rebuild RE bench notes 40 if the page has no note board");
  ctx.notes = await ensureBoard(ctx, "RE bench notes 40", true);
  console.log(`note board ${ctx.notes}`);
  const rounds = [];
  for (let round = 0; round < 5; round += 1) {
    const row = { round: round + 1 };
    for (const id of ARM_IDS) {
      console.log(`round ${round + 1} arm ${id} ${ARM_LABELS[id]}`);
      row[id] = await measureArm(ctx, id);
      console.log(`round ${round + 1} arm ${id} mean ${row[id].meanMs} ms/key samples ${row[id].samples}`);
    }
    rounds.push(row);
    publishArms({ partial: true, roundsDone: rounds.length, depotMethod: ctx.depotMethod || null, roundDetail: rounds.map(slimRound) });
  }
  // Separate 40-key traces. Not part of the 200-key median rounds.
  let traceA = null;
  let traceC = null;
  try {
    await prepare(ctx, "none");
    await focusScratch(ctx);
    traceA = await traceSample(ctx.ws);
    await prepare(ctx, "task");
    await focusScratch(ctx);
    traceC = await traceSample(ctx.ws);
  } catch (error) {
    console.error(`trace sample failed: ${error.message || error}`);
    if (!traceA) traceA = { error: String(error.message || error) };
    if (!traceC) traceC = { error: String(error.message || error) };
  }
  const arms = {};
  for (const id of ARM_IDS) {
    const deltas = rounds.map((row) => round2(row[id].meanMs - row.a.meanMs));
    const keyDeltas = [];
    for (const row of rounds) {
      const base = row.a.meanMs;
      for (const sample of row[id].keySeries || []) keyDeltas.push(sample - base);
    }
    arms[id] = {
      label: ARM_LABELS[id],
      deltas,
      median: percentile(deltas, 0.5),
      p95: percentile(deltas, 0.95),
      means: rounds.map((row) => row[id].meanMs),
      keyP95: percentile(keyDeltas, 0.95),
    };
    console.log(`${id} ${ARM_LABELS[id]}  median ${arms[id].median} ms/key  p95 ${arms[id].p95} ms/key`);
  }
  const out = {
    title: ctx.title,
    view: "page",
    keys: KEYS,
    rounds: 5,
    delta: "arm meanMs minus the same round's unloaded meanMs",
    depotMethod: ctx.depotMethod || null,
    taskStatusTags: ctx.presence?.taskStatusTags ?? null,
    betterTasksOnC: ctx.presence?.betterTasks ?? null,
    armD: ctx.armD || null,
    arms,
    roundDetail: rounds.map(slimRound),
    traces: { a: traceA, c: traceC },
  };
  publishArms(out);
  console.log(JSON.stringify(out, null, 1));
}

async function armsMain() {
  const ctx = { depotDisabled: false, sawBetterTasks: false, ws: null };
  try {
    await runArms(ctx);
  } finally {
    if (ctx.depotDisabled && ctx.ws) await restoreBetterTasks(ctx);
    if (ctx.sawBetterTasks && ctx.ws) {
      let present = false;
      try { present = await evaluate(ctx.ws, `Boolean(window.betterTasks)`); } catch { present = false; }
      if (!present) {
        console.error("refusing to exit: window.betterTasks is missing");
        await new Promise(() => {});
      }
    }
    try { ctx.ws?.close(); } catch { /* closed */ }
  }
}

async function main() {
  if (process.env.BENCH_ARMS === "1") {
    await armsMain();
    return;
  }

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
  // Scratch block: made on Test Lab for this run and ledgered (ledger cleanup removes it afterwards).
  const uid = process.env.BENCH_SCRATCH || await evaluate(ws, `(async () => {
    const api = window.roamAlphaAPI;
    const page = "Plexus Diagram/Test Lab";
    await api.ui.mainWindow.openPage({ page: { title: page } });
    await new Promise((r) => setTimeout(r, 400));
    const pageUid = api.q('[:find ?u . :where [?p :node/title "' + page + '"] [?p :block/uid ?u]]');
    const uid = api.util.generateUID();
    await api.data.block.create({ location: { "parent-uid": pageUid, order: ${JSON.stringify(VIEW)} === "page" ? 10 : "last" }, block: { uid, string: "" } });
    if (${JSON.stringify(VIEW)} === "block") await api.ui.mainWindow.openBlock({ block: { uid } });
    await new Promise((r) => setTimeout(r, 1500));
    return uid;
  })()`);
  const ledgerPath = fileURLToPath(new URL("./ledger.mjs", import.meta.url));
  spawnSync(process.execPath, [ledgerPath, "add", uid, "bench scratch block", "--page", "Plexus Diagram/Test Lab"], { encoding: "utf8" });
  await clickEditor(ws, uid);
  const preRoots = live ? await evaluate(ws, `document.querySelectorAll(".pxd-root").length`) : null;
  const injected = live ? await typeKeys(ws) : null;

  const listeners = JSON.parse(await evaluate(ws, `(() => {
    const count = (target) => { try { const map = getEventListeners(target); return Object.values(map).reduce((n, list) => n + list.length, 0); } catch (e) { return String(e); } };
    return JSON.stringify({ window: count(window), document: count(document), pxd: document.querySelectorAll("[class*=pxd-]").length, roots: document.querySelectorAll(".pxd-root").length, chips: document.querySelectorAll(".pxd-relchip").length, watches: window.__plexusDiagram && window.__plexusDiagram.stats && window.__plexusDiagram.stats.watches });
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
    await api.data.block.update({ block: { uid: ${JSON.stringify(uid)}, string: "" } });
    if (${JSON.stringify(VIEW)} === "block") await api.ui.mainWindow.openBlock({ block: { uid: ${JSON.stringify(uid)} } });
    await new Promise((r) => setTimeout(r, 400));
  })()`);
  await clickEditor(ws, uid);
  const unloaded = await typeKeys(ws);

  const out = { title, preRoots, injected, listenersBeforeUnload: listeners, afterUnload, unloadedListeners, unloaded, deltaMeanMs: injected && unloaded.meanMs != null ? Math.round((injected.meanMs - unloaded.meanMs) * 100) / 100 : null };
  writeFileSync(new URL("../../.live/bench.json", import.meta.url), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  ws.close();
}

main().catch((error) => { console.error(error); process.exit(1); });
