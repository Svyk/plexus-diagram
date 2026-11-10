// Open scenarios: cold reload, open from Daily Notes, first pan, nested enter, crumb back, fullscreen, sidebar.
import { sleep } from "../lib/cdp.mjs";
import { BOARD, PAGE, saveSidebar, restoreSidebar } from "../lib/bench-window.mjs";

export const group = "open";
const J = (x) => JSON.stringify(x);
const MAIN_ROOT = ".roam-article .pxd-root";

// rAF watcher: ms since the call until the board paints and goes live. `pre` runs right after t0 is taken (same evaluate).
const watchJs = (rootSel, target, pre = "") => `(() => { const P = window.__pxdW = { t0: performance.now(), paint: null, live: null, done: false }; const tgt = ${J(target || "")};
  ${pre}
  const tick = () => { const now = performance.now() - P.t0;
    const ok = !tgt || (window.__plexusDiagram.mounts().some((m) => m.connected && m.current === tgt));
    const roots = [...document.querySelectorAll(${J(rootSel)})].filter((r) => !r.hasAttribute("data-pxd-parked"));
    if (ok) {
      if (P.paint == null && roots.some((r) => r.querySelector(".pxd-item, .pxd-section, canvas"))) P.paint = Math.round(now);
      if (P.live == null && roots.some((r) => !r.hasAttribute("data-pxd-snap") && r.querySelector(".pxd-item"))) P.live = Math.round(now);
    }
    if (P.live == null && now < 60000) requestAnimationFrame(tick); else P.done = true; };
  requestAnimationFrame(tick); return 1; })()`;

async function waitWatch(c, capMs = 60000) {
  const t0 = Date.now();
  for (;;) {
    const w = await c.evJson(`JSON.stringify({ paint: window.__pxdW.paint, live: window.__pxdW.live, done: window.__pxdW.done })`);
    if (w.live != null || w.done || Date.now() - t0 > capMs) return w;
    await sleep(100);
  }
}

const lastOpen = (c) => c.evJson(`JSON.stringify((window.__plexusDiagram && window.__plexusDiagram.perf && window.__plexusDiagram.perf.lastOpen) || null)`);
const take = (ctx) => ctx.probe.take();

// open the board page from wherever we are, timed from the open call
async function openTimed(ctx, extraPre = "") {
  const { c } = ctx;
  await ctx.cam.set(ctx.at(1.07));
  await ctx.probe.arm({});
  await c.ev(watchJs(MAIN_ROOT, "", `${extraPre} window.__pxdStress.act(); window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid: ${J(PAGE)} } });`));
  return waitWatch(c);
}

async function reload(ctx) {
  const { c } = ctx;
  await ctx.aim(ctx.at(1.07));
  await saveSidebar(c);
  await c.send("Page.reload", { ignoreCache: false });
  await sleep(1500);
  const t0 = Date.now();
  let live = null;
  while (Date.now() - t0 < 120000) {
    try { live = await c.ev(`window.__pxdStress && window.__pxdStress.cold ? window.__pxdStress.cold.live : null`, { timeout: 5000 }); } catch { /* still loading */ }
    if (live != null) break;
    await sleep(300);
  }
  if (live == null) throw new Error("board not live 120 s after reload");
  await ctx.afterReload();
  await ctx.probe.quiet({ gap: 3000, max: 40000 });
  const quietAt = Math.round(await c.ev(`performance.now()`));
  const cold = await c.evJson(`JSON.stringify({ title: __pxdStress.cold.title, paint: __pxdStress.cold.paint, live: __pxdStress.cold.live })`);
  const seg = await c.evJson(`(() => { const c = __pxdStress.cold, L = c.loaf, f = (a, b) => { const x = L.filter((e) => e.st >= a && e.st < b); return { n: x.length, total: Math.round(x.reduce((s, e) => s + e.d, 0) * 10) / 10, worst: x.reduce((m, e) => Math.max(m, e.d), 0) }; };
    return JSON.stringify({ afterLive: f(c.live == null ? 1e12 : c.live, 1e12), paintToLive: f(c.paint == null ? 1e12 : c.paint, c.live == null ? 1e12 : c.live) }); })()`);
  const summary = await take(ctx);
  const lo = await lastOpen(c);
  await ctx.cam.restore();
  await restoreSidebar(c);
  if (ctx.fsWanted) await ctx.fullscreen(true);
  return { summary, extra: { ...cold, quietAt, lastOpen: lo, ...seg } };
}

