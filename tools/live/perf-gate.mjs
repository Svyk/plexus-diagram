// PERF-8 live perf gate. Prints one table and exits non-zero when a row is over its threshold.
//   node tools/live/perf-gate.mjs "Readwisenotes - "
//   node tools/live/perf-gate.mjs --dry
// Refuses a window titled "plx typing bench".
// Adds one right-sidebar window for the fixture board and removes only that window.
// Does not close the sidebar.
import { writeSync } from "node:fs";
import { appendEntry, cleanup } from "./ledger.mjs";
import perfBudgets from "./perf-budgets.json" with { type: "json" };
import { summarizeGateShifts } from "../../src/view/shift-watch.js";

export const PERF_BUDGETS = perfBudgets;

export const PAGE = "Plexus Diagram/Test Lab";
export const BOARD_TITLE = "PERF-8 gate";
export const FIXTURE_NOTES = 40;
export const FIXTURE_IMAGES = 3;
export const FIXTURE_PDFS = 1;
export const FIXTURE_PAGE_CARDS = 1;
export const SAMPLE_MS = 3000;
export const SETTLE_MS = 500;
export const OUTLINE_SETTLE_MS = 2000;
export const MAIN_IDLE_LONG_TASK_MS = 350; // Roam itself runs an unrelated ~290 ms task every few seconds
export const SIDEBAR_BOARD_LONG_TASK_MS = 350; // Roam itself runs an unrelated ~290 ms task every few seconds
export const SIDEBAR_PARKED_LONG_TASK_MS = 350; // Roam itself runs an unrelated ~290 ms task every few seconds
export const SIDEBAR_OUTLINE_LONG_TASKS_AFTER_SETTLE = 0;
export const TYPING_MOUNTED_MEDIAN_MS = 1.0;
export const TYPING_PARKED_MEDIAN_MS = 0.1;
export const POINTERUP_PER_MOUNTED_BOARD = 1;
export const TYPING_ROUNDS = 5;
export const TYPING_KEYS = 200;
export const BENCH_VIEW = "page";
export const PLEXUS_BANNER = "/* Plexus Diagram";
const DEFAULT_WINDOW = "Readwisenotes - ";
const KEY_GAP_MS = 12;

export const ROW_IDS = ["main-idle", "sidebar-loaded-parked", "sidebar-board-outline", "typing"];

export function parseArgs(argv) {
  let dry = false;
  const positional = [];
  for (const arg of argv || []) {
    if (arg === "--dry") dry = true;
    else positional.push(arg);
  }
  return { dry, windowSel: positional[0] || DEFAULT_WINDOW };
}

export function windowTitleRefused(title) {
  return /plx typing bench/.test(String(title || ""));
}

export function windowKey(win) {
  if (!win || typeof win !== "object") return "";
  const uid = win["block-uid"] || win.blockUid || "";
  const type = win.type || "";
  if (uid) return `${type}:${uid}`;
  const id = win["window-id"] || win.windowId || "";
  return id ? String(id) : "";
}

function belongsToBoard(win, boardUid) {
  const uid = String(boardUid || "");
  if (!uid) return false;
  const block = String(win?.["block-uid"] || win?.blockUid || "");
  if (block === uid) return true;
  const id = String(win?.["window-id"] || win?.windowId || "");
  return id.includes(uid);
}

// Only windows for this fixture board that were not already open.
export function windowsToRemove(before, after, boardUid, domId = "") {
  const beforeKeys = new Set((before || []).map(windowKey).filter(Boolean));
  const added = (after || []).filter((win) => belongsToBoard(win, boardUid) && !beforeKeys.has(windowKey(win)));
  if (!added.length && domId && String(domId).includes(String(boardUid || ""))) {
    const synthetic = { type: "block", "block-uid": boardUid, "window-id": domId };
    const key = windowKey(synthetic);
    if (key && !beforeKeys.has(key)) added.push(synthetic);
  }
  return added;
}

export function sidebarStillIntact(before, after, removedKeys) {
  const afterKeys = new Set((after || []).map(windowKey).filter(Boolean));
  const removed = new Set(removedKeys || []);
  const missing = (before || []).map(windowKey).filter((key) => key && !removed.has(key) && !afterKeys.has(key));
  const stillThere = (removedKeys || []).filter((key) => afterKeys.has(key));
  return { missing, stillThere, ok: missing.length === 0 && stillThere.length === 0 };
}

export function fixtureCardSpecs(page = PAGE) {
  const cards = [];
  for (let i = 0; i < FIXTURE_NOTES; i += 1) cards.push({ kind: "note", string: `Gate card ${i + 1}` });
  for (let i = 0; i < FIXTURE_IMAGES; i += 1) cards.push({ kind: "image", string: "" });
  for (let i = 0; i < FIXTURE_PDFS; i += 1) {
    cards.push({ kind: "pdf", string: "{{[[pdf]]: https://example.com/perf-8.pdf}}" });
  }
  for (let i = 0; i < FIXTURE_PAGE_CARDS; i += 1) cards.push({ kind: "page", string: `[[${page}]]` });
  return cards;
}

export function fixtureComplete(counts) {
  return Boolean(counts)
    && counts.note === FIXTURE_NOTES
    && counts.image === FIXTURE_IMAGES
    && counts.pdf === FIXTURE_PDFS
    && counts.page === FIXTURE_PAGE_CARDS;
}

export function fixtureEntries(result) {
  const page = result?.page || PAGE;
  const graph = result?.graph || "";
  return (result?.uids || []).filter((row) => row && row.uid && row.why).map((row) => ({
    uid: row.uid,
    why: `PERF-8 ${row.why}`,
    page,
    graph,
  }));
}

export function isPlexusSource(source) {
  return String(source || "").includes(PLEXUS_BANNER);
}

export function countPlexusPointerup(listeners, sourcesByScriptId) {
  let count = 0;
  const lookup = (scriptId) => {
    if (!sourcesByScriptId) return "";
    if (typeof sourcesByScriptId.get === "function") return sourcesByScriptId.get(scriptId) || "";
    return sourcesByScriptId[scriptId] || "";
  };
  for (const listener of listeners || []) {
    if (listener?.type !== "pointerup") continue;
    if (isPlexusSource(lookup(listener.scriptId))) count += 1;
  }
  return count;
}

export function pointerupRatio(listeners, boards) {
  if (!Number.isFinite(listeners) || !Number.isFinite(boards)) {
    return { value: null, limit: POINTERUP_PER_MOUNTED_BOARD, ok: false, listeners, boards };
  }
  if (boards <= 0) return { value: listeners, limit: 0, ok: listeners === 0, listeners, boards };
  return {
    value: Math.round((listeners / boards) * 100) / 100,
    limit: POINTERUP_PER_MOUNTED_BOARD,
    ok: listeners <= boards * POINTERUP_PER_MOUNTED_BOARD,
    listeners,
    boards,
  };
}

export function worstPointerup(samples) {
  const list = samples?.length ? samples : [null];
  let worst = null;
  for (const sample of list) {
    const row = pointerupRatio(sample?.listeners, sample?.boards);
    if (!worst) worst = row;
    else if (row.ok !== worst.ok) worst = worst.ok ? row : worst;
    else if (Number.isFinite(row.value) && row.value > (Number.isFinite(worst.value) ? worst.value : -1)) worst = row;
  }
  return worst;
}

