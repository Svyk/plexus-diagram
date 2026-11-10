// Moving around the stress board the way the recorded session did: rail zoom buttons, drag-pan on the background,
// clicks by target, hover, mouse-wheel zoom and pan, trackpad-style pinch and flick, fit, and a replay of the safe part
// of a recorded session. Read-only for the graph: every press is hit-tested first (DOM and world rects), so a drag can
// only start on empty background and a click can only select.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sleep } from "../lib/cdp.mjs";
import { OUT_DIR } from "../lib/bench-window.mjs";

export const group = "move";

// ---- page helpers (geometry and hit tests; installed once per document)
const PAGE_JS = String.raw`(() => {
  if (window.__pxdMove && window.__pxdMove.v === 2) return "already";
  const V = () => window.__pxdStress.view();
  const G = () => { const v = V(); if (!v) return null; return { v, rr: v.root.getBoundingClientRect(), vp: v.viewport(), src: v.snapshotSource() }; };
  const BAD = ".pxd-chrome, .pxd-out, .pxd-port, .pxd-grip, .pxd-edge, .pxd-label, .pxd-link, .pxd-section__title, .pxd-section__edge, .pxd-item, .pxd-btn, button, a, input, textarea, select, [contenteditable]";
  // inside the board surface and clear of the toolbar, rail, dock and minimap
  const central = (g, x, y, m = 90) => x > g.rr.left + m && x < g.rr.right - m && y > g.rr.top + m && y < g.rr.bottom - m;
  // Empty background at a page point: the element there is plain board surface, and in world space no card and no
  // section title or border is within pad px (a press on a card that has no shell yet is still that card).
  const empty = (x, y, pad = 14) => {
    const g = G(); if (!g || !g.src) return false;
    const { v, rr, vp, src } = g;
    if (!central(g, x, y, 40)) return false;
    const surface = v.root.querySelector(".pxd-viewport");
    const el = document.elementFromPoint(x, y);
    if (!el || !surface || !surface.contains(el) || el.closest(BAD)) return false;
    const wx = (x - rr.left - vp.x) / vp.zoom, wy = (y - rr.top - vp.y) / vp.zoom, p = pad / vp.zoom, tb = 28 / vp.zoom;
    for (const [uid, it] of src.board.items) {
      const r = src.rects.get(uid); if (!r) continue;
      if (it.type === "section") {
        if (wx >= r.x - p && wx <= r.x + r.w + p && wy >= r.y - tb - p && wy <= r.y + p) return false;
        const outer = wx >= r.x - p && wx <= r.x + r.w + p && wy >= r.y - p && wy <= r.y + r.h + p;
        const inner = wx >= r.x + p && wx <= r.x + r.w - p && wy >= r.y + p && wy <= r.y + r.h - p;
        if (outer && !inner) return false;
      } else if (wx >= r.x - p && wx <= r.x + r.w + p && wy >= r.y - p && wy <= r.y + r.h + p) return false;
    }
    return true;
  };
  // nearest empty point to (cx, cy) whose drag end (start + d) stays in the central area
  const findEmpty = (cx, cy, dx = 0, dy = 0) => {
    const g = G(); if (!g) return null;
    if (cx == null) { cx = g.rr.left + g.rr.width / 2; cy = g.rr.top + g.rr.height / 2; }
    for (let ring = 0; ring <= 16; ring++) for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
      const x = cx + i * 26, y = cy + j * 26;
      if (empty(x, y) && central(g, x + dx, y + dy)) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  };
  const btn = (re) => { const v = V(); if (!v) return null; const rx = new RegExp(re, "i");
    const b = [...v.root.querySelectorAll(".pxd-rail .pxd-btn")].find((n) => rx.test(n.getAttribute("title") || n.getAttribute("aria-label") || ""));
    if (!b) return null; const r = b.getBoundingClientRect(); return r.width ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), title: b.getAttribute("title") || "" } : null; };
  // what is under a page point, in the view's own terms
  const at = (x, y) => { const g = G(); const el = document.elementFromPoint(x, y); if (!g || !el || !g.v.root.contains(el)) return { kind: "outside" };
    const c = (s) => el.closest(s);
    if (c(".pxd-chrome, .pxd-btn")) return { kind: "chrome" };
    for (const [k, s] of [["port", ".pxd-port"], ["grip", ".pxd-grip"], ["label", ".pxd-label"], ["edge", ".pxd-edge"], ["link", ".pxd-link"], ["section-title", ".pxd-section__title"], ["section-border", ".pxd-section__edge"]]) { const n = c(s); if (n) { const o = n.closest("[data-uid]"); return { kind: k, uid: o ? o.getAttribute("data-uid") : null }; } }
    const it = c(".pxd-item");
    if (it) { const body = it.querySelector(".pxd-item__body"); return { kind: "item", uid: it.getAttribute("data-uid"), plain: el === it || el === body || el.classList.contains("pxd-item__header") }; }
    return { kind: empty(x, y) ? "empty" : "near" }; };
  // cards on screen with a point on their own shell (never a link, checkbox, button, row or handle)
  const cardPoints = (max = 5) => { const g = G(); if (!g || !g.src) return []; const out = [];
    for (const sh of g.v.root.querySelectorAll(".pxd-item[data-uid]")) { const b = sh.getBoundingClientRect(); if (b.width < 70 || b.height < 44) continue;
      const uid = sh.getAttribute("data-uid"), body = sh.querySelector(".pxd-item__body");
      for (const [fx, fy] of [[7, 7], [b.width - 9, 7], [7, b.height - 9]]) { const x = b.left + fx, y = b.top + fy; if (!central(g, x, y)) continue; const el = document.elementFromPoint(x, y);
        if (el && (el === sh || el === body || el.classList.contains("pxd-item__header"))) { const it = g.src.board.items.get(uid); out.push({ x: Math.round(x), y: Math.round(y), uid, kind: it ? it.kind : "" }); break; } }
      if (out.length >= max) break; }
    return out; };
  // points on attached arrows, away from their ends and labels
  const edgePoints = (max = 3) => { const g = G(); if (!g) return []; const out = [];
    for (const e of g.v.root.querySelectorAll(".pxd-edges .pxd-edge[data-uid]")) { const p = e.querySelector("path"); if (!p || !p.getTotalLength) continue; let len = 0; try { len = p.getTotalLength(); } catch (x) { continue; } if (len < 90) continue;
      const m = p.getScreenCTM(); if (!m) continue;
      for (const f of [0.5, 0.38, 0.62]) { const q = p.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e, y = q.x * m.b + q.y * m.d + m.f; if (!central(g, x, y)) continue; const el = document.elementFromPoint(x, y);
        if (el && el.closest(".pxd-edge") === e && !el.closest(".pxd-edge__end, .pxd-edge__child, .pxd-label")) { out.push({ x: Math.round(x), y: Math.round(y), uid: e.getAttribute("data-uid") }); break; } }
      if (out.length >= max) break; }
    return out; };
  const box = () => { const g = G(); return g ? { x: g.rr.left, y: g.rr.top, w: g.rr.width, h: g.rr.height, zoom: g.vp.zoom, vx: g.vp.x, vy: g.vp.y, lod: g.v.root.getAttribute("data-pxd-lod") } : null; };
  const sel = () => { const v = V(); const s = v && v.state ? v.state() : null; return s ? s.selection : null; };
  // hover moments: Event Timing rows of one mouse move merged (they share a timestamp)
  let HO = null;
  const HOVER = /^(pointer|mouse)(over|out|enter|leave)$/;
  const hoverStart = () => { const rows = []; const o = new PerformanceObserver((l) => { for (const e of l.getEntries()) if (HOVER.test(e.name)) rows.push([e.startTime, e.duration]); }); o.observe({ type: "event", durationThreshold: 16 }); HO = { o, rows }; return 1; };
  const hoverStop = () => { if (!HO) return null; const { o, rows } = HO; HO = null; for (const e of o.takeRecords()) if (HOVER.test(e.name)) rows.push([e.startTime, e.duration]); o.disconnect();
    rows.sort((a, b) => a[0] - b[0]); const m = []; for (const r of rows) { const last = m[m.length - 1]; if (last && r[0] - last[0] <= 4) last[1] = Math.max(last[1], r[1]); else m.push([r[0], r[1]]); }
    const d = m.map((x) => x[1]).sort((a, b) => a - b); const q = (p) => (d.length ? d[Math.min(d.length - 1, Math.floor(d.length * p))] : null);
    return { slow16: d.length, p50: q(0.5), p90: q(0.9), max: d.length ? d[d.length - 1] : null, over40: d.filter((x) => x >= 40).length, over100: d.filter((x) => x >= 100).length }; };
  window.__pxdMove = { v: 2, empty, findEmpty, btn, at, cardPoints, edgePoints, box, sel, hoverStart, hoverStop };
  return "installed";
})()`;