async function openDaily(ctx) {
  const { c } = ctx;
  const w = await openTimed(ctx);
  await ctx.probe.quiet({ gap: 2000, max: 30000 });
  const summary = await take(ctx);
  const lo = await lastOpen(c);
  await ctx.cam.restore();
  return { summary, extra: { paint: w.paint, live: w.live, lastOpen: lo } };
}

async function firstPan(ctx) {
  const { c, input } = ctx;
  const w = await openTimed(ctx);
  await sleep(300);
  const p = await ctx.freePoint(370, -1);
  if (!p) { await take(ctx); await ctx.cam.restore(); return { skip: "no empty background at the start point" }; }
  await ctx.probe.arm({});
  await input.drag({ x1: p.x, y1: p.y, x2: p.x - 370, y2: p.y, steps: 30, delay: 16 });
  await sleep(2000);
  const summary = await take(ctx);
  await ctx.probe.quiet({ gap: 1500, max: 15000 });
  await ctx.cam.restore();
  return { summary, extra: { openPaint: w.paint, openLive: w.live, start: p } };
}

// click an element by selector at its centre when it is on screen, else a DOM click
async function clickSel(ctx, sel) {
  const r = await ctx.c.evJson(`(() => { const el = document.querySelector(${J(sel)}); if (!el) return "null"; const b = el.getBoundingClientRect();
    const inside = b.width > 0 && b.height > 0 && b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight; return JSON.stringify({ inside, x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`);
  if (!r) return false;
  if (r.inside) await ctx.pressAt(r.x, r.y);
  else await ctx.c.ev(`(document.querySelector(${J(sel)}).click(), 1)`);
  return true;
}

const CHAIN_ROOT = ".roam-article .pxd-root:not([data-pxd-snap]):not([data-pxd-parked])";

async function nestedEnter(ctx) {
  const { c } = ctx;
  const steps = [];
  let summary = null;
  for (const uid of ctx.opts.chain) {
    const sel = `${CHAIN_ROOT} .pxd-item[data-uid="${uid}"] .pxd-item__open`;
    await c.ev(`(() => { const v = ${ctx.view}; return v ? v.centerCard(${J(uid)}) : false; })()`);
    let has = false;
    for (let k = 0; k < 40 && !has; k++) { has = await c.ev(`!!document.querySelector(${J(sel)})`); if (!has) await sleep(150); }
    if (!has) { steps.push({ uid, err: "card not mounted" }); break; }
    await ctx.probe.quiet({ gap: 1000, max: 15000 });
    await ctx.probe.arm({});
    await c.ev(watchJs(MAIN_ROOT, uid, `window.__pxdStress.act();`));
    await clickSel(ctx, sel);
    const w = await waitWatch(c, 25000);
    await ctx.probe.quiet({ gap: 1500, max: 15000 });
    summary = await take(ctx);
    steps.push({ uid, paint: w.paint, live: w.live, ttnp: summary.ttnp, stalls: { n: summary.stalls.n, total: summary.stalls.total, worst: summary.stalls.worst } });
  }
  if (!summary) return { skip: "no nested card could be entered", extra: { steps } };
  return { summary, extra: { steps, note: "summary is the last step's window" } };
}

async function crumbBack(ctx) {
  const { c } = ctx;
  const sel = `${CHAIN_ROOT} .pxd-crumbs .pxd-crumb[data-index="0"], ${CHAIN_ROOT} .pxd-crumb[data-index="0"]`;
  if (!(await c.ev(`!!document.querySelector(${J(sel)})`))) return { skip: "no crumb present" };
  try {
    await ctx.probe.quiet({ gap: 1000, max: 10000 });
    await ctx.probe.arm({});
    await c.ev(watchJs(MAIN_ROOT, BOARD, `window.__pxdStress.act();`));
    await clickSel(ctx, sel);
    const w = await waitWatch(c, 25000);
    await ctx.probe.quiet({ gap: 1500, max: 15000 });
    const summary = await take(ctx);
    return { summary, extra: { paint: w.paint, live: w.live } };
  } finally {
    await ctx.ensure("board");
  }
}

