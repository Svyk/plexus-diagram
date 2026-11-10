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

  const c = await (deps.connect || connectBench)({ target: a.target });
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
    const win = await bw.windowInfo(c);
    if (win.vis !== "visible" || !(win.hz >= 20)) throw new Error(`the bench window must be on screen: visibility ${win.vis}, refresh ${win.hz} Hz (needs visible and 20 Hz or more)`);
    await bw.saveSidebar(c);
    const saved = await bw.saveCamera(c);
    restoreConfirm = await bw.stubConfirm(c, false);

    const probeSrc = await readFile(join(HERE, "lib", "probe-page.js"), "utf8");
    await c.ev(probeSrc);
    const added = await c.send("Page.addScriptToEvaluateOnNewDocument", { source: probeSrc });
    scriptId = added && added.result && added.result.identifier;

    const input = createInput(c);
    const J = (s) => JSON.stringify(s);
    const evj = (expr, o) => c.evJson(`JSON.stringify((${expr}) ?? null)`, o);
    const probe = {
      arm: (o = {}) => evj(`${PX}.arm(${J(o)})`),
      take: () => evj(`${PX}.take()`),
      quiet: (o = {}) => c.ev(`${PX}.quiet(${J(o)})`, { timeout: (o.max || 20000) + 30000 }),
      info: () => evj(`${PX}.info()`),
      cards: () => evj(`${PX}.cards()`),
      mark: (n) => c.ev(`(${PX}.mark(${J(n)}), 1)`),
      act: () => c.ev(`(${PX}.act(), 1)`),
      install: async () => { await c.ev(probeSrc); },
    };

    let names = {}, origin = await c.ev(`performance.timeOrigin`);
    const ctx = {
      c, input, opts: { quick: a.quick, soakMin: a.soakMin, chain: a.chain || NESTED.split(","), timeoutMs: a.timeoutMs, selectors: a.selectors, inline: a.inline },
      log: (m) => console.log(`  ${m}`), probe, win, view: VIEW_JS, sleep,
      cam: { save: () => bw.saveCamera(c), set: (vp) => bw.setCamera(c, vp), restore: () => bw.restoreCamera(c) },
      pace: bw.pacer(40000), writes: bw.writeLimiter(1200), scratch: null, scratchModule: () => import("./lib/scratch.mjs"),
      names, trace: { on: false, start: null, stop: null }, home: null, size: null, fsWanted: false, onCleanup,
      result: (summary, extra) => ({ summary, extra }),
    };

    // ---- helpers shared with the scenarios
    ctx.afterReload = async () => {
      if (restoreConfirm) { try { await restoreConfirm(); } catch { /* old document */ } }
      restoreConfirm = await bw.stubConfirm(c, false);
      await bw.saveCamera(c);
      for (const k of Object.keys(names)) delete names[k];
      origin = await c.ev(`performance.timeOrigin`);
    };
    ctx.findBtns = async (re) => c.evJson(`(() => { const v = ${VIEW_JS}; if (!v) return "[]"; const re = new RegExp(${J(re.source)}, ${J(re.flags)}); const out = [];
      for (const b of v.root.querySelectorAll(".pxd-rail .pxd-btn, .pxd-btn")) { const t = (b.getAttribute("title") || "") + " | " + (b.getAttribute("aria-label") || ""); if (!re.test(t)) continue;
        const r = b.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
        if (out.some((o) => o.x === Math.round(r.x + r.width / 2) && o.y === Math.round(r.y + r.height / 2))) continue;
        out.push({ title: b.getAttribute("title") || b.getAttribute("aria-label") || "", x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); }
      return JSON.stringify(out); })()`);
    ctx.clickBtn = async (re) => { const l = await ctx.findBtns(re); if (!l.length) return null; await input.click(l[0].x, l[0].y); return l[0]; };
    // a background point inside the board root with room for a horizontal drag of dist px (dir -1 left, 1 right)
    ctx.freePoint = async (dist = 370, dir = -1) => c.evJson(`(() => { const v = ${VIEW_JS}; if (!v) return "null"; const r = v.root.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2, bad = ".pxd-item, .pxd-section, .pxd-port, .pxd-grip, .pxd-edge, .pxd-btn, .pxd-link, .pxd-chrome";
      const cand = []; for (const dx of [0, -150, 150, -300, 300]) for (const dy of [0, -120, 120, -240, 240]) cand.push([dx, dy]);
      cand.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
      for (const [dx, dy] of cand.slice(0, 12)) { const x = Math.round(cx + dx), y = Math.round(cy + dy), x2 = x + ${dir} * ${dist};
        if (x2 < r.left + 10 || x2 > r.right - 10 || y < r.top + 10 || y > r.bottom - 10 || x < r.left + 10 || x > r.right - 10) continue;
        const el = document.elementFromPoint(x, y); if (!el || !el.closest(".pxd-root") || el.closest(bad)) continue; return JSON.stringify({ x, y }); }
      return "null"; })()`);
    ctx.fsState = () => c.evJson(`JSON.stringify(!!(window.__plexusDiagram && window.__plexusDiagram.mounts().some((m) => m.connected && m.fullscreen)))`);
    ctx.fullscreen = async (on) => {
      if ((await ctx.fsState()) === !!on) return;
      const l = await ctx.findBtns(/maximi[sz]e|fullscreen|minimi[sz]e|exit/i);
      for (const b of l) {
        await input.click(b.x, b.y);
        const t0 = Date.now();
        while (Date.now() - t0 < 3000) { await sleep(150); if ((await ctx.fsState()) === !!on) return; }
      }
      const seen = (await ctx.findBtns(/./)).map((b) => b.title).join(", ");
      throw new Error(`fullscreen button did not switch to ${on ? "fullscreen" : "inline"}; rail titles seen: ${seen || "(none)"}`);
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
    ctx.computeHome = async () => {
      const size = await ctx.refreshSize();
      let cam = null;
      try { cam = saved ? JSON.parse(saved) : null; } catch { cam = null; }
      if (cam && size && cam.zoom) { ctx.home = { x: (size.w / 2 - cam.x) / cam.zoom, y: (size.h / 2 - cam.y) / cam.zoom }; return; }
      const cells = await c.evJson(`(() => { const v = ${VIEW_JS}; const src = v && v.snapshotSource(); if (!src) return "[]"; const m = new Map();
        for (const [uid, it] of src.board.items) { if (it.type === "section") continue; const r = src.rects.get(uid); if (!r) continue; const k = Math.floor((r.x + r.w / 2) / 2000) + "," + Math.floor((r.y + r.h / 2) / 2000); m.set(k, (m.get(k) || 0) + 1); }
        return JSON.stringify([...m].map(([k, n]) => { const [x, y] = k.split(",").map(Number); return { x, y, n }; })); })()`);
      cells.sort((p, q) => q.n - p.n || p.x - q.x || p.y - q.y);
      ctx.home = cells.length ? { x: cells[0].x * 2000 + 1000, y: cells[0].y * 2000 + 1000 } : { x: 0, y: 0 };
    };

    const atBoard = () => c.evJson(`JSON.stringify((() => { const v = ${VIEW_JS}; return !!(v && v.root.getAttribute("data-board") === ${J(BOARD)} && v.root.querySelector(".pxd-item")); })())`);
    const ensureBoard = async () => {
      if (await atBoard()) { if (ctx.fsWanted && !(await ctx.fsState())) await ctx.fullscreen(true); return; }
      const crumb = await c.evJson(`(() => { const v = ${VIEW_JS}; const b = v && v.root.querySelector('.pxd-crumb[data-index="0"]'); if (!b) return "null"; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); })()`);
      if (crumb) { await input.click(crumb.x, crumb.y); await sleep(500); }
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
    if (a.build) {
      served = await serveBuild(c, resolve(a.build));
      build.sha = served.sha;
      await ensureBoard();
      await c.send("Page.reload", { ignoreCache: false });
      await sleep(1500);
      await bw.waitLive(c, { timeout: 120000 });
      await ctx.afterReload();
      if (!(served.served.js >= 1 && served.served.css >= 1)) throw new Error(`the build was not served: js ${served.served.js}, css ${served.served.css} (the installed extension is still running)`);
      console.log(`serving ${build.dir} sha ${build.sha} (js ${served.served.js}, css ${served.served.css})`);
    }

    // ---- first board open, fullscreen, home
    await ensureBoard();
    if (!a.inline) { await ctx.fullscreen(true); ctx.fsWanted = true; }
    await ctx.computeHome();
    await ctx.cam.restore();
    await ctx.show(ctx.at(1.07));
    const version = (await probe.info()).version || win.version;

    if (a.cleanup) {
      const mod = (all.mods || {}).edit;
      if (!mod || typeof mod.cleanupAll !== "function") console.log("scenarios/edit.mjs has no cleanupAll export; nothing to do");
      else console.log(JSON.stringify(await mod.cleanupAll(ctx)));
      return 0;
    }

    // ---- one scenario run
    const recFails = { n: 0 };
    const baseLine = (s, i, traced) => ({ run, at: new Date().toISOString(), label: a.label, build: { dir: build.dir, sha: build.sha }, version, group: s.group, scenario: s.name, i: i + 1, n: a.n, traced, window: { id: win.id, inner: win.inner, dpr: win.dpr, vis: win.vis, hz: win.hz }, load: loadavg().map((x) => Math.round(x * 100) / 100) });
    const timeoutFor = (s) => (s.heavy ? Math.max(45 * 60 * 1000, (a.soakMin + 10) * 60 * 1000) : a.timeoutMs);

    async function nameFor(summary) {
      const urls = new Set();
      for (const st of (summary && summary.stalls && summary.stalls.list) || []) for (const sc of st.scripts || []) if (sc.u && sc.u.startsWith("blob:")) urls.add(sc.u);
      const o = await c.ev(`performance.timeOrigin`);
      if (o !== origin) { for (const k of Object.keys(names)) delete names[k]; origin = o; }
      const missing = [...urls].filter((u) => !names[u]);
      if (missing.length) { try { Object.assign(names, await nameScripts(c, missing)); } catch (e) { console.error(`nameScripts failed: ${String(e.message).slice(0, 120)}`); } }
    }

    async function runOne(s, i, traced) {
      const line = baseLine(s, i, traced);
      let info0 = null, tracing = false, traceFile = null;
      try {
        await ctx.ensure(s.needs);
        if (s.leaves) await ctx.pace();
        try { info0 = await probe.info(); } catch { /* board not mounted for daily */ }
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
        line.ctx = { board: info0 && info0.board, zoom0: info0 && info0.zoom, zoom1: info1 && info1.zoom, lod0: info0 && info0.lod, lod1: info1 && info1.lod, items: info0 && info0.items };
        if (traceFile) {
          const split = await analyseTrace(traceFile.file, { names });
          const tasks = (split.tasks || []).slice().sort((p, q) => q.d - p.d).slice(0, 12);
          line.trace = { file: traceFile.file, ...split, tasks };
        }
        recFails.n = 0;
      } catch (e) {
        line.err = String((e && e.message) || e).slice(0, 300);
        if (tracing) { try { await ctx.trace.stop(`${s.group}-${s.name}-${i + 1}-err`); } catch { /* trace lost */ } }
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
      await appendFile(resultsFile, JSON.stringify(line) + "\n");
      lines.push(line);
      const sm = line;
      const oth = sm.owner ? Object.values(sm.owner.other || {}).reduce((p, q) => p + q, 0) : null;
      console.log(`${s.group}/${s.name} ${i + 1}${traced ? " traced" : ""}  ttnp ${f1(sm.ttnp)}  stalls ${sm.stalls ? `${sm.stalls.n}/${f1(sm.stalls.total)}/${f1(sm.stalls.worst)}` : "-"}  frames ${sm.frames ? `${f1(sm.frames.p95)}/${f1(sm.frames.max)}` : "-"}  content ${sm.content ? `${f1(sm.content.readable.p95)}/${f1(sm.content.live.p95)}` : "-"}  owner ${sm.owner ? `${f1(sm.owner.plexus)}/${f1(sm.owner.roam)}/${f1(oth)}/${f1(sm.owner.render)}` : "-"}${sm.skip ? `  skip: ${sm.skip}` : ""}${sm.err ? `  ERR ${sm.err}` : ""}`);
      return !line.fatal;
    }

    let go = true;
    for (let i = 0; i < a.n && go && !aborted; i++) for (const s of selected) { if (aborted || !(go = await runOne(s, i, false))) break; }
    if (a.trace && go) for (const s of selected) { if (aborted || !(go = await runOne(s, 0, true))) break; }
    if (!go) console.error("stopped: recovery failed twice in a row (use --keep-going to continue)");
    exitCode = lines.some((l) => l.err) ? 1 : 0;
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