const M = "window.__pxdMove";
const install = (ctx) => ctx.c.ev(PAGE_JS);
const page = (ctx, expr) => ctx.c.evJson(`JSON.stringify(${M}.${expr} ?? null)`);
const med = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const pq = (a, p) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : null; };
const dist = (a) => ({ n: a.filter((x) => x != null).length, p50: med(a), p90: pq(a, 0.9), max: a.some((x) => x != null) ? Math.max(...a.filter((x) => x != null)) : null });
const band = (z) => (z == null ? "none" : z < 0.2 ? "map" : z < 0.6 ? "overview" : z < 0.9 ? "small" : z < 1.3 ? "reading" : "close");
// Event Timing rows only exist from 16 ms up: a missing row means the event painted faster than that.
const FAST = 12;
const evd = (sum, name) => { const r = (sum?.input?.events || []).filter((e) => e.n === name); return r.length ? Math.max(...r.map((e) => e.d)) : null; };

// one measured action: arm, act, wait for the redraw to finish, take
async function step(ctx, label, fn, { wait = 430, content = true, settle = 150, max = 2500 } = {}) {
  await ctx.probe.arm({ label, content });
  await fn();
  await sleep(wait);
  if (settle) await ctx.probe.quiet({ gap: settle, max });
  const sum = await ctx.probe.take();
  sum.label = label;
  return sum;
}
const row = (sum, more = {}) => ({
  label: sum.label, z0: sum.c0?.zoom ?? null, z1: sum.c1?.zoom ?? null, band: band(sum.c1?.zoom), lod: sum.c1?.lod ?? null,
  down: evd(sum, "pointerdown"), up: evd(sum, "pointerup"), click: evd(sum, "click"), ttnp: sum.ttnp,
  stalls: sum.stalls.n, stallMs: Math.round(sum.stalls.total), worst: Math.round(sum.stalls.worst),
  fp95: sum.frames?.p95 ?? null, fmax: sum.frames?.max ?? null, over50: sum.frames?.over50 ?? 0,
  wheel: sum.input?.wheel?.p95 ?? null, maxEmpty: sum.content?.maxEmpty ?? null, maxMissing: sum.content?.maxMissing ?? null,
  readable: sum.content?.readable?.max ?? null, live: sum.content?.live?.max ?? null, neverLive: sum.content?.neverLive ?? null, attached: sum.c1?.attached ?? null, ...more,
});
// one Summary for a scenario made of several steps: stalls add up, worst cases win
function merge(label, sums) {
  const list = sums.flatMap((s) => s.stalls.list.map((f) => ({ ...f, step: s.label }))).sort((a, b) => b.d - a.d).slice(0, 40);
  const sum = (f) => sums.reduce((a, s) => a + (f(s) || 0), 0), mx = (f) => sums.reduce((a, s) => Math.max(a, f(s) || 0), 0);
  const cs = sums.map((s) => s.content).filter(Boolean);
  const cd = (k) => ({ n: cs.reduce((a, c) => a + (c[k]?.n || 0), 0), p50: med(cs.map((c) => c[k]?.p50)), p95: cs.reduce((a, c) => Math.max(a, c[k]?.p95 || 0), 0) || null, max: cs.reduce((a, c) => Math.max(a, c[k]?.max || 0), 0) || null });
  const last = sums[sums.length - 1] || {};
  return {
    label, ms: Math.round(sum((s) => s.ms)), steps: sums.length,
    stalls: { n: sum((s) => s.stalls.n), total: Math.round(sum((s) => s.stalls.total)), worst: Math.round(mx((s) => s.stalls.worst)), list },
    long: { n: sum((s) => s.long.n), total: Math.round(sum((s) => s.long.total)), worst: Math.round(mx((s) => s.long.worst)) },
    frames: { n: sum((s) => s.frames?.n), p50: med(sums.map((s) => s.frames?.p50)), p95: mx((s) => s.frames?.p95), p99: mx((s) => s.frames?.p99), max: mx((s) => s.frames?.max), over34: sum((s) => s.frames?.over34), over50: sum((s) => s.frames?.over50), over100: sum((s) => s.frames?.over100) },
    input: { n: sum((s) => s.input?.n), events: sums.flatMap((s) => (s.input?.events || []).map((e) => ({ ...e, step: s.label }))).sort((a, b) => b.d - a.d).slice(0, 60), wheel: { n: sum((s) => s.input?.wheel?.n), p95: mx((s) => s.input?.wheel?.p95), max: mx((s) => s.input?.wheel?.max) } },
    ttnp: med(sums.map((s) => s.ttnp)),
    content: cs.length ? { samples: cs.reduce((a, c) => a + c.samples, 0), cost: Math.round(cs.reduce((a, c) => a + c.cost, 0)), maxMissing: Math.max(...cs.map((c) => c.maxMissing)), maxEmpty: Math.max(...cs.map((c) => c.maxEmpty)), entered: cs.reduce((a, c) => a + c.entered, 0), readable: cd("readable"), live: cd("live"), neverReadable: cs.reduce((a, c) => a + c.neverReadable, 0), neverLive: cs.reduce((a, c) => a + c.neverLive, 0), leftBeforeLive: cs.reduce((a, c) => a + c.leftBeforeLive, 0), end: cs[cs.length - 1].end } : null,
    marks: [], c0: sums[0]?.c0 ?? null, c1: last.c1 ?? null,
    plexus: { longTasks: sums.flatMap((s) => s.plexus?.longTasks || []), slowMounts: sums.flatMap((s) => s.plexus?.slowMounts || []), paintAudit: last.plexus?.paintAudit ?? null, bgOverruns: last.plexus?.bgOverruns ?? null },
  };
}
// every Event Timing duration of one event name on one target class in a window; actions that painted in under 16 ms
// leave no row, so the list is padded to the number of actions sent
const evAll = (sum, name, tg, n = 0) => { const d = (sum?.input?.events || []).filter((e) => e.n === name && String(e.tg || "").startsWith(tg)).map((e) => e.d); while (d.length < n) d.push(FAST); return d; };
const byBand = (rows, key) => { const o = {}; for (const r of rows) (o[r.band] = o[r.band] || []).push(r[key] ?? FAST); return Object.fromEntries(Object.entries(o).map(([b, a]) => [b, dist(a)])); };
async function go(ctx, zoom, dx = 0, dy = 0) { await ctx.show(ctx.at(zoom, dx, dy)); await install(ctx); }
async function clearSelection(ctx) {
  const s = await page(ctx, "sel()");
  if (!s || !s.length) return true;
  const p = await page(ctx, "findEmpty()");
  if (p) await ctx.input.click(p.x, p.y); else await ctx.input.key("Escape");
  await sleep(200);
  return !((await page(ctx, "sel()")) || []).length;
}
// a click that is only sent when the point still is what the scenario expects after the pointer got there
async function guardedClick(ctx, p, want) {
  await ctx.input.move(p.x, p.y);
  await sleep(60);
  const t = await page(ctx, `at(${p.x}, ${p.y})`);
  if (!t || !want(t)) return null;
  return t;
}