async function fullscreenFlip(ctx, to) {
  if ((await ctx.fsState()) === to) await ctx.fullscreen(!to); // start from the other state
  await ctx.probe.quiet({ gap: 1000, max: 10000 });
  let b = null;
  for (let k = 0; k < 6; k++) { b = await ctx.railBtn("rail.fullscreen"); if (b && !b.covered) break; await sleep(300); b = null; }
  if (!b) throw new Error("rail.fullscreen button not found or covered");
  await ctx.probe.arm({});
  const t0 = Date.now();
  await ctx.pressAt(b.x, b.y, { settle: 200 });
  let flipped = false;
  while (Date.now() - t0 < 5000) { if ((await ctx.fsState()) === to) { flipped = true; break; } await sleep(100); }
  const flipMs = Date.now() - t0;
  if (!flipped) { await ctx.probe.take(); throw new Error(`fullscreen press at ${b.x},${b.y} (${b.label}) did not flip within 5 s`); }
  await ctx.refreshSize();
  await ctx.probe.quiet({ gap: 1500, max: 15000 });
  const summary = await take(ctx);
  if (!to && ctx.fsWanted) await ctx.fullscreen(true);
  return { summary, extra: { flipMs, to: to ? "fullscreen" : "inline", label: b.label } };
}

async function sidebarOpen(ctx) {
  const { c } = ctx;
  const before = await c.evJson(`(async () => { const w = (await window.roamAlphaAPI.ui.rightSidebar.getWindows()) || []; return JSON.stringify(w.map((x) => ({ type: x.type || "block", "block-uid": x["block-uid"] || "", "window-id": x["window-id"] || "" }))); })()`);
  const spec = { window: { type: "block", "block-uid": BOARD } };
  await ctx.probe.quiet({ gap: 1000, max: 10000 });
  await ctx.probe.arm({});
  let w = null, summary = null;
  try {
    await c.ev(watchJs("#right-sidebar .pxd-root", "", `window.__pxdStress.act(); window.__pxdSbErr = null; Promise.resolve(window.roamAlphaAPI.ui.rightSidebar.addWindow(${J(spec)})).catch((e) => { window.__pxdSbErr = String(e && e.message || e); });`));
    w = await waitWatch(c, 30000);
    if (w.live == null) throw new Error(`sidebar board not live in 30 s (${await c.ev(`window.__pxdSbErr || "no api error"`)})`);
    await ctx.probe.quiet({ gap: 1500, max: 15000 });
    summary = await take(ctx);
  } finally {
    // remove only the window this run added; a pinned window would ask before closing, so unpin first
    const had = before.some((x) => x["block-uid"] === BOARD);
    if (!had) {
      await c.ev(`(async () => { const api = window.roamAlphaAPI.ui.rightSidebar; const spec = ${J(spec)}; const cap = (p, ms) => Promise.race([Promise.resolve(p), new Promise((r) => setTimeout(r, ms))]);
        try { await cap(api.unpinWindow && api.unpinWindow(spec), 3000); } catch (e) {}
        try { await cap(api.removeWindow(spec), 5000); } catch (e) {}
        if (${before.length} === 0) { try { await cap(api.close && api.close(), 2000); } catch (e) {} }
        return 1; })()`, { timeout: 20000 });
    }
  }
  return { summary, extra: { paint: w.paint, live: w.live } };
}

export const scenarios = [
  { name: "reload", title: "Cold reload of the board page: title, paint, live, quiet", leaves: true, run: reload },
  { name: "open-daily", title: "Open the board page from Daily Notes", leaves: true, needs: "daily", run: openDaily },
  { name: "first-pan", title: "Background drag-pan 300 ms after the board is live", leaves: true, needs: "daily", run: firstPan },
  { name: "nested-enter", title: "Enter the nested board chain through the cards' open buttons", run: nestedEnter },
  { name: "crumb-back", title: "Crumb back to the stress board from a nested board", needs: "any", run: crumbBack },
  { name: "fullscreen-out", title: "Leave fullscreen", run: (ctx) => fullscreenFlip(ctx, false) },
  { name: "fullscreen-in", title: "Enter fullscreen", run: (ctx) => fullscreenFlip(ctx, true) },
  { name: "sidebar-open", title: "Open the board in the right sidebar", run: sidebarOpen },
];
