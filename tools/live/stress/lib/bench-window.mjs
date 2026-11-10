// Bench-window helpers: constants, lock, camera, sidebar, waits, pacing. Only for a Conn with role "bench".
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync, mkdirSync } from "node:fs";
import { sleep } from "./cdp.mjs";

export const GRAPH = "Readwisenotes";
export const BOARD = "KT_KHnsXe";
export const PAGE = "iJg2hcFz2";
export const NESTED = "3g8aFy9ZW,_pwUcy2_7";
export const VP_KEY = `plexus-diagram:vp:${GRAPH}:${BOARD}`;
export const OUT_DIR = process.env.STRESS_OUT || join(homedir(), "wo", "pxd-fast");

// active main view, or null (parked and snapshot mounts are not live; sidebar views are not main)
export const VIEW_JS = `(window.__plexusDiagram && window.__plexusDiagram.views ? (window.__plexusDiagram.views().find((v) => v.root && v.root.isConnected && !v.root.hasAttribute("data-pxd-parked") && !v.root.hasAttribute("data-pxd-snap") && v.root.closest(".roam-article")) || null) : null)`;

const stateDir = () => join(OUT_DIR, "state");
async function ensureState() { await mkdir(stateDir(), { recursive: true }); }
const id8 = (c) => String(c.id).slice(0, 8);

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === "EPERM"; } }

let hooked = false;
const held = new Set(); // lock files this process wrote
function dropHeld() {
  for (const f of held) {
    try { if (new RegExp(`pid=${process.pid}\\s*$`).test(readFileSync(f, "utf8").trim())) unlinkSync(f); } catch { /* gone already */ }
  }
  held.clear();
}
function hookExit() {
  if (hooked) return;
  hooked = true;
  process.on("exit", dropHeld);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { dropHeld(); process.exit(sig === "SIGINT" ? 130 : 143); });
}

// A lock is live when: it has pid=N (not ours, alive, file under 6 h) OR it has no pid, its session word is not ours and it is younger than stalePidlessMs.
// A pid-less lock with our own session word is a manual lock the host wrote: take it over.
function lockHeld(file, session, stalePidlessMs) {
  if (!existsSync(file)) return null;
  const txt = readFileSync(file, "utf8").trim();
  const age = Date.now() - statSync(file).mtimeMs;
  const pid = Number((txt.match(/pid[ =](\d+)/) || [])[1]);
  if (pid) return pid !== process.pid && pidAlive(pid) && age < 6 * 3600 * 1000 ? txt : null;
  return txt.split(/\s+/)[0] !== session && age < stalePidlessMs ? txt : null;
}

export async function acquireLock(c, session = process.env.SHEPHERDR_CHAT || "manual", opts = {}) {
  const file = join(homedir(), "wo", `bench-${id8(c)}.lock`);
  const stalePidlessMs = opts.stalePidlessMs ?? 30 * 60 * 1000;
  const waitMs = opts.waitMs ?? Number(process.env.STRESS_LOCK_WAIT_MS || 30 * 60 * 1000);
  mkdirSync(join(homedir(), "wo"), { recursive: true });
  const t0 = Date.now();
  let said = 0;
  for (;;) {
    const who = lockHeld(file, session, stalePidlessMs);
    if (!who) break;
    if (Date.now() - t0 >= waitMs) throw new Error(`bench window ${id8(c)} is locked by another run (${who}); waited ${Math.round((Date.now() - t0) / 1000)} s; delete ${file} if it is dead`);
    if (!said || Date.now() - said >= 60000) { console.error(`waiting for bench lock: ${who}`); said = Date.now(); }
    await sleep(5000);
  }
  writeFileSync(file, `${session} ${new Date().toISOString()} pid=${process.pid}\n`);
  held.add(file);
  hookExit();
  return function release() {
    try { if (new RegExp(`pid=${process.pid}\\s*$`).test(readFileSync(file, "utf8").trim())) unlinkSync(file); } catch { /* gone already */ }
    held.delete(file);
  };
}

// ---- camera (the key is shared with Svy's own window: never leave it altered)
const VP_SAVED = () => join(stateDir(), "vp-saved.json");
const LISTENER = `(() => { if (window.__pxdStressVpOff) { try { window.__pxdStressVpOff(); } catch (e) {} }
  const h = (e) => { if (e.key === ${JSON.stringify(VP_KEY)} && e.newValue != null) { try { sessionStorage.setItem("pxd-stress-vp", e.newValue); } catch (x) {} } };
  window.addEventListener("storage", h); window.__pxdStressVpOff = () => window.removeEventListener("storage", h); return 1; })()`;