const ZOOMS = { reading: 1.07, small: 0.63, overview: 0.3, map: 0.12 };

// ---- rail zoom buttons: the recorded session zoomed with 50 clicks on them (x1.2 a step)
async function zoomButtons(ctx) {
  await go(ctx, ZOOMS.reading);
  const n = ctx.opts.quick ? 5 : 13;
  const sums = [], rows = [];
  for (const dir of ["out", "in"]) {
    const b = await page(ctx, `btn(${JSON.stringify(dir === "out" ? "^zoom out" : "^zoom in")})`);
    if (!b) return { skip: `no "zoom ${dir}" button on the rail` };
    await ctx.input.move(b.x, b.y);
    await sleep(300);
    for (let k = 0; k < n; k++) {
      const s = await step(ctx, `${dir}-${k + 1}`, () => ctx.input.click(b.x, b.y));
      sums.push(s); rows.push(row(s, { dir }));
    }
    await ctx.probe.quiet({ gap: 800, max: 6000 });
  }
  // the recorded cadence: a click every 262 ms (median), so each redraw lands on the next press
  const fast = {};
  for (const dir of ["out", "in"]) {
    const b = await page(ctx, `btn(${JSON.stringify(dir === "out" ? "^zoom out" : "^zoom in")})`);
    await ctx.input.move(b.x, b.y);
    await sleep(300);
    const s = await step(ctx, `fast-${dir}`, async () => { for (let k = 0; k < n; k++) { const t = Date.now(); await ctx.input.click(b.x, b.y); await sleep(Math.max(0, 262 - (Date.now() - t))); } }, { wait: 300, settle: 400, max: 6000 });
    sums.push(s);
    fast[dir] = { clicks: n, click: dist(evAll(s, "click", "pxd-btn", n)), down: dist(evAll(s, "pointerdown", "pxd-btn", n)), up: dist(evAll(s, "pointerup", "pxd-btn", n)), stalls: s.stalls.n, stallMs: Math.round(s.stalls.total), worst: Math.round(s.stalls.worst), fmax: s.frames?.max, z1: s.c1?.zoom };
  }
  await go(ctx, ZOOMS.reading);
  const clicks = rows.map((r) => r.click ?? FAST);
  return { summary: merge("zoom-btn", sums), ttnp: med(clicks), extra: { steps: rows, click: dist(clicks), down: dist(rows.map((r) => r.down ?? FAST)), clickByBand: byBand(rows, "click"), downByBand: byBand(rows, "down"), under16: rows.filter((r) => r.click == null).length, fast } };
}