export function longTaskSummary(tasks, origin, windowMs, settleMs = null) {
  const start = Number(origin);
  const span = Number(windowMs);
  const list = (tasks || []).filter((task) => Number.isFinite(task?.start) && Number.isFinite(task?.duration));
  const inWindow = Number.isFinite(start) && Number.isFinite(span)
    ? list.filter((task) => task.start >= start && task.start < start + span)
    : [];
  const longMs = inWindow.reduce((sum, task) => sum + task.duration, 0);
  const after = settleMs == null || !Number.isFinite(start)
    ? []
    : inWindow.filter((task) => task.start > start + settleMs);
  return { longMs: Math.round(longMs), count: inWindow.length, afterSettle: after.length };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function percentile(values, p) {
  const sorted = (values || []).filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return round2(sorted[lo]);
  return round2(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

export function median(values) {
  return percentile(values, 0.5);
}

export function typingMedians(rounds) {
  const mounted = [];
  const parked = [];
  for (const round of rounds || []) {
    if (![round?.baseline, round?.mounted, round?.parked].every((n) => Number.isFinite(n))) continue;
    mounted.push(round2(round.mounted - round.baseline));
    parked.push(round2(round.parked - round.baseline));
  }
  return { mountedMedian: median(mounted), parkedMedian: median(parked), mountedDeltas: mounted, parkedDeltas: parked };
}

function wrapDataSurface(data, counts, marker) {
  const saved = [];
  const wrapObject = (obj, prefix) => {
    if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return;
    let names = [];
    try { names = Object.getOwnPropertyNames(obj); } catch { return; }
    for (const name of names) {
      if (name === "constructor" || name === "prototype") continue;
      let fn;
      try { fn = obj[name]; } catch { continue; }
      if (typeof fn !== "function") continue;
      const wrapped = function (...args) {
        counts.total += 1;
        const key = prefix ? `${prefix}.${name}` : name;
        counts.names[key] = (counts.names[key] || 0) + 1;
        const stack = new Error().stack || "";
        if (marker && stack.includes(marker)) counts.plexus += 1;
        return fn.apply(this, args);
      };
      try { obj[name] = wrapped; } catch { continue; }
      saved.push([obj, name, fn]);
    }
  };
  wrapObject(data, "");
  wrapObject(data?.block, "block");
  wrapObject(data?.fast, "fast");
  return saved;
}

export function installDataCounter(data, marker = "") {
  const counts = { total: 0, plexus: 0, names: {} };
  const saved = wrapDataSurface(data, counts, marker);
  return {
    counts,
    restore() {
      for (const [obj, name, fn] of saved) obj[name] = fn;
    },
  };
}

// Optional ceiling. Missing from perf-budgets.json means one after-usable shift fails.
function layoutShiftLimit(budgets = PERF_BUDGETS) {
  const value = budgets?.["40"]?.layoutShiftsAfterUsable;
  return Number.isFinite(value) ? value : 0;
}

function check(metric, value, limit) {
  const ok = Number.isFinite(value) && value <= limit;
  return { metric, value: Number.isFinite(value) ? value : null, limit, ok };
}

function measured(metric, value) {
  const finite = Number.isFinite(value);
  return { metric, value: finite ? value : null, limit: null, ok: finite, info: finite };
}

function info(metric, value) {
  return { metric, value: Number.isFinite(value) ? value : null, limit: null, ok: true, info: true };
}

export function judge(input) {
  const main = input?.main || {};
  const side = input?.sidebar || {};
  const typing = input?.typing || {};
  const pointer = worstPointerup(input?.pointerupSamples || (input?.pointerup ? [input.pointerup] : []));
  const rows = [
    {
      id: "main-idle",
      checks: [check("long-task ms over 3s", main.longMs, MAIN_IDLE_LONG_TASK_MS)],
    },
    {
      id: "sidebar-loaded-parked",
      checks: [
        measured("loaded long-task ms over 3s", side.loadedLongMs),
        check("parked long-task ms over 3s", side.parkedLongMs, SIDEBAR_PARKED_LONG_TASK_MS),
      ],
    },
    {
      id: "sidebar-board-outline",
      checks: [
        check("board long-task ms over 3s", side.boardLongMs, SIDEBAR_BOARD_LONG_TASK_MS),
        check("outline long tasks after 2s", side.outlineAfter2s, SIDEBAR_OUTLINE_LONG_TASKS_AFTER_SETTLE),
      ],
    },
    {
      id: "typing",
      checks: [
        check("mounted median ms/key", typing.mountedMedian, TYPING_MOUNTED_MEDIAN_MS),
        check("parked median ms/key", typing.parkedMedian, TYPING_PARKED_MEDIAN_MS),
      ],
    },
  ];
  const shiftKnown = input != null && Object.prototype.hasOwnProperty.call(input, "layoutShiftsAfterUsable");
  const shiftRaw = shiftKnown ? input.layoutShiftsAfterUsable : 0;
  const shiftLimit = layoutShiftLimit();
  const shiftValue = Number.isFinite(shiftRaw) ? shiftRaw : null;
  const shiftOk = Number.isFinite(shiftRaw) && shiftRaw <= shiftLimit;
  const extra = [
    {
      id: "pointerup",
      metric: "per mounted board",
      value: pointer?.value ?? null,
      limit: pointer?.limit ?? POINTERUP_PER_MOUNTED_BOARD,
      ok: Boolean(pointer?.ok),
      detail: `${pointer?.listeners ?? "n/a"} listeners, ${pointer?.boards ?? "n/a"} boards`,
    },
    {
      id: "data-calls",
      metric: "plexus per board open",
      value: Number.isFinite(input?.dataCalls) ? input.dataCalls : null,
      limit: null,
      ok: Number.isFinite(input?.dataCalls) && input.dataCalls > 0,
      detail: `total ${Number.isFinite(input?.dataCallsTotal) ? input.dataCallsTotal : "n/a"}`,
    },
    {
      id: "layout-shift after usable",
      metric: "shifts",
      value: shiftValue,
      limit: shiftLimit,
      ok: shiftOk,
    },
  ];
  const ok = rows.every((row) => row.checks.every((rowCheck) => rowCheck.ok)) && extra.every((rowCheck) => rowCheck.ok);
  return { ok, rows, extra };
}

export function formatTable(verdict) {
  const lines = [`PERF-8${verdict?.version ? ` ${verdict.version}` : ""}`, "row | check | value | limit | result"];
  const print = (id, rowCheck) => {
    const limit = rowCheck.limit == null ? "report" : `<= ${rowCheck.limit}`;
    const result = rowCheck.ok === false ? "fail" : rowCheck.info ? "info" : "pass";
    const value = rowCheck.value == null ? "n/a" : String(rowCheck.value);
    const detail = rowCheck.detail ? ` | ${rowCheck.detail}` : "";
    lines.push(`${id} | ${rowCheck.metric} | ${value} | ${limit} | ${result}${detail}`);
  };
  for (const row of verdict?.rows || []) for (const rowCheck of row.checks) print(row.id, rowCheck);
  for (const rowCheck of verdict?.extra || []) print(rowCheck.id, rowCheck);
  lines.push(verdict?.ok ? "pass" : "fail");
  return lines.join("\n");
}

export function planText(windowSel) {
  return [
    "PERF-8 perf gate (dry)",
    `window selector: ${windowSel}`,
    "does not connect",
    'refuses a window titled "plx typing bench"',
    `fixture: ${FIXTURE_NOTES} note cards, ${FIXTURE_IMAGES} images, ${FIXTURE_PDFS} pdf ref, ${FIXTURE_PAGE_CARDS} page card`,
    `page: ${PAGE}`,
    "rows:",
    `main-idle: long-task ms over ${SAMPLE_MS} ms <= ${MAIN_IDLE_LONG_TASK_MS}`,
    `sidebar-loaded-parked: loaded long-task ms reported; parked long-task ms <= ${SIDEBAR_PARKED_LONG_TASK_MS}`,
    `sidebar-board-outline: board long-task ms over ${SAMPLE_MS} ms <= ${SIDEBAR_BOARD_LONG_TASK_MS}; outline long tasks starting after ${OUTLINE_SETTLE_MS} ms <= ${SIDEBAR_OUTLINE_LONG_TASKS_AFTER_SETTLE}`,
    `typing: BENCH_VIEW=${BENCH_VIEW}, BENCH_SCRATCH above the board, ${TYPING_ROUNDS} rounds of ${TYPING_KEYS} keys; mounted median <= ${TYPING_MOUNTED_MEDIAN_MS} ms/key; parked median <= ${TYPING_PARKED_MEDIAN_MS} ms/key`,
    "sidebar: add one window for the fixture board; collapseWindow({window:{type:\"block\",\"block-uid\"}}); remove only that window by block-uid; never close the sidebar",
    "a sidebar failure is reported and the typing rows still run",
    "typing park: schedule block.move into the closed folder and poll the main .pxd-root; do not await that move promise",
    `pointerup: <= ${POINTERUP_PER_MOUNTED_BOARD} Plexus document pointerup listener per mounted board`,
    "data-calls: wrap roamAlphaAPI.data, data.block, and data.fast; open Daily Notes, then the board; report total and plexus-only (stack contains this build's blob URL); restore",
    `layout-shift after usable: shifts with value > 0 after usable <= ${layoutShiftLimit()} (40.layoutShiftsAfterUsable in tools/live/perf-budgets.json, default 0). Separate from the long-task ceilings`,
    `node budgets: tools/live/perf-budgets.json (40-card dataCallsPerOpen <= ${PERF_BUDGETS["40"].dataCallsPerOpen})`,
    "version: window.__plexusDiagram.version on the running build",
    'cleanup: ledger cleanup deletes this script\'s blocks on "Plexus Diagram/Test Lab"',
  ].join("\n");
}

export function exitCode(result, error) {
  if (error) return error.code === "refused" || error.code === "no-target" ? 1 : 2;
  return result?.ok ? 0 : 1;
}

// Browser-side ops. Stringified into the page; it must not close over this module.
export async function pageApi(arg) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const get = (obj, key) => obj?.[key] ?? obj?.[":" + key];
  function findSidebarEl(boardUid, windowId) {
    const sidebar = document.querySelector("#right-sidebar");
    if (!sidebar) return null;
    if (windowId) {
      const byId = document.getElementById(windowId);
      if (byId) return byId;
      const fuzzy = sidebar.querySelector(`.rm-sidebar-window[id*="${CSS.escape(String(windowId))}"]`);
      if (fuzzy) return fuzzy;
    }
    const uid = String(boardUid || "");
    if (!uid) return null;
    const direct = sidebar.querySelector(`.rm-sidebar-window[id*="${CSS.escape(uid)}"]`);
    if (direct) return direct;
    const block = sidebar.querySelector(`[id*="${CSS.escape(uid)}"]`);
    return block ? block.closest(".rm-sidebar-window") : null;
  }
  function plainWindow(win) {
    return {
      type: win?.type || "",
      "block-uid": win?.["block-uid"] || win?.blockUid || "",
      "window-id": win?.["window-id"] || win?.windowId || "",
      "dom-id": win?.["dom-id"] || "",
      collapsed: Boolean(win?.collapsed),
    };
  }
  async function readWindows() {
    const api = window.roamAlphaAPI?.ui?.rightSidebar;
    if (!api?.getWindows) return [];
    const list = await api.getWindows();
    return (list || []).map(plainWindow);
  }
  // Closing a pinned sidebar window asks "Yes, close the window" and the next
  // Roam write waits until that dialog is gone. Only the fixture's dialog is clicked.
  function clickOwnCloseDialog() {
    const dialog = document.querySelector(".bp3-dialog");
    if (!dialog) return false;
    const text = dialog.innerText || "";
    if (!text.includes("PERF-8") || !/close this pinned window/i.test(text)) return false;
    const yes = [...dialog.querySelectorAll("button")].find((node) => /yes, close/i.test(node.textContent || ""));
    if (!yes) return false;
    yes.click();
    return true;
  }
  async function finishCall(promise, ms, label) {
    let settled = false;
    let failure = null;
    // Do not await the Roam promise after the deadline. A mounted diagram's
    // block.move stays pending while this evaluate is the thing waiting on it.
    Promise.resolve(promise).then(() => { settled = true; }, (error) => {
      settled = true;
      failure = error;
    });
    const t0 = performance.now();
    while (!settled && performance.now() - t0 < ms) {
      clickOwnCloseDialog();
      await sleep(100);
    }
    if (!settled) throw new Error(`${label} timed out`);
    if (failure) throw failure;
  }
  // Run a write after this evaluate returns. Awaiting it here never settles.
  function releaseWrite(work) {
    setTimeout(() => {
      try { Promise.resolve(work()).catch(() => {}); }
      catch { /* the node side polls the DOM */ }
    }, 0);
  }
  async function watch(ms, during) {
    const origin = performance.now();
    const tasks = [];
    let supported = true;
    let observer = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration });
      });
      observer.observe({ type: "longtask", buffered: false });
    } catch { supported = false; }
    let frames = 0;
    let run = true;
    const tick = () => { frames += 1; if (run) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    try {
      if (during) during();
      await sleep(ms);
      run = false;
      await sleep(150);
    } finally {
      run = false;
      try { observer?.disconnect(); } catch { /* already off */ }
    }
    return { supported, origin, tasks, frames, windowMs: ms };
  }

  // Layout shifts for the gate. Kept inside pageApi because this function is stringified into the page.
  // Usable for the mount window is the first .pxd-item. The data-calls navigation sits between
  // shifts-hold and the idle stamp, so that scripted page change is not an after-usable failure.
  function regionOf(node) {
    let el = node;
    if (el && el.nodeType === 3) el = el.parentElement;
    if (!el || typeof el.closest !== "function") return null;
    if (el.closest(".pxd-item")) return "cards";
    if (el.closest(".pxd-toolbar") || el.closest(".pxd-dock")) return "chrome";
    if (el.closest(".pxd-panel")) return "panel";
    if (el.closest(".pxd-root")) return null;
    return "page";
  }
  function snapshotHeights() {
    const heights = {};
    const nodes = document.querySelectorAll(".pxd-root .pxd-item");
    for (const card of nodes) {
      if (!card || card.hidden || (card.style && card.style.display === "none")) continue;
      const uid = card.getAttribute("data-uid") || "";
      if (!uid || Object.prototype.hasOwnProperty.call(heights, uid)) continue;
      const box = card.getBoundingClientRect();
      heights[uid] = box ? box.height : 0;
    }
    return heights;
  }
  function grownSince(before) {
    if (!before) return 0;
    const now = snapshotHeights();
    let grown = 0;
    for (const uid of Object.keys(before)) {
      if (!Object.prototype.hasOwnProperty.call(now, uid)) continue;
      if (now[uid] - before[uid] > 1) grown += 1;
    }
    return grown;
  }
  function ensureShiftWatch() {
    const existing = window.__pxdGateShifts;
    if (existing && (existing.observer || existing.stopped)) return existing;
    const state = existing || {
      usableAt: null, entries: [], heights: null, observer: null, raf: 0, gateAt: null, epoch: 0, stopped: false,
    };
    window.__pxdGateShifts = state;
    if (!state.entries) state.entries = [];
    state.epoch = (state.epoch || 0) + 1;
    const epoch = state.epoch;
    const mark = () => {
      state.raf = 0;
      if (state.stopped || state.epoch !== epoch || state.usableAt != null) return;
      const item = document.querySelector(".pxd-root .pxd-item");
      if (item) {
        state.usableAt = performance.now();
        state.heights = snapshotHeights();
        return;
      }
      state.raf = requestAnimationFrame(mark);
    };
    try {
      const observer = new PerformanceObserver((list) => {
        const found = typeof list.getEntries === "function" ? list.getEntries() : [];
        for (const entry of found) {
          const sources = entry.sources || [];
          const node = sources.length ? sources[0] && sources[0].node : null;
          state.entries.push({
            value: entry.value,
            startTime: entry.startTime,
            hadRecentInput: Boolean(entry.hadRecentInput),
            region: regionOf(node),
          });
        }
      });
      const attempts = [
        { type: "layout-shift", buffered: true },
        { type: "layout-shift" },
        { entryTypes: ["layout-shift"] },
      ];
      let armed = false;
      for (const opts of attempts) {
        try { observer.observe(opts); armed = true; break; } catch { /* next shape */ }
      }
      if (!armed) { try { observer.disconnect(); } catch { /* gone */ } }
      else state.observer = observer;
    } catch { /* this Chrome has no layout-shift observer */ }
    if (!state.stopped && state.usableAt == null) state.raf = requestAnimationFrame(mark);
    return state;
  }
  function stampGateUsable() {
    const state = ensureShiftWatch();
    if (!state || state.stopped || state.gateAt != null) return state;
    if (!document.querySelector(".pxd-root .pxd-item")) return state;
    state.gateAt = performance.now();
    state.usableAt = state.gateAt;
    state.heights = snapshotHeights();
    return state;
  }
  function cancelShiftFrame(state) {
    if (!state || !state.raf) return;
    try { cancelAnimationFrame(state.raf); } catch { /* stub */ }
    state.raf = 0;
  }
  function takeShiftSample(opts) {
    const state = window.__pxdGateShifts || (opts && opts.stop ? null : ensureShiftWatch());
    if (!state) return { usableAt: null, grown: 0, entries: [] };
    const payload = {
      usableAt: state.usableAt,
      grown: typeof state.usableAt === "number" ? grownSince(state.heights) : 0,
      entries: state.entries || [],
    };
    if (opts && opts.reset) {
      state.epoch = (state.epoch || 0) + 1;
      cancelShiftFrame(state);
      state.entries = [];
      state.usableAt = null;
      state.heights = null;
      state.gateAt = null;
    }
    if (opts && opts.stop) {
      state.stopped = true;
      state.epoch = (state.epoch || 0) + 1;
      cancelShiftFrame(state);
      try { state.observer && state.observer.disconnect(); } catch { /* off */ }
      state.observer = null;
    }
    return payload;
  }

  if (arg.op === "create") {
    const api = window.roamAlphaAPI;
    const px = window.__plexusDiagram;
    const uids = [];
    const note = (uid, why) => { if (uid && why) uids.push({ uid, why }); };
    const page = arg.page;
    const graph = (location.hash.match(/#\/app\/([^/]+)/) || [])[1] || "";
    let session = null;
    try {
      ensureShiftWatch();
      if (!px?.session) return { ok: false, reason: "no-session-api", uids, graph, page, version: px?.version || null };
      await api.ui.mainWindow.openPage({ page: { title: page } });
      await sleep(400);
      let pageRow = api.data.pull("[:block/uid]", [":node/title", page]);
      let pageUid = get(pageRow, "block/uid") || null;
      if (!pageUid) {
        pageUid = api.util.generateUID();
        await api.data.page.create({ page: { title: page, uid: pageUid } });
        note(pageUid, "page");
      }
      const boardUid = api.util.generateUID();
      await api.data.block.create({
        location: { "parent-uid": pageUid, order: "last" },
        block: { uid: boardUid, string: `{{[[diagram]]:${arg.title}}}` },
      });
      note(boardUid, "board");
      session = px.session(boardUid);
      await session.enhance();
      const counts = { note: 0, image: 0, pdf: 0, page: 0 };
      let index = 0;
      for (const card of arg.cards || []) {
        let string = card.string;
        // Reuse media already in the graph: no uploads per run, and a real PDF exercises PDF.js.
        if (card.kind === "image") {
          const img = api.q('[:find ?s . :where [?b :block/string ?s] [(clojure.string/starts-with? ?s "![](https://firebasestorage")]]');
          const url = typeof img === "string" ? (img.match(/!\[\]\((https:[^)\s]+)\)/) || [])[1] : null;
          if (!url) throw new Error("no existing image block to reuse");
          string = `![](${url})`;
        }
        if (card.kind === "pdf") {
          const pdf = api.q('[:find ?u . :where [?b :block/string ?s] [(clojure.string/starts-with? ?s "{{[[pdf]]: https://firebasestorage")] [?b :block/uid ?u]]');
          if (typeof pdf === "string") string = `((${pdf}))`;
        }
        const col = index % 8;
        const row = Math.floor(index / 8);
        const uid = await session.createCard({ x: 40 + col * 280, y: 40 + row * 200, string });
        note(uid, card.kind);
        counts[card.kind] = (counts[card.kind] || 0) + 1;
        index += 1;
      }
      const scratchUid = api.util.generateUID();
      await api.data.block.create({
        location: { "parent-uid": pageUid, order: "first" },
        block: { uid: scratchUid, string: "" },
      });
      note(scratchUid, "scratch");
      await api.data.block.move({ location: { "parent-uid": pageUid, order: 1 }, block: { uid: boardUid } });
      const folderUid = api.util.generateUID();
      await api.data.block.create({
        location: { "parent-uid": pageUid, order: "last" },
        block: { uid: folderUid, string: "PERF-8 park", open: false },
      });
      note(folderUid, "park-folder");
      await api.ui.mainWindow.openPage({ page: { title: page } });
      await sleep(500);
      return {
        ok: Boolean(counts.note && counts.image && counts.pdf && counts.page),
        graph, page, pageUid, boardUid, scratchUid, folderUid, counts, uids,
        version: px.version || null,
        roots: document.querySelectorAll(".roam-main .pxd-root").length,
      };
    } catch (error) {
      return { ok: false, reason: String(error && error.message || error), uids, graph, page };
    } finally {
      try { session?.release(); } catch { /* the view acquires its own session */ }
    }
  }

  if (arg.op === "version") {
    return { version: window.__plexusDiagram?.version || "" };
  }

  if (arg.op === "idle") {
    stampGateUsable();
    return watch(arg.ms);
  }

  if (arg.op === "shifts-hold") return takeShiftSample({ reset: true });

  if (arg.op === "shifts") return takeShiftSample({ stop: true });

  if (arg.op === "shifts-stop") {
    const state = window.__pxdGateShifts;
    if (state) takeShiftSample({ stop: true });
    return { stopped: true };
  }

  if (arg.op === "data-calls") {
    const api = window.roamAlphaAPI;
    const marker = String(arg.marker || "");
    const counts = { total: 0, plexus: 0, names: {} };
    const saved = [];
    const wrapObject = (obj, prefix) => {
      if (!obj || typeof obj !== "object") return;
      let names = [];
      try { names = Object.getOwnPropertyNames(obj); } catch { return; }
      for (const name of names) {
        if (name === "constructor" || name === "prototype") continue;
        let fn;
        try { fn = obj[name]; } catch { continue; }
        if (typeof fn !== "function") continue;
        const wrapped = function (...args) {
          counts.total += 1;
          counts.names[prefix ? `${prefix}.${name}` : name] = (counts.names[prefix ? `${prefix}.${name}` : name] || 0) + 1;
          const stack = new Error().stack || "";
          if (marker && stack.includes(marker)) counts.plexus += 1;
          return fn.apply(this, args);
        };
        try { obj[name] = wrapped; } catch { continue; }
        saved.push([obj, name, fn]);
      }
    };
    wrapObject(api.data, "");
    wrapObject(api.data && api.data.block, "block");
    wrapObject(api.data && api.data.fast, "fast");
    let items = 0;
    try {
      const ui = api.ui.mainWindow;
      const today = api.util?.dateToPageTitle?.(new Date()) || "";
      if (typeof ui.openDailyNotes === "function") await ui.openDailyNotes();
      else if (today) await ui.openPage({ page: { title: today } });
      await sleep(2500);
      await ui.openBlock({ block: { uid: arg.boardUid } });
      const t0 = performance.now();
      while (performance.now() - t0 < 20000) {
        items = document.querySelectorAll(".pxd-item").length;
        if (items >= 30) break;
        await sleep(100);
      }
      await sleep(4000);
      return { total: counts.total, plexus: counts.plexus, items };
    } finally {
      for (const [obj, name, fn] of saved) obj[name] = fn;
      await api.ui.mainWindow.openPage({ page: { title: arg.page } });
      await sleep(600);
    }
  }

  if (arg.op === "sidebar-add") {
    const api = window.roamAlphaAPI?.ui?.rightSidebar;
    if (!api?.addWindow || !api.getWindows) return { ok: false, reason: "no-sidebar-api", before: [], after: [] };
    const before = await readWindows();
    await api.addWindow({ window: { type: "block", "block-uid": arg.boardUid } });
    const t0 = performance.now();
    let domId = "";
    while (performance.now() - t0 < 4000) {
      const el = findSidebarEl(arg.boardUid, "");
      if (el?.querySelector(".pxd-root")) { domId = el.id || ""; break; }
      if (el && !domId) domId = el.id || "";
      await sleep(100);
    }
    try {
      await finishCall(api.unpinWindow({ window: { type: "block", "block-uid": arg.boardUid } }), 3000, "unpin");
    } catch { /* remove handles a window that stayed pinned */ }
    const after = await readWindows();
    return { ok: true, before, after, domId };
  }

  if (arg.op === "sidebar-mode") {
    const el = findSidebarEl(arg.boardUid, arg.windowId);
    const root = el?.querySelector(".pxd-root");
    const button = root?.querySelector(arg.mode === "outline" ? ".pxd-mode__outline" : ".pxd-mode__board");
    if (!button) return { ok: false, reason: "no-mode-button" };
    button.click();
    await sleep(arg.settleMs || 500);
    return { ok: true, outline: root.classList.contains("pxd-root--outline") };
  }

  if (arg.op === "sidebar-outline") {
    const el = findSidebarEl(arg.boardUid, arg.windowId);
    const root = el?.querySelector(".pxd-root");
    const button = root?.querySelector(".pxd-mode__outline");
    if (!button) return { supported: false, reason: "no-outline-button", origin: performance.now(), tasks: [], frames: 0 };
    return watch(arg.ms, () => { button.click(); });
  }

  if (arg.op === "sidebar-park") {
    const api = window.roamAlphaAPI?.ui?.rightSidebar;
    const el = findSidebarEl(arg.boardUid, arg.windowId);
    if (!el) return { ok: false, reason: "no-window", roots: -1 };
    const board = String(arg.boardUid || "");
    let apiError = "";
    try {
      await api?.collapseWindow?.({ window: { type: "block", "block-uid": board } });
    } catch (error) {
      apiError = String(error && error.message || error);
    }
    await sleep(400);
    const readFlag = async () => {
      const wins = api?.getWindows ? await api.getWindows() : [];
      const row = (wins || []).find((win) => String(win?.["block-uid"] || "") === board || String(win?.["window-id"] || "").includes(board));
      return { row, collapsed: row ? row["collapsed?"] === true || row.collapsed === true : false };
    };
    let state = await readFlag();
    if (!state.collapsed) {
      const caret = el.querySelector(".window-headers .rm-caret, .rm-caret");
      if (caret && !String(caret.className).includes("rm-caret-closed")) caret.click();
      await sleep(400);
      state = await readFlag();
    }
    const caret = el.querySelector(".window-headers .rm-caret, .rm-caret");
    return {
      ok: true,
      roots: el.querySelectorAll(".pxd-root").length,
      collapsed: state.collapsed,
      caret: caret ? String(caret.className) : "",
      className: String(el.className || ""),
      domId: el.id || "",
      windowId: state.row?.["window-id"] || "",
      height: Math.round(el.getBoundingClientRect().height),
      apiError,
    };
  }

  if (arg.op === "sidebar-remove") {
    const api = window.roamAlphaAPI?.ui?.rightSidebar;
    if (!api?.removeWindow) return { ok: false, reason: "no-sidebar-api", after: await readWindows() };
    const board = String(arg.boardUid || "");
    for (const win of arg.windows || []) {
      const uid = String(win["block-uid"] || "");
      const id = String(win["window-id"] || "");
      if (uid && uid !== board) continue;
      if (!uid && id && !id.includes(board)) continue;
      const blockUid = uid || board;
      const type = win.type || "block";
      if (!blockUid) continue;
      const spec = { window: { type, "block-uid": blockUid } };
      try { await api.expandWindow?.({ window: { type, "block-uid": blockUid } }); } catch { /* already expanded */ }
      try { await finishCall(api.unpinWindow?.({ window: { type, "block-uid": blockUid } }), 3000, "unpin"); } catch { /* already unpinned */ }
      try {
        await finishCall(api.removeWindow(spec), 5000, "remove");
      } catch {
        const el = findSidebarEl(blockUid, id);
        const cross = el?.querySelector?.(".window-headers .bp3-icon-cross");
        if (cross) cross.click();
        const t0 = performance.now();
        while (performance.now() - t0 < 2000) {
          if (clickOwnCloseDialog()) break;
          await sleep(100);
        }
      }
    }
    clickOwnCloseDialog();
    await sleep(400);
    return { ok: true, after: await readWindows() };
  }

  if (arg.op === "roots") {
    return {
      main: document.querySelectorAll(".roam-main .pxd-root").length,
      side: document.querySelectorAll("#right-sidebar .pxd-root").length,
      all: document.querySelectorAll(".pxd-root").length,
    };
  }

  if (arg.op === "park-main") {
    const api = window.roamAlphaAPI;
    clickOwnCloseDialog();
    const folderUid = arg.folderUid;
    const boardUid = arg.boardUid;
    releaseWrite(() => api.data.block.move({ location: { "parent-uid": folderUid, order: "last" }, block: { uid: boardUid } }));
    releaseWrite(() => api.data.block.update({ block: { uid: folderUid, open: false } }));
    return { roots: document.querySelectorAll(".roam-main .pxd-root").length, started: true };
  }

  if (arg.op === "unpark-main") {
    const api = window.roamAlphaAPI;
    clickOwnCloseDialog();
    const folderUid = arg.folderUid;
    const boardUid = arg.boardUid;
    const pageUid = arg.pageUid;
    releaseWrite(() => api.data.block.update({ block: { uid: folderUid, open: true } }));
    releaseWrite(() => api.data.block.move({ location: { "parent-uid": pageUid, order: 1 }, block: { uid: boardUid } }));
    return { roots: document.querySelectorAll(".roam-main .pxd-root").length, started: true };
  }

  if (arg.op === "caret") {
    document.querySelectorAll(".iziToast-overlay, .iziToast-wrapper").forEach((node) => node.remove());
    const el = document.querySelector(`.rm-block__input[id$="-${arg.uid}"], textarea[id$="-${arg.uid}"]`);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const box = el.getBoundingClientRect();
    return { x: box.x + Math.min(48, Math.max(12, box.width / 2)), y: box.y + Math.min(box.height / 2, 14) };
  }

  return { ok: false, reason: "unknown-op" };
}

