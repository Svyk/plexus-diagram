// Suite runner for the stress board (PXD-25). Bench window only.
//   node tools/live/stress/run.mjs [--group move,open,build,type,idle] [--scenario a,b] [--n 3] [--label base]
//        [--build <dir>] [--trace] [--selectors] [--quick] [--soak-min 30] [--target <idPrefix>] [--out <dir>]
//        [--list] [--dry] [--cleanup] [--keep-going] [--inline] [--chain a,b]
// --list and --dry never connect. Everything else drives the marked bench window over CDP.
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadavg } from "node:os";
import { connectBench, sleep } from "./lib/cdp.mjs";
import { createInput } from "./lib/input.mjs";
import { serveBuild } from "./lib/serve.mjs";
import { startTrace, stopTrace } from "./lib/trace.mjs";
import { analyseTrace } from "./lib/trace-analyse.mjs";
import { nameScripts, attributeStalls } from "./lib/names.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIO_FILES = ["move", "open", "edit", "idle"];
const PX = "window.__pxdStress";

const VALUE_FLAGS = new Set(["group", "scenario", "n", "label", "build", "soak-min", "target", "out", "chain", "timeout"]);
const BOOL_FLAGS = new Set(["trace", "selectors", "quick", "list", "dry", "cleanup", "keep-going", "inline"]);

export function parseArgs(argv) {
  const a = { group: null, scenario: null, n: 3, label: "base", build: null, trace: false, selectors: false, quick: false, soakMin: 30, target: null, out: null, list: false, dry: false, cleanup: false, keepGoing: false, inline: false, chain: null, timeoutMs: 240000 };
  const camel = (k) => k.replace(/-(\w)/g, (_, c) => c.toUpperCase());
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) throw new Error(`unexpected argument ${t}`);
    const eq = t.indexOf("=");
    const k = t.slice(2, eq < 0 ? undefined : eq);
    if (BOOL_FLAGS.has(k)) { a[camel(k)] = true; continue; }
    if (!VALUE_FLAGS.has(k)) throw new Error(`unknown flag --${k}`);
    const v = eq < 0 ? argv[++i] : t.slice(eq + 1);
    if (v == null) throw new Error(`--${k} needs a value`);
    if (k === "group" || k === "scenario" || k === "chain") a[k] = v.split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "n") a.n = Math.max(1, Number(v) || 1);
    else if (k === "soak-min") a.soakMin = Number(v) || 30;
    else if (k === "timeout") a.timeoutMs = Number(v) || 240000;
    else a[camel(k)] = v;
  }
  if (a.quick) a.n = 1;
  return a;
}

async function loadScenarios(deps) {
  if (deps.scenarios) return deps.scenarios;
  const out = [];
  for (const f of SCENARIO_FILES) {
    const file = join(HERE, "scenarios", `${f}.mjs`);
    if (!existsSync(file)) { console.warn(`scenarios/${f}.mjs is missing, skipped`); continue; }
    const mod = await import(pathToFileURL(file).href);
    for (const s of mod.scenarios || []) out.push({ needs: "board", heavy: false, leaves: false, quick: true, ...s, group: s.group || mod.group || f });
    out.mods = out.mods || {};
    out.mods[f] = mod;
  }
  return out;
}

export function select(all, a) {
  const names = a.scenario;
  const groups = a.group;
  let sel;
  if (names) {
    sel = all.filter((s) => (!groups || groups.includes(s.group)) && names.some((n) => n === s.name || n === `${s.group}/${s.name}`));
    for (const n of names) if (!sel.some((s) => n === s.name || n === `${s.group}/${s.name}`)) throw new Error(`no scenario named ${n}`);
  } else if (groups) {
    sel = all.filter((s) => groups.includes(s.group) && (!s.heavy || !a.quick));
    for (const g of groups) if (!all.some((s) => s.group === g)) throw new Error(`no scenarios in group ${g}`);
  } else {
    sel = all.filter((s) => !s.heavy);
  }
  if (a.quick) sel = sel.filter((s) => s.quick !== false);
  return sel;
}

const f1 = (x) => (x == null || Number.isNaN(x) ? "-" : String(Math.round(x * 10) / 10));
const runId = () => "r" + new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const withTimeout = (p, ms, msg) => {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
};