// ---- drag-pan on the background (26 of the session's 33 drags), 370 px in about 460 ms
function dragPan(name) {
  return async (ctx) => {
    await go(ctx, ZOOMS[name]);
    const dirs = ctx.opts.quick ? [[-370, 0], [370, 0]] : [[-370, 0], [370, 0], [0, -230], [0, 230], [-370, 0], [370, 0]];
    const sums = [], rows = [];
    for (const [dx, dy] of dirs) {
      const p = await page(ctx, `findEmpty(null, null, ${dx}, ${dy})`);
      if (!p) { rows.push({ label: "skip", why: "no empty background near the centre" }); continue; }
      const s = await step(ctx, `drag ${dx},${dy}`, () => ctx.input.drag({ x1: p.x, y1: p.y, x2: p.x + dx, y2: p.y + dy, steps: 28, delay: 16 }), { wait: 500, settle: 300, max: 5000 });
      sums.push(s); rows.push(row(s));
      await sleep(250);
    }
    if (!sums.length) return { skip: "no empty background to press on at this zoom" };
    await go(ctx, ZOOMS[name]);
    return { summary: merge(`drag-pan-${name}`, sums), ttnp: med(rows.map((r) => (r.label === "skip" ? null : r.down ?? FAST))), extra: { steps: rows, press: dist(rows.filter((r) => r.label !== "skip").map((r) => r.down ?? FAST)), release: dist(rows.filter((r) => r.label !== "skip").map((r) => r.up ?? FAST)), worstFrame: Math.max(0, ...rows.map((r) => r.fmax || 0)) } };
  };
}