function openCdp(ws) {
  const pending = new Map();
  const listeners = new Set();
  let nextId = 1;
  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.method) {
      for (const fn of listeners) {
        try { fn(msg); } catch { /* a listener must not break rpc */ }
      }
    }
    if (msg.id == null || !pending.has(msg.id)) return;
    const waiter = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(waiter.timer);
    if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error).slice(0, 400)));
    else waiter.resolve(msg.result ?? msg);
  });
  function rpc(method, params, timeoutMs = 120000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
        if (method !== "Runtime.terminateExecution") {
          rpc("Runtime.terminateExecution", {}, 2000).catch(() => {});
        }
      }, timeoutMs);
      pending.set(id, { timer, resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression, timeoutMs = 120000) {
    const ms = Number.isFinite(timeoutMs) ? timeoutMs : 120000;
    const result = await rpc("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      timeout: ms,
    }, ms + 3000);
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails).slice(0, 500));
    }
    return result.result?.value;
  }
  return {
    rpc,
    evaluate,
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() { try { ws.close(); } catch { /* already closed */ } },
  };
}

async function plexusBlobUrl(cdp) {
  const scripts = new Map();
  const off = cdp.listen?.((msg) => {
    if (msg.method !== "Debugger.scriptParsed") return;
    const url = msg.params?.url || "";
    if (url.startsWith("blob:")) scripts.set(String(msg.params.scriptId), url);
  }) || (() => {});
  try {
    await cdp.rpc("Debugger.enable");
    const evaluated = await cdp.rpc("Runtime.evaluate", {
      expression: "window.__plexusDiagram && window.__plexusDiagram.session",
    });
    const objectId = evaluated.result?.objectId;
    if (!objectId) return "";
    const props = await cdp.rpc("Runtime.getProperties", { objectId, ownProperties: true });
    const loc = (props.internalProperties || []).find((row) => row.name === "[[FunctionLocation]]");
    const scriptId = loc?.value?.value?.scriptId || loc?.value?.scriptId;
    if (scriptId && scripts.has(String(scriptId))) return scripts.get(String(scriptId));
    if (!scriptId) return "";
    const got = await cdp.rpc("Debugger.getScriptSource", { scriptId: String(scriptId) });
    if (!isPlexusSource(got.scriptSource || "")) return "";
    return scripts.get(String(scriptId)) || "";
  } finally {
    off();
    try { await cdp.rpc("Debugger.disable"); } catch { /* already off */ }
  }
}