// first value seen per target in THIS process; never read back from disk (vp-saved.json is a crash record only)
const remembered = new Map();

export async function saveCamera(c) {
  await ensureState();
  const key = id8(c);
  if (!remembered.has(key)) {
    const value = await c.ev(`localStorage.getItem(${JSON.stringify(VP_KEY)})`);
    remembered.set(key, value == null ? null : value);
    await c.ev(`(() => { try { sessionStorage.removeItem("pxd-stress-vp"); } catch (e) {} return 1; })()`);
    await writeFile(VP_SAVED(), JSON.stringify({ at: new Date().toISOString(), target: key, value: remembered.get(key), pid: process.pid }));
  }
  await c.ev(LISTENER);
  return remembered.get(key);
}

const VP_DIRTY = () => join(stateDir(), "vp-dirty.json");

export async function setCamera(c, vp) {
  const v = typeof vp === "string" ? vp : JSON.stringify(vp);
  // crash record: the next run puts Svy's value back when this one never got to restoreCamera
  await ensureState();
  const prev = remembered.get(id8(c));
  await writeFile(VP_DIRTY(), JSON.stringify({ at: new Date().toISOString(), target: id8(c), saved: typeof prev === "string" ? prev : null, bench: v }));
  await c.ev(`(localStorage.setItem(${JSON.stringify(VP_KEY)}, ${JSON.stringify(v)}), 1)`);
}

export async function restoreCamera(c) {
  const v = await c.ev(`(() => { try { const n = sessionStorage.getItem("pxd-stress-vp"); if (n) return n; } catch (e) {} return null; })()`);
  const use = v || remembered.get(id8(c)) || null;
  if (use != null) {
    await c.ev(`(localStorage.setItem(${JSON.stringify(VP_KEY)}, ${JSON.stringify(use)}), 1)`);
    try { unlinkSync(VP_DIRTY()); } catch { /* none */ }
  }
  return use;
}

// A previous run died with the bench camera still in the shared key: put Svy's value back when nobody changed it since.
export async function repairCamera(c) {
  let rec = null;
  try { rec = JSON.parse(await readFile(VP_DIRTY(), "utf8")); } catch { return { repaired: false, was: null, now: null }; }
  const was = await c.ev(`localStorage.getItem(${JSON.stringify(VP_KEY)})`);
  let repaired = false;
  if (was != null && was === rec.bench && typeof rec.saved === "string") {
    await c.ev(`(localStorage.setItem(${JSON.stringify(VP_KEY)}, ${JSON.stringify(rec.saved)}), 1)`);
    repaired = true;
  }
  try { unlinkSync(VP_DIRTY()); } catch { /* gone */ }
  return { repaired, was, now: repaired ? rec.saved : was };
}

export async function stubConfirm(c, answer = false) {
  await c.ev(`(() => { window.__pxdStressConfirm0 = window.__pxdStressConfirm0 || window.confirm; window.__pxdStressConfirms = window.__pxdStressConfirms || []; window.confirm = (msg) => { __pxdStressConfirms.push({t: Date.now(), msg: String(msg).slice(0, 200), answer: ${answer ? "true" : "false"}}); return ${answer ? "true" : "false"}; }; return 1; })()`);
  return async function restore() {
    if (c.closed) return;
    await c.ev(`(() => { if (window.__pxdStressConfirm0) window.confirm = window.__pxdStressConfirm0; return 1; })()`);
  };
}

// ---- right sidebar: a reload closes it
const sidebarFile = (c) => join(stateDir(), `sidebar-${id8(c)}.json`);
const savedNonEmpty = new Set();

export async function saveSidebar(c) {
  await ensureState();
  const list = await c.evJson(`(async () => { const api = window.roamAlphaAPI && window.roamAlphaAPI.ui && window.roamAlphaAPI.ui.rightSidebar; if (!api || !api.getWindows) return "[]";
    const w = (await api.getWindows()) || []; return JSON.stringify(w.map((x, i) => ({ type: x.type || "block", "block-uid": x["block-uid"] || x["page-uid"] || "", "page-uid": x["page-uid"] || "", "pinned?": !!x["pinned?"], "collapsed?": !!x["collapsed?"], order: x.order != null ? x.order : i, "window-id": x["window-id"] || "" }))); })()`);
  const f = sidebarFile(c);
  if (!list.length && savedNonEmpty.has(f)) return list; // never overwrite a non-empty save with an empty one
  if (list.length) savedNonEmpty.add(f);
  await writeFile(f, JSON.stringify(list));
  return list;
}