// ---- clicks by target
async function clickEmpty(ctx) {
  const sums = [], rows = [];
  for (const name of ["reading", "small", "overview"]) {
    await go(ctx, ZOOMS[name]);
    const p = await page(ctx, "findEmpty()");
    if (!p) continue;
    for (let k = 0; k < (ctx.opts.quick ? 2 : 5); k++) { const s = await step(ctx, `empty ${name} ${k + 1}`, () => ctx.input.click(p.x, p.y)); sums.push(s); rows.push(row(s)); }
  }
  if (!sums.length) return { skip: "no empty background found" };
  await go(ctx, ZOOMS.reading);
  return { summary: merge("click-empty", sums), ttnp: med(rows.map((r) => r.click ?? FAST)), extra: { steps: rows, clickByBand: byBand(rows, "click"), downByBand: byBand(rows, "down") } };
}
async function clickItem(ctx) {
  const sums = [], rows = [];
  for (const name of ["reading", "small"]) {
    await go(ctx, ZOOMS[name]);
    await clearSelection(ctx);
    const pts = await page(ctx, `cardPoints(${ctx.opts.quick ? 2 : 4})`);
    for (const p of pts || []) {
      const t = await guardedClick(ctx, p, (x) => x.kind === "item" && x.uid === p.uid && x.plain);
      if (!t) { rows.push({ label: "skip", uid: p.uid, why: "not the card's own surface once hovered" }); continue; }
      const s = await step(ctx, `item ${name} ${p.kind}`, async () => { await ctx.input.down(p.x, p.y); await ctx.input.up(p.x, p.y); });
      const sel = await page(ctx, "sel()");
      sums.push(s); rows.push(row(s, { uid: p.uid, kind: p.kind, selected: Array.isArray(sel) && sel.length === 1 && sel[0] === p.uid }));
      const e = await page(ctx, "findEmpty()");
      if (e) { const d = await step(ctx, `deselect ${name}`, () => ctx.input.click(e.x, e.y)); sums.push(d); rows.push(row(d, { deselect: true })); }
      else await clearSelection(ctx);
    }
  }
  const ok = await clearSelection(ctx);
  await go(ctx, ZOOMS.reading);
  const picks = rows.filter((r) => r.uid && r.label !== "skip");
  if (!picks.length) return { skip: "no card with a safe point on screen" };
  return { summary: merge("click-item", sums), ttnp: med(picks.map((r) => r.click ?? FAST)), extra: { steps: rows, select: dist(picks.map((r) => r.click ?? FAST)), press: dist(picks.map((r) => r.down ?? FAST)), deselect: dist(rows.filter((r) => r.deselect).map((r) => r.click ?? FAST)), selectionCleared: ok } };
}
async function clickEdge(ctx) {
  const sums = [], rows = [];
  for (const name of ["reading", "small"]) {
    await go(ctx, ZOOMS[name]);
    await clearSelection(ctx);
    const pts = await page(ctx, `edgePoints(${ctx.opts.quick ? 1 : 3})`);
    for (const p of pts || []) {
      const t = await guardedClick(ctx, p, (x) => x.kind === "edge" && x.uid === p.uid);
      if (!t) { rows.push({ label: "skip", uid: p.uid }); continue; }
      const s = await step(ctx, `edge ${name}`, async () => { await ctx.input.down(p.x, p.y); await ctx.input.up(p.x, p.y); });
      sums.push(s); rows.push(row(s, { uid: p.uid }));
      const e = await page(ctx, "findEmpty()");
      if (e) { await ctx.input.click(e.x, e.y); await sleep(250); } else { await ctx.input.key("Escape"); await sleep(250); }
    }
  }
  await clearSelection(ctx);
  await go(ctx, ZOOMS.reading);
  const picks = rows.filter((r) => r.label !== "skip");
  if (!picks.length) return { skip: "no arrow with a free point on screen" };
  return { summary: merge("click-edge", sums), ttnp: med(picks.map((r) => r.click ?? FAST)), extra: { steps: rows, select: dist(picks.map((r) => r.click ?? FAST)), press: dist(picks.map((r) => r.down ?? FAST)) } };
}