async function connectTarget(sel) {
  const port = process.env.CDP_PORT || 9223;
  const pages = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((row) => row.type === "page");
  const target = pages.find((row) => row.id.startsWith(sel)) || pages.find((row) => (row.title || "").includes(sel));
  if (!target) {
    const error = new Error(`no target ${sel}`);
    error.code = "no-target";
    throw error;
  }
  if (windowTitleRefused(target.title || "")) {
    const error = new Error(`refused: another session owns ${target.title}`);
    error.code = "refused";
    throw error;
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("cdp socket error")), { once: true });
  });
  return { cdp: openCdp(ws), title: target.title || "" };
}

function boardMoveExpression(arg) {
  const boardUid = JSON.stringify(arg.boardUid || "");
  const folderUid = JSON.stringify(arg.folderUid || "");
  const pageUid = JSON.stringify(arg.pageUid || "");
  const move = arg.op === "park-main"
    ? `api.data.block.move({ location: { "parent-uid": folderUid, order: "last" }, block: { uid: boardUid } });
      api.data.block.update({ block: { uid: folderUid, open: false } });`
    : `api.data.block.update({ block: { uid: folderUid, open: true } });
      api.data.block.move({ location: { "parent-uid": pageUid, order: 1 }, block: { uid: boardUid } });`;
  return `(() => {
    const boardUid = ${boardUid};
    const folderUid = ${folderUid};
    const pageUid = ${pageUid};
    const api = window.roamAlphaAPI;
    setTimeout(() => { try { ${move} } catch (e) {} }, 0);
    return document.querySelectorAll(".roam-main .pxd-root").length;
  })()`;
}