export async function restoreSidebar(c) {
  let list = [];
  try { list = JSON.parse(await readFile(sidebarFile(c), "utf8")); } catch { return { restored: 0 }; }
  if (!list.length) return { restored: 0 };
  list.sort((a, b) => (a.order || 0) - (b.order || 0));
  return c.evJson(`(async () => { const api = window.roamAlphaAPI.ui.rightSidebar; const want = ${JSON.stringify(list)};
    const have = (await api.getWindows()) || []; const key = (w) => (w.type || "block") + ":" + (w["block-uid"] || w["page-uid"] || "");
    const seen = new Set(have.map(key)); let n = 0;
    try { await api.open(); } catch (e) {}
    for (const w of want) { const uid = w["block-uid"] || w["page-uid"]; if (!uid || seen.has(w.type + ":" + uid)) continue;
      const uidArg = (w.type === "outline" || w.type === "mentions") && w["page-uid"] ? w["page-uid"] : uid;
      try { await api.addWindow({ window: { type: w.type, "block-uid": uidArg } }); n++; await new Promise((r) => setTimeout(r, 250)); } catch (e) {}
      if (w["pinned?"]) { try { await api.pinWindow({ window: { type: w.type, "block-uid": uidArg } }); } catch (e) {} }
      if (w["collapsed?"]) { try { await api.collapseWindow({ window: { type: w.type, "block-uid": uidArg } }); } catch (e) {} } }
    return JSON.stringify({ restored: n }); })()`);
}

export const hashOf = (c) => c.ev(`location.hash`);
export async function openDaily(c) { await c.ev(`(window.roamAlphaAPI.ui.mainWindow.openDailyNotes(), 1)`); }
export async function openBoardPage(c) { await c.ev(`(window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid: ${JSON.stringify(PAGE)} } }), 1)`); }

export async function waitLive(c, { timeout = 60000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await c.ev(`(() => { const v = ${VIEW_JS}; return !!(v && v.root.querySelector(".pxd-item")); })()`, { timeout: 10000 }); } catch { /* page busy or reloading */ }
    if (ok) return Date.now() - t0;
    if (Date.now() - t0 > timeout) throw new Error(`board not live after ${timeout} ms`);
    await sleep(200);
  }
}

// wait until no long task ended within gap ms
export async function quiet(c, { gap = 1500, max = 20000 } = {}) {
  return c.ev(`(async () => { let last = performance.now(); const o = new PerformanceObserver((l) => { for (const e of l.getEntries()) last = Math.max(last, e.startTime + e.duration); }); o.observe({ type: "longtask" });
    const t0 = performance.now(); try { for (;;) { await new Promise((r) => setTimeout(r, 100)); const t = performance.now(); if (t - last > ${gap} || t - t0 > ${max}) break; } } finally { o.disconnect(); } return Math.round(performance.now() - t0); })()`, { timeout: max + 30000 });
}

export function pacer(minMs) {
  let next = 0;
  return async () => { const w = next - Date.now(); if (w > 0) await sleep(w); next = Date.now() + minMs; };
}

export function writeLimiter(perMin = 1200) {
  const stamps = []; // one entry per write, last 60 s
  return async (n = 1) => {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] >= 60000) stamps.shift();
      if (stamps.length + n <= perMin || !stamps.length) break;
      const idx = Math.min(stamps.length - 1, stamps.length + n - perMin - 1);
      await sleep(Math.max(20, stamps[Math.max(0, idx)] + 60000 - now + 5));
    }
    const t = Date.now();
    for (let i = 0; i < n; i++) stamps.push(t);
  };
}

export async function windowInfo(c) {
  return c.evJson(`(async () => {
    const hz = await new Promise((res) => { const d = []; let last = 0; const to = setTimeout(() => res(null), 2500);
      const f = (ts) => { if (last) d.push(ts - last); last = ts; if (d.length >= 30) { clearTimeout(to); d.sort((a, b) => a - b); res(Math.round(1000 / d[d.length >> 1])); } else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    return JSON.stringify({ id: ${JSON.stringify(c.id)}, title: document.title, inner: [innerWidth, innerHeight], dpr: devicePixelRatio, vis: document.visibilityState, focus: document.hasFocus(), hz,
      version: window.__plexusDiagram ? window.__plexusDiagram.version : null, hash: location.hash, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }); })()`, { timeout: 15000 });
}