// ---- hover: the pointer crosses the board at a steady 375 px/s, no button down
async function hoverSweep(ctx) {
  const sums = [], out = {};
  for (const name of ctx.opts.quick ? ["small"] : ["reading", "small", "overview"]) {
    await go(ctx, ZOOMS[name]);
    const b = await page(ctx, "box()");
    const y = b.y + b.h * 0.5, x0 = b.x + 110, x1 = b.x + b.w - 110, n = Math.round((x1 - x0) / 6);
    await ctx.input.move(x0, y);
    await sleep(200);
    await ctx.c.ev(`${M}.hoverStart()`);
    const s = await step(ctx, `hover ${name}`, async () => {
      for (const yy of [y, y - 90]) {
        for (let i = 0; i <= n; i++) { await ctx.input.move(x0 + i * 6, yy + Math.sin(i / 9) * 30); await sleep(16); }
        for (let i = n; i >= 0; i--) { await ctx.input.move(x0 + i * 6, yy + 45 + Math.sin(i / 9) * 30); await sleep(16); }
      }
    }, { wait: 300, content: false });
    out[name] = { ...(await page(ctx, "hoverStop()")), moves: (n + 1) * 4, stalls: s.stalls.n, stallMs: Math.round(s.stalls.total), fp95: s.frames?.p95, fmax: s.frames?.max, over50: s.frames?.over50 };
    sums.push(s);
  }
  await go(ctx, ZOOMS.reading);
  return { summary: merge("hover-sweep", sums), ttnp: out.small?.p90 ?? null, extra: { hover: out } };
}