function caretExpression(uid) {
  const id = JSON.stringify(String(uid || ""));
  return `(() => {
    const uid = ${id};
    document.querySelectorAll(".iziToast-overlay, .iziToast-wrapper").forEach((node) => node.remove());
    const el = document.querySelector('.rm-block__input[id$="-' + uid + '"], textarea[id$="-' + uid + '"]');
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const box = el.getBoundingClientRect();
    return { x: box.x + Math.min(48, Math.max(12, box.width / 2)), y: box.y + Math.min(box.height / 2, 14) };
  })()`;
}

async function callPage(cdp, arg, timeoutMs) {
  const ms = Number.isFinite(timeoutMs) ? timeoutMs : 120000;
  if (arg?.op === "roots") {
    return cdp.evaluate(`(() => ({
      main: document.querySelectorAll(".roam-main .pxd-root").length,
      side: document.querySelectorAll("#right-sidebar .pxd-root").length,
      all: document.querySelectorAll(".pxd-root").length,
    }))()`, ms);
  }
  if (arg?.op === "park-main" || arg?.op === "unpark-main") {
    const roots = await cdp.evaluate(boardMoveExpression(arg), ms);
    return { roots, started: true };
  }
  if (arg?.op === "caret") return cdp.evaluate(caretExpression(arg.uid), ms);
  const expr = `globalThis.__pxdPerfArg = ${JSON.stringify(arg)};\n(${pageApi.toString()})(globalThis.__pxdPerfArg)`;
  return cdp.evaluate(expr, ms);
}