export async function main(argv, deps = {}) {
  let a;
  try { a = parseArgs(argv); } catch (e) { console.error(e.message); return 2; }
  if (a.out) process.env.STRESS_OUT = resolve(a.out);
  if (a.target) process.env.STRESS_TARGET = a.target;

  let all, selected;
  try {
    all = await loadScenarios(deps);
    selected = select(all, a);
  } catch (e) { console.error(e.message); return 2; }

  if (a.list) {
    for (const s of all) console.log(`${s.group.padEnd(7)} ${s.name.padEnd(18)} ${s.title || ""}${s.heavy ? "  [heavy]" : ""}`);
    return 0;
  }
  if (a.dry) {
    const bw = await import("./lib/bench-window.mjs");
    console.log(`out ${bw.OUT_DIR}  label ${a.label}  n ${a.n}  build ${a.build || "installed"}  trace ${a.trace}  quick ${a.quick}`);
    for (let i = 0; i < a.n; i++) for (const s of selected) console.log(`  run ${i + 1}/${a.n}  ${s.group}/${s.name}  needs ${s.needs}${s.leaves ? "  (40 s pacer)" : ""}${s.heavy ? "  [heavy]" : ""}`);
    if (a.trace) for (const s of selected) console.log(`  trace pass  ${s.group}/${s.name}${a.selectors ? "  (selectors)" : ""}`);
    console.log(`${selected.length * a.n} timed runs${a.trace ? ` + ${selected.length} traced` : ""}`);
    return 0;
  }
  if (!selected.length && !a.cleanup) { console.error("no scenarios selected"); return 2; }

  const bw = await import("./lib/bench-window.mjs");
  const { OUT_DIR, BOARD, PAGE, NESTED, VIEW_JS } = bw;
  const run = runId();
  const resultsFile = join(OUT_DIR, "results.jsonl");
  await mkdir(join(OUT_DIR, "traces"), { recursive: true });

  const connectFn = deps.connect || connectBench;
  let c = await connectFn({ target: a.target });
  let input = null, reconnectFn = null;
  const cleanups = []; // [label, fn] in start-up order; run in reverse
  const onCleanup = (fn, label = "cleanup") => { cleanups.push([label, fn]); };
  let release = null, restoreConfirm = null, served = null, scriptId = null, cleaned = false, aborted = false;
  let cleanupReason = null;

  const cleanupAll = async () => {
    if (cleaned) return;
    cleaned = true;
    const step = async (label, fn) => {
      try { await fn(); console.log(`cleanup: ${label} ok`); } catch (e) { console.error(`cleanup: ${label} failed: ${String(e.message || e).slice(0, 200)}`); }
    };
    // restores must run on a live connection whenever one can be had
    if (c.closed && reconnectFn) await step("reconnect", () => reconnectFn());
    for (const [label, fn] of cleanups.slice().reverse()) await step(label, fn);
    await step("camera restore", () => bw.restoreCamera(c));
    await step("sidebar restore", () => bw.restoreSidebar(c));
    await step("confirm restore", async () => { if (restoreConfirm) await restoreConfirm(); });
    await step("serve stop", async () => { if (served) await served.stop(); });
    await step("probe script remove", async () => { if (scriptId) await c.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId }); });
    await step("lock release", async () => { if (release) release(); });
    try { c.close(); } catch { /* closed */ }
  };

  const onSig = (sig) => { aborted = true; cleanupReason = sig; cleanupAll().finally(() => process.exit(sig === "SIGINT" ? 130 : 143)); };
  if (deps.signals !== false) {
    // bench-window installs handlers that exit at once; ours must run the async cleanup first
    for (const sig of ["SIGINT", "SIGTERM"]) { process.removeAllListeners(sig); process.once(sig, () => onSig(sig)); }
  }

  const lines = [];
  let exitCode = 0;
  try {
    const session = process.env.SHEPHERDR_CHAT || "manual";
    console.log("waiting for the bench window lock");
    release = await bw.acquireLock(c, session);
    const fix = await bw.repairCamera(c);
    if (fix.repaired) console.log(`repaired the shared camera key left by an earlier run: ${fix.was} -> ${fix.now}`);
    const win = await bw.windowInfo(c);
    if (win.vis !== "visible" || !(win.hz >= 20)) throw new Error(`the bench window must be on screen: visibility ${win.vis}, refresh ${win.hz} Hz (needs visible and 20 Hz or more)`);
    await bw.saveSidebar(c);
    const saved = await bw.saveCamera(c);
    restoreConfirm = await bw.stubConfirm(c, false);

    const probeSrc = await readFile(join(HERE, "lib", "probe-page.js"), "utf8");
    await c.ev(probeSrc);
    await c.send("Page.enable"); // the new-document script does nothing on this target until Page is enabled
    const added = await c.send("Page.addScriptToEvaluateOnNewDocument", { source: probeSrc });
    scriptId = added && added.result && added.result.identifier;

    input = createInput(c);
    const J = (s) => JSON.stringify(s);
    const evj = (expr, o) => c.evJson(`JSON.stringify((${expr}) ?? null)`, o);
    // a probe call that finds no probe (new document without the script) installs it once and retries
    const guard = async (fn) => {
      try { return await fn(); } catch (e) {
        if (!/__pxdStress|Cannot read properties of undefined/.test(String((e && e.message) || e))) throw e;
        await c.ev(probeSrc);
        return fn();
      }
    };
    const probe = {
      arm: (o = {}) => guard(() => evj(`${PX}.arm(${J(o)})`)),
      take: () => guard(() => evj(`${PX}.take()`)),
      quiet: (o = {}) => guard(() => c.ev(`${PX}.quiet(${J(o)})`, { timeout: (o.max || 20000) + 30000 })),
      info: () => guard(() => evj(`${PX}.info()`)),
      cards: () => guard(() => evj(`${PX}.cards()`)),
      mark: (n) => guard(() => c.ev(`(${PX}.mark(${J(n)}), 1)`)),
      act: () => guard(() => c.ev(`(${PX}.act(), 1)`)),
      install: async () => { await c.ev(probeSrc); },
    };

    let reconnects = 0;
    reconnectFn = async () => {
      try { c.close(); } catch { /* dead */ }
      if (served) { try { await served.stop(); } catch { /* socket gone */ } }
      c = await connectFn({ target: a.target });
      input = createInput(c);
      if (ctx) { ctx.c = c; ctx.input = input; }
      await c.ev(probeSrc);
      await c.send("Page.enable");
      const r = await c.send("Page.addScriptToEvaluateOnNewDocument", { source: probeSrc });
      scriptId = r && r.result && r.result.identifier;
      restoreConfirm = await bw.stubConfirm(c, false);
      await bw.saveCamera(c);
      if (a.build) { const old = served; served = await serveBuild(c, resolve(a.build)); if (old && old.served) { served.served.js += old.served.js; served.served.css += old.served.css; } }
      console.log("reconnected to the bench window");
    };

    let names = {}, origin = await c.ev(`performance.timeOrigin`);
    const ctx = {
      c, input, opts: { quick: a.quick, soakMin: a.soakMin, chain: a.chain || NESTED.split(","), timeoutMs: a.timeoutMs, selectors: a.selectors, inline: a.inline },
      log: (m) => console.log(`  ${m}`), probe, win, view: VIEW_JS, sleep,
      cam: { save: () => bw.saveCamera(c), set: (vp) => bw.setCamera(c, vp), restore: () => bw.restoreCamera(c) },
      pace: bw.pacer(40000), writes: bw.writeLimiter(1200), scratch: null, scratchModule: () => import("./lib/scratch.mjs"),
      editModule: (all.mods || {}).edit || null, names, trace: { on: false, start: null, stop: null }, home: null, size: null, fsWanted: false, onCleanup,
      result: (summary, extra) => ({ summary, extra }),
    };

    // ---- helpers shared with the scenarios
    ctx.afterReload = async () => {
      if ((await c.ev(`typeof window.__pxdStress`)) === "undefined") { await c.ev(probeSrc); console.log("probe was not installed by the new-document script; installed late (cold marks lost)"); }
      if (restoreConfirm) { try { await restoreConfirm(); } catch { /* old document */ } }
      restoreConfirm = await bw.stubConfirm(c, false);
      await bw.saveCamera(c);
      for (const k of Object.keys(names)) delete names[k];
      origin = await c.ev(`performance.timeOrigin`);
    };
    ctx.findBtns = async (re) => c.evJson(`(() => { const v = ${VIEW_JS}; if (!v) return "[]"; const re = new RegExp(${J(re.source)}, ${J(re.flags)}); const out = [];
      for (const b of v.root.querySelectorAll(".pxd-rail .pxd-btn, .pxd-btn")) { const t = (b.getAttribute("title") || "") + " | " + (b.getAttribute("aria-label") || ""); if (!re.test(t)) continue;
        const r = b.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue; { const cx = r.x + r.width / 2, cy = r.y + r.height / 2; if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue; }
        if (out.some((o) => o.x === Math.round(r.x + r.width / 2) && o.y === Math.round(r.y + r.height / 2))) continue;
        out.push({ title: b.getAttribute("title") || b.getAttribute("aria-label") || "", x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); }
      return JSON.stringify(out); })()`);
    // rail button by its stable data-tip key; {covered: true} when something else is on top of it right now
    ctx.railBtn = async (key) => c.evJson(`(() => { const v = ${VIEW_JS}; if (!v) return "null"; const b = v.root.querySelector('.pxd-rail .pxd-btn[data-tip=${J(key)}]'); if (!b) return "null";
      const r = b.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return "null"; const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return JSON.stringify({ covered: true, x, y });
      const el = document.elementFromPoint(x, y); if (!el || !(el === b || b.contains(el))) return JSON.stringify({ covered: true, x, y });
      return JSON.stringify({ x, y, label: b.getAttribute("aria-label") || b.getAttribute("title") || "" }); })()`);
    // Scroll an inline board into view (a scenario may have left the Roam page scrolled away); no-op when fullscreen. Returns the root rect.
    ctx.revealBoard = async () => {
      const r = await c.evJson(`(() => { const v = ${VIEW_JS}; if (!v) return "null"; const root = v.root;
        if (window.__plexusDiagram.mounts().some((m) => m.connected && m.fullscreen)) { const q = root.getBoundingClientRect(); return JSON.stringify({ x: q.x, y: q.y, w: q.width, h: q.height, inline: false }); }
        root.scrollIntoView({ block: "start" });
        let q = root.getBoundingClientRect();
        if (q.top < 0 || q.top > innerHeight - 200) {
          let sc = document.querySelector(".rm-article-wrapper");
          if (!sc || sc.scrollHeight <= sc.clientHeight) { sc = null; for (let p = root.parentElement; p; p = p.parentElement) { if (p.scrollHeight > p.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) { sc = p; break; } } }
          if (sc) sc.scrollTop += root.getBoundingClientRect().top - 60;
          q = root.getBoundingClientRect();
        }
        return JSON.stringify({ x: q.x, y: q.y, w: q.width, h: q.height, inline: true }); })()`);
      if (r && r.inline) await sleep(300);
      return r;
    };
    // move, settle, press, hold, release: how the recorded user clicks (a zero-length click can be dropped)
    ctx.pressAt = async (x, y, { hold = 120, settle = 200 } = {}) => { await input.move(x, y); await sleep(settle); await input.down(x, y); await sleep(hold); await input.up(x, y); };
    ctx.clickBtn = async (re) => {
      const RAIL = [["zoom out", "rail.zoom-out"], ["zoom in", "rail.zoom-in"], ["fit view", "rail.fit"]];
      const hit = RAIL.find(([label]) => re.test(label));
      let b = hit ? await ctx.railBtn(hit[1]) : null;
      if (b && !b.covered) { await ctx.pressAt(b.x, b.y); return { title: b.label, x: b.x, y: b.y }; }
      const l = await ctx.findBtns(re);
      if (!l.length) return null;
      await ctx.pressAt(l[0].x, l[0].y);
      return l[0];
    };
    // A background point with room for a horizontal drag of dist px (dir -1 left, 1 right). Mirrors scenarios/move.mjs: the DOM
    // under the point is plain board surface AND no card, section title or section border is near it in world space
    // (a press on a card with no shell yet is still that card).
    ctx.freePoint = async (dist = 370, dir = -1) => c.evJson(`(() => { const v = ${VIEW_JS}; if (!v) return "null";
      const rr = v.root.getBoundingClientRect(), vp = v.viewport(), src = v.snapshotSource(); if (!src || !vp || !vp.zoom) return "null";
      const BAD = ".pxd-chrome, .pxd-out, .pxd-port, .pxd-grip, .pxd-edge, .pxd-label, .pxd-link, .pxd-section__title, .pxd-section__edge, .pxd-item, .pxd-btn, button, a, input, textarea, select, [contenteditable]";
      const central = (x, y) => x > rr.left + 90 && x < rr.right - 90 && y > rr.top + 90 && y < rr.bottom - 90;
      const surface = v.root.querySelector(".pxd-viewport");
      const empty = (x, y) => { const el = document.elementFromPoint(x, y); if (!el || !surface || !surface.contains(el) || el.closest(BAD)) return false;
        const wx = (x - rr.left - vp.x) / vp.zoom, wy = (y - rr.top - vp.y) / vp.zoom, p = 14 / vp.zoom, tb = 28 / vp.zoom;
        for (const [uid, it] of src.board.items) { const r = src.rects.get(uid); if (!r) continue;
          if (it.type === "section") {
            if (wx >= r.x - p && wx <= r.x + r.w + p && wy >= r.y - tb - p && wy <= r.y + p) return false;
            const outer = wx >= r.x - p && wx <= r.x + r.w + p && wy >= r.y - p && wy <= r.y + r.h + p;
            const inner = wx >= r.x + p && wx <= r.x + r.w - p && wy >= r.y + p && wy <= r.y + r.h - p;
            if (outer && !inner) return false;
          } else if (wx >= r.x - p && wx <= r.x + r.w + p && wy >= r.y - p && wy <= r.y + r.h + p) return false; }
        return true; };
      const cx = rr.left + rr.width / 2, cy = rr.top + rr.height / 2;
      for (let ring = 0; ring <= 16; ring++) for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const x = cx + i * 26, y = cy + j * 26;
        if (central(x, y) && central(x + ${dir} * ${dist}, y) && empty(x, y)) return JSON.stringify({ x: Math.round(x), y: Math.round(y) }); }
      return "null"; })()`);
    ctx.fsState = () => c.evJson(`JSON.stringify(!!(window.__plexusDiagram && window.__plexusDiagram.mounts().some((m) => m.connected && m.fullscreen)))`);
    ctx.fullscreen = async (on) => {
      if ((await ctx.fsState()) === !!on) return;
      let used = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        await probe.quiet({ gap: 400, max: 4000 });
        if ((await ctx.fsState()) === !!on) break;
        await ctx.revealBoard();
        let b = await ctx.railBtn("rail.fullscreen");
        if (!b) { const l = await ctx.findBtns(/maximi[sz]e|fullscreen|minimi[sz]e|exit/i); if (l.length) b = { x: l[0].x, y: l[0].y, label: l[0].title }; }
        if (!b || b.covered) { used = b; await sleep(300); continue; }
        used = b;
        await ctx.pressAt(b.x, b.y);
        const t0 = Date.now();
        while (Date.now() - t0 < 2500) { await sleep(100); if ((await ctx.fsState()) === !!on) break; }
        if ((await ctx.fsState()) === !!on) break;
      }
      if ((await ctx.fsState()) !== !!on) {
        const seen = (await ctx.findBtns(/./)).map((b) => b.title).join(", ");
        throw new Error(`fullscreen button did not switch to ${on ? "fullscreen" : "inline"} in 4 attempts; last button ${used ? `${used.covered ? "covered" : J(used.label)} at ${used.x},${used.y}` : "not found"}; rail labels seen: ${seen || "(none)"}`);
      }
      await ctx.refreshSize();
      await probe.quiet({ gap: 600, max: 6000 });
    };
    ctx.refreshSize = async () => { const s = await c.evJson(`(() => { const v = ${VIEW_JS}; if (!v) return "null"; const r = v.root.getBoundingClientRect(); return JSON.stringify({ w: r.width, h: r.height }); })()`); if (s) ctx.size = s; return s; };
    ctx.at = (zoom, dx = 0, dy = 0) => {
      if (!ctx.home || !ctx.size) throw new Error("ctx.at called before the home point is known");
      return { x: ctx.size.w / 2 - (ctx.home.x + dx) * zoom, y: ctx.size.h / 2 - (ctx.home.y + dy) * zoom, zoom };
    };
    ctx.show = async (cam, { settle = true } = {}) => {
      await c.ev(`(${VIEW_JS}).showAt(${J(cam)}), 1`);
      if (settle) await probe.quiet({ gap: 800, max: 8000 });
    };
    // write the camera key and the live view together; the view's own throttled write must not land after ours
    ctx.aim = async (cam) => {
      const live = await c.ev(`(() => { const v = ${VIEW_JS}; if (!v) return false; v.showAt(${J(cam)}); return true; })()`);
      await bw.setCamera(c, cam);
      await sleep(350);
      await bw.setCamera(c, cam);
      return !!live;
    };
    ctx.computeHome = async () => {
      // home comes from Svy's saved camera (the first saveCamera) and the root size now; never from a later live camera
      const size = await ctx.refreshSize();
      let cam = null;
      try { cam = saved ? JSON.parse(saved) : null; } catch { cam = null; }
      if (cam && size && cam.zoom) {
        ctx.home = { x: (size.w / 2 - cam.x) / cam.zoom, y: (size.h / 2 - cam.y) / cam.zoom };
        await ctx.show(cam);
        const cd = await probe.cards();
        if (cd && cd.n > 0) { console.log(`home world point ${Math.round(ctx.home.x)}, ${Math.round(ctx.home.y)} from saved camera ${saved}`); return; }
        console.log(`saved camera ${saved} shows no cards; using the densest cell`);
      } else console.log("no saved camera; using the densest cell");
      const cells = await c.evJson(`(() => { const v = ${VIEW_JS}; const src = v && v.snapshotSource(); if (!src) return "[]"; const m = new Map();
        for (const [uid, it] of src.board.items) { if (it.type === "section") continue; const r = src.rects.get(uid); if (!r) continue; const k = Math.floor((r.x + r.w / 2) / 2000) + "," + Math.floor((r.y + r.h / 2) / 2000); m.set(k, (m.get(k) || 0) + 1); }
        return JSON.stringify([...m].map(([k, n]) => { const [x, y] = k.split(",").map(Number); return { x, y, n }; })); })()`);
      cells.sort((p, q) => q.n - p.n || p.x - q.x || p.y - q.y);
      ctx.home = cells.length ? { x: cells[0].x * 2000 + 1000, y: cells[0].y * 2000 + 1000 } : { x: 0, y: 0 };
      console.log(`home world point ${ctx.home.x}, ${ctx.home.y} (densest cell)`);
    };

    const atBoard = () => c.evJson(`JSON.stringify((() => { const v = ${VIEW_JS}; return !!(v && v.root.getAttribute("data-board") === ${J(BOARD)} && v.snapshotSource()); })())`);
    // cards must be on screen: an empty camera is a live board but nothing to measure
    const cardsOnScreen = async () => {
      if (!ctx.home || !ctx.size) return;
      const cd = await probe.cards();
      if (cd && cd.n === 0) await ctx.show(ctx.at(1.07));
    };
    const ensureBoard = async () => {
      await ensureBoard0();
      if (!(await ctx.fsState())) await ctx.revealBoard();
      await cardsOnScreen();
    };
    const ensureBoard0 = async () => {
      if (await atBoard()) { if (ctx.fsWanted && !(await ctx.fsState())) await ctx.fullscreen(true); return; }
      const crumb = await c.evJson(`(() => { const v = ${VIEW_JS}; const b = v && v.root.querySelector('.pxd-crumb[data-index="0"]'); if (!b) return "null"; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); })()`);
      if (crumb) { await ctx.pressAt(crumb.x, crumb.y); await sleep(500); }
      if (!(await atBoard())) {
        if (ctx.home) await ctx.cam.set(ctx.at(1.07));
        await bw.openBoardPage(c);
        await sleep(300);
        await bw.waitLive(c, { timeout: 60000 });
        await ctx.cam.restore();
      } else await bw.waitLive(c, { timeout: 60000 });
      await probe.quiet({ gap: 1500, max: 20000 });
      if (!(await atBoard())) throw new Error("could not get back to the stress board");
      if (ctx.fsWanted && !(await ctx.fsState())) await ctx.fullscreen(true);
    };
    ctx.ensure = async (needs = "board") => {
      if (needs === "any") return;
      if (needs === "daily") {
        const h = await bw.hashOf(c);
        if (ctx.home && (await atBoard())) await ctx.aim(ctx.at(1.07));
        if (/\/page\//.test(h) || (await atBoard())) { await bw.openDaily(c); await sleep(1500); await probe.quiet({ gap: 1500, max: 15000 }); }
        return;
      }
      await ensureBoard();
    };

    // ---- traces
    let traceSeq = 0;
    ctx.trace.start = async () => { await startTrace(c, { cpu: true, selectors: a.selectors }); };
    ctx.trace.stop = async (tag) => stopTrace(c, join(OUT_DIR, "traces", `${run}-${tag || "t" + ++traceSeq}.json.gz`));

    // ---- build
    const build = { dir: a.build || "installed", sha: null };
    if (a.build && !a.cleanup) {
      served = await serveBuild(c, resolve(a.build));
      build.sha = served.sha;
      await ensureBoard();
      let svCam = null;
      try { svCam = saved ? JSON.parse(saved) : null; } catch { svCam = null; }
      if (svCam && (await c.ev(`!!(${VIEW_JS})`))) await ctx.aim(svCam); // the reload lands where Svy works
      await c.send("Page.reload", { ignoreCache: false });
      await sleep(1500);
      await bw.waitLive(c, { timeout: 120000 });
      await ctx.afterReload();
      await bw.restoreSidebar(c);
      await probe.quiet({ gap: 1000, max: 15000 });
      if (!(served.served.js >= 1 && served.served.css >= 1)) throw new Error(`the build was not served: js ${served.served.js}, css ${served.served.css} (the installed extension is still running)`);
      console.log(`serving ${build.dir} sha ${build.sha} (js ${served.served.js}, css ${served.served.css})`);
    }

    // ---- first board open, fullscreen, home
    await ensureBoard(); // no fullscreen is forced here (fsWanted is still false)
    if (a.cleanup) {
      await ctx.computeHome();
      const mod = (all.mods || {}).edit;
      if (!mod || typeof mod.cleanupAll !== "function") { console.log("cleanup " + J({ error: "scenarios/edit.mjs has no cleanupAll export" })); return 1; }
      const res = await mod.cleanupAll(ctx);
      let ver = null;
      if (typeof mod.leftovers === "function") { try { ver = await mod.leftovers(ctx); } catch { ver = null; } }
      else if (typeof mod.verifyClean === "function") { try { ver = await mod.verifyClean(ctx); } catch { ver = null; /* no before-snapshot */ } }
      const len = (x) => (Array.isArray(x) ? x.length : Number(x) || 0);
      const left = (res && res.left) || [], refused = (res && res.refused) || [];
      const markers = ver && ver.markerBlocks != null ? ver.markerBlocks : null;
      const ledgerLeft = ver && ver.ledgerLeft != null ? ver.ledgerLeft : [];
      console.log("cleanup " + J({ found: res && res.found != null ? res.found : null, deleted: res && res.deleted != null ? res.deleted : null, left, refused, markerBlocks: markers, ledgerLeft, clean: ver ? ver.clean : null }));
      return len(left) === 0 && markers === 0 && len(ledgerLeft) === 0 && len(refused) === 0 ? 0 : 1;
    }
    if (!a.inline) {
      try { await ctx.fullscreen(true); ctx.fsWanted = true; }
      catch (e) { console.error(`fullscreen failed, continuing inline: ${String(e.message || e).slice(0, 300)}`); ctx.fsWanted = false; }
    }
    await ctx.computeHome();
    await ctx.cam.restore();
    await ctx.show(ctx.at(1.07));
    const version = (await probe.info()).version || win.version;

    // ---- one scenario run
    const recFails = { n: 0 };
    const baseLine = (s, i, traced) => ({ run, at: new Date().toISOString(), label: a.label, build: { dir: build.dir, sha: build.sha }, version, group: s.group, scenario: s.name, i: i + 1, n: a.n, traced, window: { id: win.id, inner: win.inner, dpr: win.dpr, vis: win.vis, hz: win.hz }, load: loadavg().map((x) => Math.round(x * 100) / 100) });
    const timeoutFor = (s) => (s.heavy ? Math.max(45 * 60 * 1000, (a.soakMin + 10) * 60 * 1000) : a.timeoutMs);

    const nameFailed = new Set();
    async function nameFor(summary) {
      const urls = new Set();
      for (const st of (summary && summary.stalls && summary.stalls.list) || []) for (const sc of st.scripts || []) if (sc.u && sc.u.startsWith("blob:")) urls.add(sc.u);
      const o = await c.ev(`performance.timeOrigin`);
      if (o !== origin) { for (const k of Object.keys(names)) delete names[k]; origin = o; }
      const missing = [...urls].filter((u) => !names[u] && !nameFailed.has(u));
      if (missing.length) {
        try { Object.assign(names, await nameScripts(c, missing)); }
        catch (e) { for (const u of missing) nameFailed.add(u); console.error(`nameScripts failed (not retried for these scripts): ${String(e.message).slice(0, 120)}`); }
      }
    }

    async function runOne(s, i, traced) {
      const line = baseLine(s, i, traced);
      const tStart = Date.now();
      let info0 = null, tracing = false, traceFile = null;
      try {
        await ctx.ensure(s.needs);
        if (s.leaves) await ctx.pace();
        try { info0 = await probe.info(); } catch { /* board not mounted for daily */ }
        let fs0 = null;
        try { fs0 = await ctx.fsState(); } catch { /* ignore */ }
        if (traced) { await ctx.trace.start(); tracing = true; ctx.trace.on = true; }
        const res = (await withTimeout(Promise.resolve(s.run(ctx)), timeoutFor(s), `${s.name} timed out after ${Math.round(timeoutFor(s) / 1000)} s`)) || {};
        if (tracing) { traceFile = await ctx.trace.stop(`${s.group}-${s.name}-${i + 1}`); tracing = false; }
        let info1 = null;
        try { info1 = await probe.info(); } catch { /* ignore */ }
        const o = await c.ev(`performance.timeOrigin`);
        if (o !== origin) await ctx.afterReload();
        const sum = res.summary || null;
        if (res.skip) line.skip = String(res.skip);
        if (sum) {
          await nameFor(sum);
          attributeStalls(sum, names);
          Object.assign(line, { stalls: sum.stalls, long: sum.long, frames: sum.frames, input: sum.input, content: sum.content, owner: sum.owner, plexus: sum.plexus });
          line.ttnp = res.ttnp != null ? res.ttnp : sum.ttnp;
          line.extra = { ...(sum.marks && sum.marks.length ? { marks: sum.marks } : {}), ...(res.extra || {}) };
        } else {
          line.ttnp = res.ttnp != null ? res.ttnp : null;
          if (res.extra) line.extra = res.extra;
        }
        line.ctx = { board: info0 && info0.board, zoom0: info0 && info0.zoom, zoom1: info1 && info1.zoom, lod0: info0 && info0.lod, lod1: info1 && info1.lod, items: info0 && info0.items, camera: info0 ? { x: info0.x, y: info0.y, zoom: info0.zoom } : null, fullscreen: fs0 };
        if (traceFile) {
          const split = await analyseTrace(traceFile.file, { names });
          const tasks = (split.tasks || []).slice().sort((p, q) => q.d - p.d).slice(0, 12);
          line.trace = { file: traceFile.file, ...split, tasks };
        }
        recFails.n = 0;
      } catch (e) {
        line.err = String((e && e.message) || e).slice(0, 300);
        if (tracing) { try { await ctx.trace.stop(`${s.group}-${s.name}-${i + 1}-err`); } catch { /* trace lost */ } }
        if (c.closed || /cdp closed/.test(line.err)) {
          if (reconnects < 3) {
            reconnects++;
            console.error(`connection lost (${reconnects}/3), reconnecting`);
            try { await reconnectFn(); } catch (e3) { console.error(`reconnect failed: ${String(e3.message || e3).slice(0, 200)}`); recFails.n++; if (recFails.n >= 2 && !a.keepGoing) line.fatal = true; }
          } else if (!a.keepGoing) line.fatal = true;
        }
        try {
          await input.key("Escape"); await input.key("Escape");
          await ctx.ensure("board");
          recFails.n = 0;
        } catch (e2) {
          recFails.n++;
          console.error(`recovery failed (${recFails.n}): ${String(e2.message || e2).slice(0, 200)}`);
          if (recFails.n >= 2 && !a.keepGoing) line.fatal = true;
        }
      } finally {
        ctx.trace.on = false;
      }
      line.secs = Math.round((Date.now() - tStart) / 100) / 10;
      durs.push([`${s.group}/${s.name}${traced ? " (traced)" : ""}`, line.secs]);
      await appendFile(resultsFile, JSON.stringify(line) + "\n");
      lines.push(line);
      const sm = line;
      const oth = sm.owner ? Object.values(sm.owner.other || {}).reduce((p, q) => p + q, 0) : null;
      console.log(`${s.group}/${s.name} ${i + 1}${traced ? " traced" : ""}  ttnp ${f1(sm.ttnp)}  stalls ${sm.stalls ? `${sm.stalls.n}/${f1(sm.stalls.total)}/${f1(sm.stalls.worst)}` : "-"}  frames ${sm.frames ? `${f1(sm.frames.p95)}/${f1(sm.frames.max)}` : "-"}  content ${sm.content ? `${f1(sm.content.readable.p95)}/${f1(sm.content.live.p95)}` : "-"}  owner ${sm.owner ? `${f1(sm.owner.plexus)}/${f1(sm.owner.roam)}/${f1(oth)}/${f1(sm.owner.render)}` : "-"}${sm.skip ? `  skip: ${sm.skip}` : ""}${sm.err ? `  ERR ${sm.err}` : ""}`);
      return !line.fatal;
    }

    const durs = [];
    let go = true;
    for (let i = 0; i < a.n && go && !aborted; i++) for (const s of selected) { if (aborted || !(go = await runOne(s, i, false))) break; }
    if (a.trace && go) for (const s of selected) { if (aborted || !(go = await runOne(s, 0, true))) break; }
    if (!go) console.error("stopped: recovery failed twice in a row (use --keep-going to continue)");
    if (a.quick) { for (const [n, t] of durs) console.log(`${n.padEnd(32)} ${t} s`); console.log(`${"total".padEnd(32)} ${Math.round(durs.reduce((x, [, t]) => x + t, 0) * 10) / 10} s`); }
    exitCode = lines.some((l) => l.err) ? 1 : 0;
    const em = (all.mods || {}).edit;
    if (em && typeof em.leftovers === "function" && selected.some((s) => (s.group === "build" || s.group === "type") && lines.some((l) => l.scenario === s.name && l.group === s.group))) {
      // the scenarios' own cleanups first (they run once; the final cleanup finds the list empty)
      for (const [label, fn] of cleanups.splice(0).reverse()) { try { await fn(); console.log(`cleanup: ${label} ok`); } catch (e) { console.error(`cleanup: ${label} failed: ${String((e && e.message) || e).slice(0, 200)}`); } }
      try {
        const lo = await em.leftovers(ctx);
        const bad = !(lo && lo.clean);
        console.log(`${bad ? "WARNING " : ""}leftovers ${J(lo)}`);
        if (bad) exitCode = 1;
      } catch (e) { console.log(`WARNING leftovers failed: ${String((e && e.message) || e).slice(0, 200)}`); exitCode = 1; }
    }
    console.log(`${lines.length} lines in ${resultsFile}${exitCode ? " (some failed)" : ""}`);
    return exitCode;
  } catch (e) {
    console.error(`run failed: ${String((e && e.message) || e)}`);
    return 1;
  } finally {
    if (deps.signals !== false) for (const sig of ["SIGINT", "SIGTERM"]) process.removeAllListeners(sig);
    await cleanupAll();
    if (cleanupReason) console.error(`stopped by ${cleanupReason}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e && e.stack || e); process.exit(1); });
}