// ---- mouse wheel: Cmd+wheel notches (25 of the session's 32 wheel events) and plain wheel pan
async function wheelZoom(ctx) {
  await go(ctx, ZOOMS.reading);
  const b = await page(ctx, "box()");
  const x = b.x + b.w / 2, y = b.y + b.h / 2;
  await ctx.input.move(x, y);
  const sums = [], rows = [];
  for (const dy of [47, 47, 47, 47, -47, -47, -47, -47].slice(0, ctx.opts.quick ? 4 : 8)) {
    const s = await step(ctx, `notch ${dy}`, () => ctx.input.wheelSeries(x, y, [{ dt: 0, dx: 0, dy, mods: 4 }, { dt: 52, dx: 0, dy, mods: 4 }, { dt: 80, dx: 0, dy: Math.sign(dy) * 3.7, mods: 4 }]), { wait: 500, settle: 200 });
    sums.push(s); rows.push(row(s));
  }
  await go(ctx, ZOOMS.reading);
  return { summary: merge("wheel-zoom", sums), ttnp: med(rows.map((r) => r.ttnp)), extra: { steps: rows, wheelToPaint: dist(rows.map((r) => r.wheel)) } };
}
async function wheelPan(ctx) {
  await go(ctx, ZOOMS.small);
  const b = await page(ctx, "box()");
  const x = b.x + b.w / 2, y = b.y + b.h / 2;
  await ctx.input.move(x, y);
  const sums = [], rows = [];
  for (const dy of [79, 79, 79, -79, -79, -79].slice(0, ctx.opts.quick ? 2 : 6)) {
    const s = await step(ctx, `wheel ${dy}`, () => ctx.input.wheelSeries(x, y, [{ dt: 0, dx: 0, dy }, { dt: 160, dx: 0, dy: dy / 20 }]), { wait: 450, settle: 200 });
    sums.push(s); rows.push(row(s));
  }
  await go(ctx, ZOOMS.reading);
  return { summary: merge("wheel-pan", sums), ttnp: med(rows.map((r) => r.ttnp)), extra: { steps: rows } };
}
// ---- trackpad style: 120 Hz pinch (fine Cmd+wheel deltas) and a flick with a decaying tail. Not how the recorded
// session moved (that was a mouse); kept so a trackpad user has a number.
async function trackpad(ctx) {
  await go(ctx, ZOOMS.reading);
  const b = await page(ctx, "box()");
  const x = b.x + b.w / 2, y = b.y + b.h / 2;
  await ctx.input.move(x, y);
  const sums = [], rows = [];
  const acts = [
    ["pinch-out", () => ctx.input.burst({ x, y, dy: 2.2, n: 70, hz: 120, mods: 4 })],
    ["pinch-in", () => ctx.input.burst({ x, y, dy: -2.2, n: 70, hz: 120, mods: 4 })],
    ["flick-down", () => ctx.input.flick({ x, y, vy: 38 })],
    ["flick-up", () => ctx.input.flick({ x, y, vy: -38 })],
    ["flick-right", () => ctx.input.flick({ x, y, vx: 38 })],
    ["flick-left", () => ctx.input.flick({ x, y, vx: -38 })],
  ];
  for (const [label, fn] of acts) { const s = await step(ctx, label, fn, { wait: 500, settle: 300, max: 5000 }); sums.push(s); rows.push(row(s)); }
  await go(ctx, ZOOMS.reading);
  return { summary: merge("trackpad", sums), ttnp: med(rows.map((r) => r.ttnp)), extra: { steps: rows, wheelToPaint: dist(rows.map((r) => r.wheel)) } };
}
async function fit(ctx) {
  await go(ctx, ZOOMS.reading);
  const b = await page(ctx, `btn("^fit")`);
  if (!b) return { skip: "no fit button on the rail" };
  await ctx.input.move(b.x, b.y);
  await sleep(300);
  const s = await step(ctx, "fit", () => ctx.input.click(b.x, b.y), { wait: 600, settle: 600, max: 8000 });
  const back = await step(ctx, "back to reading", () => ctx.c.ev(`(window.__pxdStress.act(), window.__pxdStress.view().showAt(${JSON.stringify(ctx.at(ZOOMS.reading))}), 1)`), { wait: 600, settle: 600, max: 8000 });
  await install(ctx);
  return { summary: merge("fit", [s, back]), ttnp: evd(s, "click") ?? FAST, extra: { steps: [row(s), row(back)] } };
}