function idleMs(sample) {
  if (!sample || sample.supported === false) return null;
  return longTaskSummary(sample.tasks, sample.origin, SAMPLE_MS).longMs;
}

async function countPointerup(cdp) {
  await cdp.rpc("Debugger.enable");
  try {
    const evaluated = await cdp.rpc("Runtime.evaluate", { expression: "document" });
    const objectId = evaluated.result?.objectId;
    if (!objectId) throw new Error("no document object");
    const listed = await cdp.rpc("DOMDebugger.getEventListeners", { objectId });
    const listeners = listed.listeners || [];
    const sources = new Map();
    for (const listener of listeners) {
      if (listener.type !== "pointerup" || !listener.scriptId || sources.has(listener.scriptId)) continue;
      try {
        const got = await cdp.rpc("Debugger.getScriptSource", { scriptId: listener.scriptId });
        sources.set(listener.scriptId, got.scriptSource || "");
      } catch {
        sources.set(listener.scriptId, "");
      }
    }
    const boards = await cdp.evaluate(`document.querySelectorAll(".pxd-root").length`);
    return { listeners: countPlexusPointerup(listeners, sources), boards: Number(boards) || 0 };
  } finally {
    try { await cdp.rpc("Debugger.disable"); } catch { /* already off */ }
  }
}

const SENTENCE = "the quick brown fox jumps over the lazy dog ";

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

async function focusScratch(cdp, uid) {
  let active = "";
  let box = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    box = await callPage(cdp, { op: "caret", uid });
    if (!box) throw new Error("no block editor");
    await cdp.rpc("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp.rpc("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", buttons: 0, clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    active = await cdp.evaluate(`document.activeElement && document.activeElement.className`);
    if (String(active).includes("rm-block__input")) return;
  }
  throw new Error(`editor not focused: ${active}`);
}

async function typeKeys(cdp, count) {
  const text = SENTENCE.repeat(Math.ceil(count / SENTENCE.length)).slice(0, count);
  await cdp.evaluate(`(() => {
    window.__pxdPerfSamples = [];
    if (window.__pxdPerfOff) window.__pxdPerfOff();
    const onKey = () => {
      const t0 = performance.now();
      requestAnimationFrame(() => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => window.__pxdPerfSamples.push(performance.now() - t0);
        channel.port2.postMessage(0);
      });
    };
    document.addEventListener("keydown", onKey, true);
    window.__pxdPerfOff = () => document.removeEventListener("keydown", onKey, true);
  })()`);
  for (const ch of text) {
    const params = keyParams(ch);
    await cdp.rpc("Input.dispatchKeyEvent", { type: "keyDown", ...params });
    await cdp.rpc("Input.dispatchKeyEvent", { type: "keyUp", ...params, text: undefined, unmodifiedText: undefined });
    await new Promise((resolve) => setTimeout(resolve, KEY_GAP_MS));
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  const samples = JSON.parse(await cdp.evaluate(`JSON.stringify(window.__pxdPerfSamples || [])`));
  await cdp.evaluate(`window.__pxdPerfOff && window.__pxdPerfOff()`);
  const mean = samples.length ? samples.reduce((sum, n) => sum + n, 0) / samples.length : null;
  return mean == null ? null : round2(mean);
}

async function listenerEntries(cdp, target) {
  const evaluated = await cdp.rpc("Runtime.evaluate", { expression: `getEventListeners(${target})`, includeCommandLineAPI: true }, 8000);
  if (evaluated.exceptionDetails) throw new Error("getEventListeners failed");
  const rootId = evaluated.result?.objectId;
  if (!rootId) return [];
  const props = await cdp.rpc("Runtime.getProperties", { objectId: rootId, ownProperties: true }, 8000);
  const entries = [];
  for (const prop of props.result || []) {
    if (!prop.value?.objectId || prop.name === "__proto__") continue;
    const list = await cdp.rpc("Runtime.getProperties", { objectId: prop.value.objectId, ownProperties: true }, 8000);
    for (const item of list.result || []) {
      if (!/^\d+$/.test(item.name) || !item.value?.objectId) continue;
      const fields = await cdp.rpc("Runtime.getProperties", { objectId: item.value.objectId, ownProperties: true }, 8000);
      const map = new Map((fields.result || []).map((row) => [row.name, row.value]));
      const listener = map.get("listener");
      if (!listener?.objectId) continue;
      entries.push({
        target,
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

async function functionScriptId(cdp, objectId) {
  const props = await cdp.rpc("Runtime.getProperties", { objectId, ownProperties: true }, 8000);
  const loc = (props.internalProperties || []).find((row) => row.name === "[[FunctionLocation]]");
  return loc?.value?.value?.scriptId || null;
}

async function withBaselineListeners(cdp, run) {
  const urls = new Map();
  const off = cdp.listen?.((msg) => {
    if (msg.method !== "Debugger.scriptParsed") return;
    urls.set(String(msg.params.scriptId), msg.params.url || "");
  }) || (() => {});
  await cdp.rpc("Debugger.enable");
  const cache = new Map();
  const marker = cdp.plexusMarker || "";
  try {
    for (const target of ["document", "window"]) {
      for (const entry of await listenerEntries(cdp, target)) {
        const scriptId = await functionScriptId(cdp, entry.listenerId);
        if (!scriptId) continue;
        const id = String(scriptId);
        if (!cache.has(id)) {
          const url = urls.get(id) || "";
          if (marker && url === marker) cache.set(id, true);
          else if (url && url !== marker) cache.set(id, false);
          else {
            try {
              const got = await cdp.rpc("Debugger.getScriptSource", { scriptId: id }, 8000);
              cache.set(id, isPlexusSource(got.scriptSource || ""));
            } catch {
              cache.set(id, false);
            }
          }
        }
        if (!cache.get(id)) continue;
        const called = await cdp.rpc("Runtime.callFunctionOn", {
          objectId: entry.listenerId,
          functionDeclaration: `function(meta) {
            const node = meta.target === "window" ? window : document;
            node.removeEventListener(meta.type, this, meta.useCapture);
            (window.__pxdPerfListeners || (window.__pxdPerfListeners = [])).push({
              target: meta.target, type: meta.type, useCapture: meta.useCapture, passive: meta.passive, once: meta.once, fn: this,
            });
            return true;
          }`,
          arguments: [{ value: { target: entry.target, type: entry.type, useCapture: entry.useCapture, passive: entry.passive, once: entry.once } }],
          returnByValue: true,
        }, 8000);
        if (called.exceptionDetails) throw new Error("removeEventListener failed");
      }
    }
    try { await cdp.rpc("Debugger.disable"); } catch { /* already off */ }
    return await run();
  } finally {
    off();
    try { await cdp.rpc("Debugger.disable"); } catch { /* already off */ }
    await cdp.evaluate(`(() => {
      const bag = window.__pxdPerfListeners || [];
      for (const row of bag) {
        const node = row.target === "window" ? window : document;
        node.addEventListener(row.type, row.fn, { capture: Boolean(row.useCapture), passive: Boolean(row.passive), once: Boolean(row.once) });
      }
      window.__pxdPerfListeners = [];
      return bag.length;
    })()`, 8000);
  }
}

async function typeSample(cdp, uid, kind, deps) {
  if (deps.typeSample) return deps.typeSample(cdp, uid, kind);
  if (kind === "baseline") {
    return withBaselineListeners(cdp, async () => {
      await focusScratch(cdp, uid);
      return typeKeys(cdp, TYPING_KEYS);
    });
  }
  await focusScratch(cdp, uid);
  return typeKeys(cdp, TYPING_KEYS);
}

function noteSidebarWindows(warn, label, before, after, removedKeys) {
  if (!Array.isArray(after)) {
    warn(`${label}: window list missing`);
    return { missing: [], stillThere: removedKeys || [], ok: false };
  }
  const intact = sidebarStillIntact(before, after, removedKeys);
  warn(`${label}: ${before.length} -> ${after.length}; missing ${intact.missing.length}, left ${intact.stillThere.length}`);
  return intact;
}

async function liveGate(windowSel, deps, warn) {
  const connect = deps.connect || connectTarget;
  const invoke = deps.callPage || callPage;
  const listen = deps.countPointerup || countPointerup;
  const ledger = deps.ledger || ((entry) => appendEntry(entry));
  const cleanupFn = deps.cleanup || cleanup;
  const { cdp, title } = await connect(windowSel);
  let wrote = false;
  let added = [];
  let boardUid = "";
  let beforeWindows = [];
  const report = { main: {}, sidebar: {}, typing: {}, pointerupSamples: [], dataCalls: null, dataCallsTotal: null, version: "" };
  try {
    warn(`window ${title}`);
    try {
      const versionRow = await invoke(cdp, { op: "version" });
      report.version = versionRow?.version || "";
    } catch (error) {
      warn(`version read failed: ${error.message || error}`);
    }
    warn(`version ${report.version || "unknown"}`);
    const created = await invoke(cdp, {
      op: "create",
      page: PAGE,
      title: BOARD_TITLE,
      cards: fixtureCardSpecs(PAGE),
    });
    if (!report.version && created?.version) report.version = created.version;
    for (const entry of fixtureEntries(created)) ledger(entry);
    if ((created?.uids || []).length) wrote = true;
    if (!created?.ok || !fixtureComplete(created.counts)) {
      throw new Error(created?.reason || `fixture incomplete ${JSON.stringify(created?.counts || null)}`);
    }
    boardUid = created.boardUid;
    warn(`fixture ${created.boardUid} scratch ${created.scratchUid} ${report.version || ""}`);
    let roots = await invoke(cdp, { op: "roots" });
    if (!roots || roots.main < 1) throw new Error("board did not mount in the main column");

    let shiftCount = 0;
    let shiftBroken = false;
    try {
      const held = await invoke(cdp, { op: "shifts-hold" });
      // Mount window: card growth only. Layout-shift entries are judged after the idle stamp,
      // once the gate's own open and data-calls navigation are in the past.
      shiftCount += summarizeGateShifts({ usableAt: held?.usableAt, grown: held?.grown, entries: [] });
    } catch (error) {
      warn(`layout shifts (mount) failed: ${error.message || error}`);
      shiftBroken = true;
    }

    let marker = "";
    try {
      marker = await plexusBlobUrl(cdp);
    } catch (error) {
      warn(`plexus blob failed: ${error.message || error}`);
    }
    warn(`plexus blob ${marker || "missing"}`);
    cdp.plexusMarker = marker || "";
    try {
      const calls = await invoke(cdp, { op: "data-calls", boardUid, page: PAGE, marker });
      report.dataCalls = Number.isFinite(calls?.plexus) ? calls.plexus : null;
      report.dataCallsTotal = Number.isFinite(calls?.total) ? calls.total : null;
      warn(`data calls total ${report.dataCallsTotal ?? "n/a"} plexus ${report.dataCalls ?? "n/a"} items ${calls?.items ?? "n/a"}`);
    } catch (error) {
      warn(`data calls failed: ${error.message || error}`);
      report.dataCalls = null;
    }
    roots = await invoke(cdp, { op: "roots" });
    for (let attempt = 0; (!roots || roots.main < 1) && attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      roots = await invoke(cdp, { op: "roots" });
    }
    if (!roots || roots.main < 1) throw new Error("board left the main column before the idle sample");

    const mainSample = await invoke(cdp, { op: "idle", ms: SAMPLE_MS });
    report.main.longMs = idleMs(mainSample);
    report.main.frames = mainSample?.frames ?? null;
    warn(`main idle ${report.main.longMs} ms`);

    if (!shiftBroken) {
      try {
        const payload = await invoke(cdp, { op: "shifts" });
        shiftCount += summarizeGateShifts(payload || {});
        report.layoutShiftsAfterUsable = shiftCount;
        warn(`layout shifts after usable ${shiftCount}`);
      } catch (error) {
        warn(`layout shifts failed: ${error.message || error}`);
        report.layoutShiftsAfterUsable = null;
      }
    } else report.layoutShiftsAfterUsable = null;

    try {
      const addedResult = await invoke(cdp, { op: "sidebar-add", boardUid });
      beforeWindows = addedResult?.before || [];
      added = windowsToRemove(beforeWindows, addedResult?.after || [], boardUid, addedResult?.domId || "");
      if (!added.length) throw new Error("sidebar add did not open a window for the fixture board");
      const windowId = added[0]["dom-id"] || addedResult.domId || added[0]["window-id"] || "";
      warn(`sidebar window ${windowId || windowKey(added[0])}`);

      const boardMode = await invoke(cdp, { op: "sidebar-mode", boardUid, windowId, mode: "board", settleMs: SETTLE_MS });
      if (!boardMode?.ok) warn(`sidebar board mode failed: ${boardMode?.reason || "unknown"}`);
      const loaded = await invoke(cdp, { op: "idle", ms: SAMPLE_MS });
      const loadedMs = idleMs(loaded);
      report.sidebar.loadedLongMs = loadedMs;
      report.sidebar.boardLongMs = loadedMs;
      warn(`sidebar board ${loadedMs} ms`);

      try { report.pointerupSamples.push(await listen(cdp)); }
      catch (error) { warn(`pointerup failed: ${error.message || error}`); }

      const outline = await invoke(cdp, { op: "sidebar-outline", boardUid, windowId, ms: SAMPLE_MS });
      report.sidebar.outlineAfter2s = outline?.supported === false
        ? null
        : longTaskSummary(outline.tasks, outline.origin, SAMPLE_MS, OUTLINE_SETTLE_MS).afterSettle;
      warn(`outline long tasks after 2s ${report.sidebar.outlineAfter2s}`);
      await invoke(cdp, { op: "sidebar-mode", boardUid, windowId, mode: "board", settleMs: SETTLE_MS });

      const parked = await invoke(cdp, { op: "sidebar-park", boardUid, windowId });
      const parkedClass = String(parked?.className || "");
      const classCollapsed = parkedClass.includes("rm-sidebar-window--collapsed") || parkedClass.split(/\s+/).includes("collapsed");
      warn(`sidebar collapse collapsed?=${parked?.collapsed === true} class="${parkedClass}" caret="${parked?.caret || ""}" dom="${parked?.domId || ""}" window="${parked?.windowId || ""}" height=${parked?.height ?? "n/a"} roots=${parked?.roots ?? "n/a"}`);
      if (parked?.collapsed && !classCollapsed) {
        warn(`sidebar collapse signal is getWindows collapsed? and rm-caret-closed. The window class stays "${parkedClass}". dom id "${parked?.domId || ""}" is not window-id "${parked?.windowId || ""}". hostHides compares those ids as equal and also looks for rm-sidebar-window--collapsed or collapsed.`);
      }
      if (!parked?.ok || parked.roots !== 0) {
        warn(`sidebar park left ${parked?.roots ?? "n/a"} roots`);
        report.sidebar.parkedLongMs = null;
      } else {
        const parkedSample = await invoke(cdp, { op: "idle", ms: SAMPLE_MS });
        report.sidebar.parkedLongMs = idleMs(parkedSample);
      }
      warn(`sidebar parked ${report.sidebar.parkedLongMs} ms`);

      const removed = await invoke(cdp, { op: "sidebar-remove", boardUid, windows: added });
      const intact = noteSidebarWindows(warn, "sidebar windows", beforeWindows, removed?.after, added.map(windowKey));
      if (intact.ok) added = [];
      else warn(`sidebar windows changed: missing ${intact.missing.length}, left ${intact.stillThere.length}`);
      try { report.pointerupSamples.push(await listen(cdp)); }
      catch (error) { warn(`pointerup failed: ${error.message || error}`); }
    } catch (error) {
      warn(`sidebar failed: ${error.message || error}`);
    }

    async function waitMainRoots(wantZero, ms) {
      const deadline = Date.now() + ms;
      let main = null;
      while (Date.now() < deadline) {
        const row = await invoke(cdp, { op: "roots" }, 8000);
        main = row?.main;
        if (wantZero ? main === 0 : Number(main) > 0) return main;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return main;
    }
    const rounds = [];
    for (let round = 0; round < TYPING_ROUNDS; round += 1) {
      warn(`typing round ${round + 1}`);
      try {
        warn(`typing round ${round + 1} park`);
        await invoke(cdp, { op: "park-main", boardUid, folderUid: created.folderUid }, 8000);
        const parkedRoots = await waitMainRoots(true, 12000);
        warn(`typing round ${round + 1} parked roots ${parkedRoots}`);
        if (parkedRoots !== 0) throw new Error(`park left ${parkedRoots} main roots`);
        warn(`typing round ${round + 1} baseline`);
        const baseline = await typeSample(cdp, created.scratchUid, "baseline", deps);
        warn(`typing round ${round + 1} unpark`);
        await invoke(cdp, { op: "unpark-main", boardUid, folderUid: created.folderUid, pageUid: created.pageUid }, 8000);
        const mountedRoots = await waitMainRoots(false, 12000);
        warn(`typing round ${round + 1} mounted roots ${mountedRoots}`);
        if (!(mountedRoots > 0)) throw new Error(`unpark left ${mountedRoots} main roots`);
        warn(`typing round ${round + 1} mounted`);
        const mounted = await typeSample(cdp, created.scratchUid, "mounted", deps);
        warn(`typing round ${round + 1} repark`);
        await invoke(cdp, { op: "park-main", boardUid, folderUid: created.folderUid }, 8000);
        const reparked = await waitMainRoots(true, 12000);
        warn(`typing round ${round + 1} reparked roots ${reparked}`);
        if (reparked !== 0) throw new Error(`repark left ${reparked} main roots`);
        warn(`typing round ${round + 1} parked`);
        const parkedMean = await typeSample(cdp, created.scratchUid, "parked", deps);
        rounds.push({ baseline, mounted, parked: parkedMean });
        warn(`round ${round + 1} baseline ${baseline} mounted ${mounted} parked ${parkedMean}`);
      } catch (error) {
        warn(`typing round ${round + 1} failed: ${error.message || error}`);
      }
    }
    try {
      warn("unpark");
      await invoke(cdp, { op: "unpark-main", boardUid, folderUid: created.folderUid, pageUid: created.pageUid }, 10000);
      const back = await waitMainRoots(false, 12000);
      if (!(back > 0)) warn(`unpark left ${back} main roots`);
    } catch (error) {
      warn(`unpark failed: ${error.message || error}`);
    }
    const medians = typingMedians(rounds);
    report.typing.mountedMedian = medians.mountedMedian;
    report.typing.parkedMedian = medians.parkedMedian;
    return report;
  } finally {
    try { await invoke(cdp, { op: "shifts-stop" }); } catch { /* already read, or the page is gone */ }
    if (added.length && boardUid) {
      try {
        const removed = await invoke(cdp, { op: "sidebar-remove", boardUid, windows: added });
        const intact = noteSidebarWindows(warn, "sidebar restore", beforeWindows, removed?.after, added.map(windowKey));
        if (!intact.ok) {
          report.sidebarLeak = intact;
          warn(`sidebar restore incomplete: missing ${intact.missing.length}, left ${intact.stillThere.length}`);
        } else added = [];
      } catch (error) {
        report.sidebarLeak = { missing: [], stillThere: added.map(windowKey), ok: false };
        warn(`sidebar remove failed: ${error.message || error}`);
      }
    }
    cdp.close();
    if (wrote) {
      try {
        const result = await cleanupFn(windowSel);
        warn(`cleanup removed ${result?.removed ?? 0}`);
        if (Array.isArray(result?.skipped) && result.skipped.length) {
          const sample = result.skipped.slice(0, 3).map((row) => `${row.uid}:${row.reason}:${row.page || ""}`).join(", ");
          warn(`cleanup skipped ${result.skipped.length} (${sample})`);
        }
      } catch (error) {
        warn(`cleanup failed: ${error.message || error}`);
        report.cleanupFailed = true;
      }
    }
  }
}

export async function runGate(argv, deps = {}) {
  const { dry, windowSel } = parseArgs(argv);
  const log = deps.log || ((line) => console.log(line));
  const warn = deps.warn || ((line) => writeSync(2, `${line}\n`));
  if (dry) {
    log(planText(windowSel));
    return { ok: true, dry: true };
  }
  if (deps.measure) {
    const report = await deps.measure(windowSel);
    const verdict = judge(report);
    log(formatTable(verdict));
    if (deps.cleanup) await deps.cleanup(windowSel);
    return verdict;
  }
  const report = await liveGate(windowSel, deps, warn);
  const verdict = judge(report);
  if (report.version) verdict.version = report.version;
  if (report.cleanupFailed) verdict.ok = false;
  if (report.sidebarLeak) {
    verdict.ok = false;
    verdict.extra.push({
      id: "sidebar-restore",
      metric: "windows left",
      value: report.sidebarLeak.stillThere?.length ?? null,
      limit: 0,
      ok: false,
    });
  }
  if (report.main?.frames != null) verdict.rows[0].checks[0].detail = `${report.main.frames} frames`;
  log(formatTable(verdict));
  return verdict;
}

if (process.argv[1] && process.argv[1].endsWith("perf-gate.mjs")) {
  runGate(process.argv.slice(2)).then((result) => {
    if (!result?.ok) process.exitCode = 1;
  }).catch((error) => {
    console.error(error.message || error);
    process.exitCode = exitCode(null, error);
  });
}