// ---- replay of a recorded session: zoom-button clicks, background drags, empty clicks and wheels with their own
// timing (gaps capped). Card, port and arrow gestures, double-clicks and keys are left out: they would edit the board.
async function replay(ctx) {
  const file = ctx.opts.replay || join(OUT_DIR, "rec", "real-1-wheel.json");
  let log;
  try { log = JSON.parse(await readFile(file, "utf8")); } catch { return { skip: `no session log at ${file}` }; }
  const cams = log.cam || [], acts = [];
  const camAt = (t, why) => cams.filter((c) => c[1] === why && c[0] >= t - 5).sort((a, b) => a[0] - b[0])[0];
  for (const p of log.p || []) {
    const [t, , x1, y1, x2, y2, dur, moves, kind] = p;
    if (moves === -2) continue;
    const moved = Math.hypot(x2 - x1, y2 - y1);
    if (kind === "pxd-btn") { const a = camAt(t, "pd"), b = camAt(t + dur, "pu"); if (!a || !b || a[4] === b[4]) continue; acts.push({ t, k: "btn", dir: b[4] > a[4] ? "in" : "out" }); }
    else if (kind === "pxd-root" && moved > 6) acts.push({ t, k: "drag", x1, y1, dx: x2 - x1, dy: y2 - y1, dur });
    else if (kind === "pxd-root") acts.push({ t, k: "empty", x1, y1 });
  }
  let cur = null;
  for (const w of log.w || []) { if (!cur || w[0] - cur.last > 180) { cur = { t: w[0], k: "wheel", list: [], last: w[0] }; acts.push(cur); } cur.list.push({ dt: cur.list.length ? w[0] - cur.last : 0, dx: w[2], dy: w[3], mods: (w[4] & 1 ? 2 : 0) | (w[4] & 2 ? 4 : 0) | (w[4] & 4 ? 8 : 0) }); cur.last = w[0]; }
  acts.sort((a, b) => a.t - b.t);
  const list = ctx.opts.quick ? acts.slice(0, 12) : acts;
  if (!list.length) return { skip: "the session log holds no replayable action" };
  const start = cams.find((c) => c[1] === "start") || cams[0];
  if (start) { await ctx.show({ x: start[2], y: start[3], zoom: start[4] }); await install(ctx); } else await go(ctx, ZOOMS.reading);
  const box = await page(ctx, "box()");
  // actions closer than 700 ms form one burst: they are sent with their recorded gaps inside one measured window,
  // so a redraw lands on the next press exactly as it did in the session
  const bursts = [];
  for (const a of list) { const last = bursts[bursts.length - 1]; if (last && a.t - last[last.length - 1].t < 700) last.push(a); else bursts.push([a]); }
  const sums = [], sent = { btn: 0, drag: 0, empty: 0, wheel: 0 };
  let skipped = 0;
  const run = async (a) => {
    if (a.k === "btn") { const b = await page(ctx, `btn(${JSON.stringify(a.dir === "out" ? "^zoom out" : "^zoom in")})`); if (!b) return false; await ctx.input.click(b.x, b.y); return true; }
    if (a.k === "drag") { const p = await page(ctx, `findEmpty(${a.x1}, ${a.y1}, ${a.dx}, ${a.dy})`); if (!p) return false; await ctx.input.drag({ x1: p.x, y1: p.y, x2: p.x + a.dx, y2: p.y + a.dy, steps: Math.max(4, Math.round(a.dur / 16)), delay: 16 }); return true; }
    if (a.k === "empty") { const p = await page(ctx, `findEmpty(${a.x1}, ${a.y1})`); if (!p) return false; await ctx.input.click(p.x, p.y); return true; }
    await ctx.input.wheelSeries(box.x + box.w / 2, box.y + box.h / 2, a.list); return true;
  };
  for (const burst of bursts) {
    const s = await step(ctx, `burst ${burst.map((a) => a.k[0]).join("")}`, async () => {
      const t0 = Date.now();
      for (const a of burst) { const due = a.t - burst[0].t - (Date.now() - t0); if (due > 0) await sleep(due); if (await run(a)) sent[a.k]++; else skipped++; }
    }, { wait: 250, settle: 250, max: 4000 });
    sums.push(s);
    await sleep(350);
  }
  await ctx.probe.quiet({ gap: 1500, max: 12000 });
  await clearSelection(ctx);
  await go(ctx, ZOOMS.reading);
  const all = (name, tg, n) => dist(sums.flatMap((s) => evAll(s, name, tg)).concat(Array(Math.max(0, n - sums.reduce((x, s) => x + evAll(s, name, tg).length, 0))).fill(FAST)));
  const rootN = sent.drag + sent.empty;
  const presses = { "pointerdown|pxd-btn": all("pointerdown", "pxd-btn", sent.btn), "pointerup|pxd-btn": all("pointerup", "pxd-btn", sent.btn), "click|pxd-btn": all("click", "pxd-btn", sent.btn), "pointerdown|pxd-root": all("pointerdown", "pxd-root", rootN), "pointerup|pxd-root": all("pointerup", "pxd-root", rootN) };
  const merged = merge("replay-nav", sums);
  return { summary: merged, ttnp: presses["click|pxd-btn"].p50, extra: { file, actions: list.length, bursts: bursts.length, sent, skipped, presses, worstFrame: merged.frames.max, seconds: Math.round((list[list.length - 1].t - list[0].t) / 1000), steps: sums.map((s) => row(s)) } };
}

export const scenarios = [
  { name: "zoom-btn", title: "Rail zoom out x13 then zoom in x13, one click at a time", run: zoomButtons },
  { name: "drag-pan-reading", title: "Drag the background 370 px at 107% zoom", run: dragPan("reading") },
  { name: "drag-pan-small", title: "Drag the background 370 px at 63% zoom", run: dragPan("small") },
  { name: "drag-pan-overview", title: "Drag the background 370 px at 30% zoom", run: dragPan("overview") },
  { name: "drag-pan-map", title: "Drag the background 370 px at 12% zoom", run: dragPan("map") },
  { name: "click-empty", title: "Click empty background (107%, 63%, 30%)", run: clickEmpty },
  { name: "click-item", title: "Click a card to select it, click away", run: clickItem },
  { name: "click-edge", title: "Click an arrow to select it", run: clickEdge },
  { name: "hover-sweep", title: "Move the pointer across the board, no button", run: hoverSweep },
  { name: "wheel-zoom", title: "Cmd+wheel notches in and out at 107%", run: wheelZoom },
  { name: "wheel-pan", title: "Plain wheel pan at 63%", run: wheelPan },
  { name: "trackpad", title: "Trackpad-style pinch and flick at 107%", run: trackpad },
  { name: "fit", title: "Fit view, then back to 107%", run: fit },
  { name: "replay-nav", title: "Replay the recorded session's zoom clicks, drags and wheels", run: replay },
];
