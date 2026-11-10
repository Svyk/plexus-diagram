// Analyse a recorder dump (v1 or v2) into stalls, owners, gestures, slow interactions and a reproduce block.
//   node tools/live/stress/analyse.mjs <dump.json> [--wheel <recw.json>] [--json <out.json>] [--top 25]
//   node tools/live/stress/analyse.mjs --selftest
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";

// ---- small stats
const sorted = (a) => [...a].sort((x, y) => x - y);
export const pct = (a, p) => { if (!a.length) return null; const s = sorted(a); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
export const median = (a) => pct(a, 0.5);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const max = (a) => (a.length ? Math.max(...a) : null);
const r0 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x));
const r1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 100) / 100);

// ---- definitions
export function bandOf(z) {
  if (z == null || Number.isNaN(z)) return "no board";
  if (z < 0.2) return "map";
  if (z < 0.6) return "overview";
  if (z < 0.9) return "small";
  if (z < 1.3) return "reading";
  return "close";
}
const BANDS = ["map", "overview", "small", "reading", "close", "no board"];
const bandIdx = (b) => BANDS.indexOf(b);

// dupes: names shared by two different blob urls get the last 4 url chars so two extensions are not merged
export function ownerOf(url, names = {}, dupes = null) {
  if (!url) return "(native)";
  if (!url.startsWith("blob:") && url.includes("roamresearch.com")) return "Roam"; // scriptNames hints are unreliable for Roam's own files
  if (url.startsWith("blob:")) {
    const n = names[url] && names[url].name;
    if (n && n !== "?") { const o = n === "plexus-diagram" ? "Plexus" : n; return dupes && dupes.has(n) ? `${o}#${url.slice(-4)}` : o; }
    return "ext:" + url.slice(-6);
  }
  try { return new URL(url).hostname || "other"; } catch { return "other"; }
}

// one stall: script ms and forced ms per owner, render (style/layout/paint at frame end), rest
export function splitStall(f, names = {}, dupes = null) {
  const script = {}, forced = {};
  let sd = 0;
  for (const s of f.s || []) {
    const o = ownerOf(s.u, names, dupes);
    script[o] = (script[o] || 0) + (s.d - (s.f || 0));
    forced[o] = (forced[o] || 0) + (s.f || 0);
    sd += s.d;
  }
  const render = f.sl || 0;
  return { script, forced, render, rest: Math.max(0, f.d - sd - render) };
}

const evClass = (n) => (/^(click|dblclick|auxclick|contextmenu)$/.test(n) ? "click" : /^key/.test(n) ? "key" : /^(pointer|mouse|touch)/.test(n) ? "pointer" : null);

// ---- normalise input logs to times relative to the dump's recorder t0
function normalise(dump, wheel) {
  let w = dump.wheel, cam = dump.cams, k = dump.keys, p = dump.ptr, off = null, alignment = "none";
  if (dump.fmt >= 2 && w) { off = dump.t0 || 0; alignment = "recorder t0"; }
  else if (wheel) {
    w = wheel.w || []; cam = wheel.cam || []; k = wheel.k || []; p = wheel.p || [];
    // both recorders stamped their install with Date.now() and performance.now(): the dump's t0 on the page clock is recw.t0 + (dump.wall - recw.wall)
    off = wheel.t0 + (dump.wall - wheel.wall); alignment = "wall clocks";
    const shifted = (o) => w.filter((r) => r[3] !== undefined).map((r) => r[0] - o);
    const starts = []; let lastT = -1e9;
    for (const t of sorted(shifted(off))) { if (t - lastT > 180) starts.push(t); lastT = t; }
    const gs = (dump.gest || []).filter((g) => g.kind === "pan" || g.kind === "zoom");
    const nearest = (g) => { let best = null; for (const s of starts) if (best == null || Math.abs(s - g.st) < Math.abs(best - g.st)) best = s; return best == null ? null : best - g.st; };
    const res = gs.map(nearest).filter((x) => x != null);
    const m = res.length ? median(res) : null;
    if (res.length >= 3 && Math.abs(median(res)) > 1500) { off = off + median(res); alignment = `gesture match (wall clocks were ${r0(m)} ms off)`; }
    else if (res.length < 3) alignment = "wall clocks (too few gestures to verify)";
    else alignment = "wall clocks (verified against gestures)";
  } else { w = []; cam = []; k = []; p = []; off = 0; alignment = "no wheel log"; }
  const rel = (t) => Math.round(t - off);
  return {
    alignment,
    wheel: (w || []).map((r) => ({ t: rel(r[0]), delay: r[1], dx: r[2], dy: r[3], mods: r[4], mode: r[5] })),
    cams: (cam || []).map((r) => ({ t: rel(r[0]), why: r[1], x: r[2], y: r[3], z: r[4], b: r[5], lod: r[6] })),
    keys: (k || []).map((r) => ({ t: rel(r[0]), delay: r[1], inb: r[2], ed: r[3], c: r[4] })),
    ptr: (p || []).map((r) => ({ t: rel(r[0]), delay: r[1], x1: r[2], y1: r[3], x2: r[4], y2: r[5], dur: r[6], m: r[7], k: r[8], inb: r[9], btn: r[10], mods: r[11] })),
  };
}

const zOf = (c) => (c && c.z != null ? c.z : null);
const gBand = (g) => bandOf(zOf(g.c0) != null ? zOf(g.c0) : zOf(g.c1));

export function analyse(dump, { wheel } = {}) {
  const names = dump.scriptNames || {};
  const byName = {};
  for (const [u, v] of Object.entries(names)) if (u.startsWith("blob:") && v && v.name && v.name !== "?") (byName[v.name] = byName[v.name] || new Set()).add(u);
  const dupes = new Set(Object.entries(byName).filter(([, us]) => us.size > 1).map(([n]) => n));
  const N = normalise(dump, wheel);
  const secs = dump.secs || 0;
  const gest = [...(dump.gest || [])].sort((a, b) => a.st - b.st);
  const loaf = dump.loaf || [];
  const evs = dump.ev || [];

  // ---- stalls with context, band, owner split
  const inputStarts = [
    ...evs.map((e) => ({ t: e.st, c: evClass(e.n) })).filter((x) => x.c),
    ...N.keys.map((k) => ({ t: k.t, c: "key" })),
    ...N.ptr.map((p) => ({ t: p.t, c: p.m === -2 ? "click" : "pointer" })),
  ];
  const stalls = loaf.map((f) => {
    const endT = f.st + f.d;
    let context = f.g || null;
    if (!context) {
      let best = null;
      for (const i of inputStarts) if (i.t <= endT && i.t >= endT - 400 && (!best || i.t > best.t)) best = i;
      context = best ? best.c : "idle";
    }
    const z = zOf(f.c);
    return { st: f.st, d: f.d, context, z, band: bandOf(z), split: splitStall(f, names, dupes), f };
  });

  // join stalls to gestures: a stall whose st lies in [g.st, g.en + 250]; the latest such gesture wins
  const gInfo = gest.map((g) => ({ g, band: gBand(g), stalls: [] }));
  for (const s of stalls) {
    let hit = null;
    for (const gi of gInfo) if (s.st >= gi.g.st && s.st <= gi.g.en + 250) hit = gi;
    if (hit) hit.stalls.push(s);
  }

  const group = (list, keyFn) => { const o = {}; for (const x of list) { const k = keyFn(x); (o[k] = o[k] || []).push(x); } return o; };
  const sumStalls = (l) => ({ n: l.length, ms: sum(l.map((s) => s.d)), worst: max(l.map((s) => s.d)) || 0 });
  const byContext = {}, byBand = {}, byContextBand = {};
  for (const [k, l] of Object.entries(group(stalls, (s) => s.context))) byContext[k] = sumStalls(l);
  for (const [k, l] of Object.entries(group(stalls, (s) => s.band))) byBand[k] = sumStalls(l);
  for (const [k, l] of Object.entries(group(stalls, (s) => s.context + "|" + s.band))) byContextBand[k] = sumStalls(l);

  const ownerTable = (l) => {
    const by = {}; let render = 0, rest = 0;
    for (const s of l) {
      for (const [o, v] of Object.entries(s.split.script)) (by[o] = by[o] || { script: 0, forced: 0 }).script += v;
      for (const [o, v] of Object.entries(s.split.forced)) (by[o] = by[o] || { script: 0, forced: 0 }).forced += v;
      render += s.split.render; rest += s.split.rest;
    }
    return { by, render, rest, total: sum(l.map((s) => s.d)) };
  };
  const owners = { all: ownerTable(stalls), byContext: {} };
  for (const [k, l] of Object.entries(group(stalls, (s) => s.context))) owners.byContext[k] = ownerTable(l);

  // ---- wheel rows assigned to gestures
  const gw = gInfo.map((gi) => {
    const { g } = gi;
    const rows = (g.kind === "pan" || g.kind === "zoom") ? N.wheel.filter((r) => r.t >= g.st - 20 && r.t <= g.en) : [];
    let span = null, camMove = null, zoomRatio = null;
    if (rows.length) {
      const t0 = rows[0].t, t1 = rows[rows.length - 1].t; span = Math.max(t1 - t0, 50);
      const before = [...N.cams].filter((c) => c.t <= t0 + 5).pop();
      const after = N.cams.find((c) => c.t >= t1 && c.t !== (before && before.t));
      if (before && after) { camMove = Math.hypot(after.x - before.x, after.y - before.y); zoomRatio = before.z ? after.z / before.z : null; }
    }
    return { gi, rows, span, camMove, zoomRatio };
  });

  // ---- gestures by kind x band
  const gestures = {};
  const cardsAfter = (list) => {
    const out = {};
    const ats = [...new Set(list.flatMap((gi) => (gi.g.cards || []).map((c) => c.at)))].sort((a, b) => a - b);
    for (const at of ats) {
      const cs = list.map((gi) => (gi.g.cards || []).find((c) => c.at === at)).filter(Boolean);
      out[at] = { n: cs.length, empty: r1(median(cs.map((c) => c.empty || 0))), preview: r1(median(cs.map((c) => c.preview || 0))), live: r1(median(cs.map((c) => c.live || 0))), anyEmptyShare: cs.length ? r2(cs.filter((c) => (c.empty || 0) + (c.missing || 0) > 0).length / cs.length) : null };
    }
    return out;
  };
  for (const [key, list] of Object.entries(group(gInfo, (gi) => gi.g.kind + "|" + gi.band))) {
    const frames = sum(list.map((gi) => gi.g.fr.n));
    const st = list.flatMap((gi) => gi.stalls);
    gestures[key] = {
      n: list.length, seconds: r1(sum(list.map((gi) => gi.g.en - gi.g.st)) / 1000), frames,
      over17: frames ? r1(100 * sum(list.map((gi) => gi.g.fr.o17)) / frames) : null,
      over34: frames ? r1(100 * sum(list.map((gi) => gi.g.fr.o34)) / frames) : null,
      over50: frames ? r1(100 * sum(list.map((gi) => gi.g.fr.o50)) / frames) : null,
      worstFrame: r0(max(list.map((gi) => gi.g.fr.max))), worstFrameP50: r0(median(list.map((gi) => gi.g.fr.max))),
      stalls: st.length, stallMs: sum(st.map((s) => s.d)), cards: cardsAfter(list),
    };
  }

  // ---- slow interactions
  const events = {};
  for (const [k, l] of Object.entries(group(evs, (e) => `${e.n}|${e.tg || "-"}|${e.inb ? "board" : "page"}`))) {
    const d = l.map((e) => e.d);
    events[k] = { n: l.length, p50: r0(median(d)), p95: r0(pct(d, 0.95)), max: r0(max(d)), delay: r1(mean(l.map((e) => e.delay))), proc: r1(mean(l.map((e) => e.proc))), present: r1(mean(l.map((e) => e.d - e.delay - e.proc))) };
  }

  // ---- wheel / keys / pointer
  const hasWheel = N.wheel.length || N.keys.length || N.ptr.length;
  const wheelRes = { present: !!hasWheel, alignment: N.alignment, kinds: {}, keys: null, drags: null };
  if (hasWheel) {
    for (const kind of ["pan", "zoom"]) {
      const gs = gw.filter((x) => x.gi.g.kind === kind && x.rows.length);
      const rows = gs.flatMap((x) => x.rows);
      const eps = gs.filter((x) => x.span).map((x) => x.rows.length / (x.span / 1000));
      const dl = rows.map((r) => (kind === "zoom" ? Math.abs(r.dy) : Math.hypot(r.dx, r.dy)));
      const speeds = gs.filter((x) => x.camMove != null && x.span).map((x) => x.camMove / (x.span / 1000));
      const ratios = gs.filter((x) => x.zoomRatio).map((x) => x.zoomRatio);
      const delays = rows.map((r) => r.delay);
      wheelRes.kinds[kind] = {
        gestures: gs.length, events: rows.length, eventsPerSec: r1(median(eps)), medianDelta: r1(median(dl)), maxDelta: r1(max(dl)),
        panSpeed: kind === "pan" ? r0(median(speeds)) : null, zoomRatio: kind === "zoom" ? r2(median(ratios)) : null,
        delayP50: r0(median(delays)), delayP95: r0(pct(delays, 0.95)), delayMax: r0(max(delays)),
      };
    }
    const kc = {};
    for (const k of N.keys) kc[k.c] = (kc[k.c] || 0) + 1;
    const kd = N.keys.map((k) => k.delay);
    wheelRes.keys = { n: N.keys.length, byClass: kc, inBoard: N.keys.filter((k) => k.inb).length, inEditor: N.keys.filter((k) => k.ed).length, delayP50: r0(median(kd)), delayP95: r0(pct(kd, 0.95)), delayMax: r0(max(kd)) };
    const drags = {};
    for (const p of N.ptr) {
      if (p.m === -2) continue;
      const dist = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
      const kind = dist > 6 ? "drag" : "click";
      const o = (drags[`${kind}|${p.k || "-"}`] = drags[`${kind}|${p.k || "-"}`] || { dist: [], dur: [] });
      o.dist.push(dist); o.dur.push(p.dur);
    }
    wheelRes.drags = Object.fromEntries(Object.entries(drags).map(([k, o]) => [k, { n: o.dist.length, distP50: r0(median(o.dist)), distMax: r0(max(o.dist)), durP50: r0(median(o.dur)), durMax: r0(max(o.dur)) }]));
  }

  // ---- presses and clicks (in board)
  const p90 = (a) => r0(pct(a, 0.9));
  const PRESS = new Set(["pointerdown", "pointerup", "click", "dblclick", "keydown"]);
  const tcls = (e) => (e.tg ? e.tg.split(":")[0] : "-");
  const pressRow = (event, target, band, l) => { const d = l.map((e) => e.d); return { event, target, band, n: l.length, p50: r0(median(d)), p90: p90(d), max: r0(max(d)), delay: r1(mean(l.map((e) => e.delay))), proc: r1(mean(l.map((e) => e.proc))), present: r1(mean(l.map((e) => e.d - e.delay - e.proc))) }; };
  const pe = evs.filter((e) => PRESS.has(e.n) && e.inb);
  const byScore = (a, b) => b.n * b.p50 - a.n * a.p50;
  const pressBand = Object.values(group(pe, (e) => `${e.n}|${tcls(e)}|${bandOf(e.z)}`)).map((l) => pressRow(l[0].n, tcls(l[0]), bandOf(l[0].z), l)).sort(byScore);
  const pressAll = Object.values(group(pe, (e) => `${e.n}|${tcls(e)}`)).map((l) => pressRow(l[0].n, tcls(l[0]), "all", l)).sort(byScore);
  const presses = pressBand.concat(pressAll);

  // ---- hover: several rows from one mouse move are one moment (st within 4 ms of the previous row)
  const HOVER = new Set(["pointerover", "pointerout", "pointerenter", "pointerleave", "mouseover", "mouseout", "mouseenter", "mouseleave"]);
  const hv = evs.filter((e) => HOVER.has(e.n)).sort((a, b) => a.st - b.st);
  const moments = [];
  for (const e of hv) {
    const m = moments[moments.length - 1];
    if (m && e.st - m.last <= 4) { m.d = Math.max(m.d, e.d); m.inb = m.inb || !!e.inb; m.last = e.st; if (!m.tg && /over$/.test(e.n)) m.tg = e.tg; if (m.z == null) m.z = e.z; }
    else moments.push({ d: e.d, inb: !!e.inb, last: e.st, tg: /over$/.test(e.n) ? e.tg : null, z: e.z });
  }
  const hvRow = (l) => { const d = l.map((m) => m.d); return { n: l.length, p50: r0(median(d)), p90: p90(d), max: r0(max(d)), over100: d.filter((x) => x > 100).length }; };
  const hover = Object.values(group(moments, (m) => `${bandOf(m.z)}|${m.inb ? "board" : "page"}`)).map((l) => ({ band: bandOf(l[0].z), where: l[0].inb ? "board" : "page", ...hvRow(l) })).sort((a, b) => bandIdx(a.band) - bandIdx(b.band) || (a.where < b.where ? -1 : 1));
  const hoverRes = { rows: hover, total: hvRow(moments) };

  // ---- tail: idle stalls within 6 s after a drag gesture or a pointer row on an item, port or edge
  const anchors = [...gest.filter((g) => g.kind === "drag").map((g) => g.en), ...N.ptr.filter((p) => /^pxd-(item|port|edge)/.test(p.k || "") && p.m !== -2).map((p) => p.t + (p.dur || 0))];
  const tailStalls = stalls.filter((s) => s.context === "idle" && anchors.some((t) => s.st >= t && s.st <= t + 6000));
  const tail = sumStalls(tailStalls);

  // ---- worst stalls
  const worst = [...stalls].sort((a, b) => b.d - a.d).map((s) => ({
    t: s.st, d: s.d, bl: s.f.bl || 0, sl: s.f.sl || 0, rest: Math.max(0, s.d - sum((s.f.s || []).map((x) => x.d)) - (s.f.sl || 0)), context: s.context, z: s.z, band: s.band,
    top: [...(s.f.s || [])].sort((a, b) => b.d - a.d).slice(0, 3).map((x) => `${ownerOf(x.u, names, dupes)} ${x.fn || "(anon)"} (${x.inv || x.it || ""}) ${x.d}`),
  }));

  // ---- memory, plexus
  const sm = dump.samples || [];
  const span = (a) => (a.length ? { first: a[0], last: a[a.length - 1], min: Math.min(...a), max: Math.max(...a) } : null);
  const memory = { heapMB: span(sm.map((s) => s.heap).filter((x) => x != null)), elements: span(sm.map((s) => s.els).filter((x) => x != null)) };
  const jobs = {};
  for (const t of dump.plexusLongTasks || []) for (const j of t.jobs || []) { const o = (jobs[j.name] = jobs[j.name] || { n: 0, ms: 0 }); o.n++; o.ms += j.ms; }
  const mounts = {};
  for (const m of dump.slowMounts || []) { const o = (mounts[m.kind] = mounts[m.kind] || { n: 0, ms: 0, max: 0 }); o.n++; o.ms += m.ms; o.max = Math.max(o.max, m.ms); }
  const plexus = { longTasks: (dump.plexusLongTasks || []).length, jobs, slowMounts: mounts, bgOverruns: Array.isArray(dump.bgOverruns) ? dump.bgOverruns.length : (dump.bgOverruns || null) };

  // ---- reproduce block
  const reproduce = {};
  for (const [key, gv] of Object.entries(gestures)) {
    const [kind, band] = key.split("|");
    const mins = gv.seconds / 60;
    const rows = gw.filter((x) => x.gi.g.kind === kind && x.gi.band === band && x.rows.length);
    const eps = rows.filter((x) => x.span).map((x) => x.rows.length / (x.span / 1000));
    const dl = rows.flatMap((x) => x.rows).map((r) => (kind === "zoom" ? Math.abs(r.dy) : Math.hypot(r.dx, r.dy)));
    reproduce[key] = {
      gestures: gv.n, seconds: gv.seconds,
      stallsPerMin: mins ? r1(gv.stalls / mins) : null, stallMsPerMin: mins ? r0(gv.stallMs / mins) : null,
      worstFrameP50: gv.worstFrameP50, worstFrameMax: gv.worstFrame, pctOver34: gv.over34,
      eventsPerSec: eps.length ? r1(median(eps)) : null, medianDelta: dl.length ? r1(median(dl)) : null,
      emptyAt200Share: gv.cards[200] ? gv.cards[200].anyEmptyShare : null,
    };
  }
  reproduce.presses = {};
  for (const r of pressBand) if (r.n >= 3) reproduce.presses[`${r.event}|${r.target}|${r.band}`] = { n: r.n, p50: r.p50, p90: r.p90, max: r.max };
  reproduce.hover = {};
  for (const [band, l] of Object.entries(group(moments.filter((m) => m.inb), (m) => bandOf(m.z)))) { const h = hvRow(l); reproduce.hover[band] = { n: h.n, p50: h.p50, p90: h.p90, over100: h.over100 }; }
  reproduce.tail = tail;

  const gSecs = sum(gest.map((g) => g.en - g.st)) / 1000;
  const session = {
    secs, version: dump.version || null, title: dump.title || null, inner: dump.inner || null, dpr: dump.dpr || null, fmt: dump.fmt || 1,
    counts: { loaf: loaf.length, ev: evs.length, gest: gest.length, wheel: N.wheel.length, keys: N.keys.length, ptr: N.ptr.length, drop: dump.drop || 0 },
    gestureSecs: r1(gSecs), gestureShare: secs ? r2(gSecs / secs) : null,
  };
  const st = sumStalls(stalls);
  return {
    session,
    stalls: { n: st.n, ms: st.ms, worst: st.worst, perMin: secs ? r1(st.n / (secs / 60)) : null },
    byContext, byBand, byContextBand, owners, presses, hover: hoverRes, gestures, events, wheel: wheelRes,
    worst, memory, plexus, reproduce,
  };
}

// ---- Markdown
const cell = (x) => (x == null ? "-" : typeof x === "number" ? String(Math.round(x * 100) / 100) : String(x));
function table(head, rows) {
  if (!rows.length) return "_none_\n";
  return `| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|\n` + rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n") + "\n";
}
const ownerRows = (o) => Object.entries(o.by).sort((a, b) => b[1].script + b[1].forced - (a[1].script + a[1].forced)).map(([k, v]) => [k, r0(v.script), r0(v.forced)])
  .concat([["(render: style, layout, paint)", r0(o.render), "-"], ["(rest)", r0(o.rest), "-"], ["total stall ms", r0(o.total), "-"]]);

export function renderMarkdown(r, { top = 25 } = {}) {
  const out = [];
  const s = r.session;
  out.push("# Recorder analysis\n");
  out.push("## 1. Session\n");
  out.push(table(["field", "value"], [["seconds", s.secs], ["version", s.version], ["window", `${s.title || "-"} ${s.inner ? s.inner.join("x") : ""} dpr ${cell(s.dpr)}`], ["format", s.fmt], ["counts", Object.entries(s.counts).map(([k, v]) => `${k} ${v}`).join(", ")], ["time in gestures", `${s.gestureSecs} s (${s.gestureShare == null ? "-" : Math.round(s.gestureShare * 100) + "%"})`]]));
  out.push("## 2. Stalls\n");
  out.push(`${r.stalls.n} stalls, ${r.stalls.ms} ms total, worst ${r.stalls.worst} ms, ${cell(r.stalls.perMin)} per minute.\n`);
  const sRows = (o, keyOrder) => Object.entries(o).sort(keyOrder).map(([k, v]) => [k, v.n, v.ms, v.worst]);
  out.push("By context\n\n" + table(["context", "n", "ms", "worst"], sRows(r.byContext, (a, b) => b[1].ms - a[1].ms)));
  out.push("By zoom band\n\n" + table(["band", "n", "ms", "worst"], sRows(r.byBand, (a, b) => bandIdx(a[0]) - bandIdx(b[0]))));
  out.push("By context x band\n\n" + table(["context | band", "n", "ms", "worst"], sRows(r.byContextBand, (a, b) => b[1].ms - a[1].ms)));
  out.push("Owners, all stalls (ms)\n\n" + table(["owner", "script", "forced"], ownerRows(r.owners.all)));
  for (const [c, o] of Object.entries(r.owners.byContext)) out.push(`Owners, context ${c}\n\n` + table(["owner", "script", "forced"], ownerRows(o)));
  out.push("## 3. Presses and clicks (in board)\n");
  const prow = (p) => [p.event, p.target, p.band, p.n, p.p50, p.p90, p.max, p.delay, p.proc, p.present];
  const phead = ["event", "target", "band", "n", "p50", "p90", "max", "input delay", "handlers", "presentation"];
  out.push(table(phead, r.presses.filter((p) => p.band !== "all").map(prow)));
  out.push("All bands\n\n" + table(phead, r.presses.filter((p) => p.band === "all").map(prow)));
  out.push("## 4. Hover\n");
  out.push(`${r.hover.total.n} hover moments, p50 ${cell(r.hover.total.p50)}, p90 ${cell(r.hover.total.p90)}, max ${cell(r.hover.total.max)}, over 100 ms: ${r.hover.total.over100}.\n`);
  out.push(table(["band", "where", "moments", "p50", "p90", "max", ">100 ms"], r.hover.rows.map((h) => [h.band, h.where, h.n, h.p50, h.p90, h.max, h.over100])));
  out.push("## 5. Gestures\n");
  out.push(table(["kind | band", "n", "s", "frames", ">17 %", ">34 %", ">50 %", "worst frame", "stalls", "stall ms"], Object.entries(r.gestures).sort().map(([k, v]) => [k, v.n, v.seconds, v.frames, v.over17, v.over34, v.over50, v.worstFrame, v.stalls, v.stallMs])));
  const cardRows = [];
  for (const [k, v] of Object.entries(r.gestures).sort()) for (const [at, c] of Object.entries(v.cards)) cardRows.push([k, at + " ms", c.n, c.empty, c.preview, c.live, c.anyEmptyShare]);
  out.push("Card states after the gesture end (median per gesture)\n\n" + table(["kind | band", "after", "gestures", "empty", "preview", "live", "share with empty or missing"], cardRows));
  out.push("## 6. Slow interactions\n");
  out.push(table(["event | target | where", "n", "p50", "p95", "max", "input delay", "handlers", "presentation"], Object.entries(r.events).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, v.n, v.p50, v.p95, v.max, v.delay, v.proc, v.present])));
  out.push("## 7. Wheel, keys, pointer\n");
  if (!r.wheel.present) out.push("_no wheel log (dump has no wheel rows and no --wheel file)_\n");
  else {
    out.push(`Alignment: ${r.wheel.alignment}\n`);
    out.push(table(["kind", "gestures", "events", "events/s", "median delta", "max delta", "pan px/s", "zoom ratio", "delay p50", "delay p95", "delay max"], Object.entries(r.wheel.kinds).map(([k, v]) => [k, v.gestures, v.events, v.eventsPerSec, v.medianDelta, v.maxDelta, v.panSpeed, v.zoomRatio, v.delayP50, v.delayP95, v.delayMax])));
    const k = r.wheel.keys;
    out.push(`Keys: ${k.n} (in board ${k.inBoard}, in editor ${k.inEditor}), input delay p50 ${cell(k.delayP50)} p95 ${cell(k.delayP95)} max ${cell(k.delayMax)}\n\n` + table(["class", "n"], Object.entries(k.byClass).sort((a, b) => b[1] - a[1])));
    out.push("Pointer\n\n" + table(["kind | target", "n", "dist p50", "dist max", "ms p50", "ms max"], Object.entries(r.wheel.drags).map(([a, v]) => [a, v.n, v.distP50, v.distMax, v.durP50, v.durMax])));
  }
  out.push(`## 8. Worst stalls (top ${top})\n`);
  out.push(table(["t ms", "ms", "bl", "sl", "rest", "context", "zoom", "band", "top scripts (owner fn (invoker) ms)"], r.worst.slice(0, top).map((w) => [w.t, w.d, w.bl, w.sl, w.rest, w.context, w.z, w.band, w.top.join("; ")])));
  out.push("## 9. Memory\n");
  const mrow = (n, m) => (m ? [n, m.first, m.last, m.min, m.max] : [n, "-", "-", "-", "-"]);
  out.push(table(["series", "first", "last", "min", "max"], [mrow("heap MB", r.memory.heapMB), mrow("elements", r.memory.elements)]));
  out.push("## 10. Plexus jobs\n");
  out.push(`Long tasks logged by Plexus: ${r.plexus.longTasks}; background overruns: ${cell(r.plexus.bgOverruns)}\n\n` + table(["job", "n", "ms"], Object.entries(r.plexus.jobs).sort((a, b) => b[1].ms - a[1].ms).map(([k, v]) => [k, v.n, r0(v.ms)])));
  out.push("Slow mounts\n\n" + table(["kind", "n", "ms", "max"], Object.entries(r.plexus.slowMounts).map(([k, v]) => [k, v.n, r0(v.ms), r0(v.max)])));
  return out.join("\n");
}

// ---- selftest
function selftest() {
  assert.equal(bandOf(null), "no board");
  assert.equal(bandOf(0.19), "map"); assert.equal(bandOf(0.2), "overview"); assert.equal(bandOf(0.6), "small");
  assert.equal(bandOf(0.9), "reading"); assert.equal(bandOf(1.29), "reading"); assert.equal(bandOf(1.3), "close");
  const names = { "blob:https://app/aaaabbbb": { name: "plexus-diagram" } };
  assert.equal(ownerOf("blob:https://app/aaaabbbb", names), "Plexus");
  assert.equal(ownerOf("blob:https://app/zzzzzz123456", names), "ext:123456");
  assert.equal(ownerOf("https://roamresearch.com/js/main.js", { "https://roamresearch.com/js/main.js": { name: "excalidraw" } }), "Roam");
  assert.equal(ownerOf("blob:https://app/q1q1q1w2w2", { "blob:https://app/q1q1q1w2w2": { name: "pdf" } }, new Set(["pdf"])), "pdf#w2w2");
  assert.equal(ownerOf("", names), "(native)");
  const plexusUrl = "blob:https://app/aaaabbbb";
  const L1 = { st: 1000, d: 200, bl: 150, rn: 60, sl: 50, g: "pan", c: { z: 0.1, lod: "map" }, s: [{ d: 100, f: 20, u: plexusUrl, fn: "paint", inv: "raf" }, { d: 30, f: 10, u: "https://roamresearch.com/js/main.js", fn: "x", inv: "y" }, { d: 10, f: 0, u: "" }] };
  const L2 = { st: 5000, d: 60, bl: 20, rn: 0, sl: 5, g: null, c: { z: 1.0 }, s: [] };
  const L3 = { st: 9000, d: 70, bl: 20, rn: 0, sl: 0, g: null, c: null, s: [] };
  const fr = { n: 40, o17: 8, o34: 4, o50: 2, max: 120 };
  const gP = { kind: "pan", st: 900, en: 1500, n: 30, c0: { z: 0.1 }, c1: { z: 0.1 }, fr, hitch: [], tgt: "pxd-root", cards: [{ at: 200, n: 10, missing: 1, empty: 0, preview: 4, live: 5, other: 0 }, { at: 500, n: 10, missing: 0, empty: 0, preview: 3, live: 7, other: 0 }] };
  const v1 = { secs: 120, wall: 1_000_000, version: "3.39.1", dpr: 2, inner: [1400, 900], loaf: [L1, L2, L3], ev: [{ n: "click", st: 4800, d: 80, delay: 10, proc: 40, tg: "pxd-item:card", inb: true, ed: false, z: 1 }], gest: [gP], samples: [{ t: 0, heap: 100, els: 5000 }, { t: 20000, heap: 140, els: 7000 }], marks: [], drop: 0, scriptNames: names, plexusLongTasks: [{ start: 1, ms: 120, jobs: [{ name: "slice", ms: 100 }] }], slowMounts: [{ uid: "a", kind: "table", ms: 80, at: 1 }] };
  const a = analyse(v1);
  const sp = splitStall(L1, names);
  assert.deepEqual(sp, { script: { Plexus: 80, Roam: 20, "(native)": 10 }, forced: { Plexus: 20, Roam: 10, "(native)": 0 }, render: 50, rest: 10 });
  assert.equal(a.stalls.n, 3); assert.equal(a.stalls.ms, 330); assert.equal(a.stalls.worst, 200);
  assert.equal(a.byContext.pan.n, 1); assert.equal(a.byContext.click.n, 1); assert.equal(a.byContext.idle.n, 1);
  assert.equal(a.byBand.map.n, 1); assert.equal(a.byBand.reading.n, 1); assert.equal(a.byBand["no board"].n, 1);
  assert.equal(a.owners.all.by.Plexus.script, 80); assert.equal(a.owners.all.render, 55); // 50 + 5
  assert.equal(a.gestures["pan|map"].stalls, 1); assert.equal(a.gestures["pan|map"].stallMs, 200);
  assert.equal(a.reproduce["pan|map"].emptyAt200Share, 1); // one missing card at 200 ms
  assert.equal(a.gestures["pan|map"].cards[500].anyEmptyShare, 0);
  assert.equal(a.wheel.present, false);
  assert.equal(a.memory.heapMB.max, 140);
  assert.ok(renderMarkdown(a).includes("## 8. Worst stalls"));
  // v1 dump joined with a separate wheel log: dump wall is 500 ms after the wheel log's wall, so the dump's t0 on the page clock is 50000 + 500
  const recw = { t0: 50000, wall: 2_000_000 - 500, w: [[50000 + 500 + 910, 3, 10, 40, 0, 0], [50000 + 500 + 950, 4, 10, 40, 0, 0]], cam: [[50000 + 500 + 905, "s", -100, -100, 0.1, "b", "map"], [50000 + 500 + 1200, "e", -140, -220, 0.1, "b", "map"]], k: [], p: [] };
  const v1b = { ...v1, wall: 2_000_000 };
  const b = analyse(v1b, { wheel: recw });
  assert.equal(b.wheel.kinds.pan.events, 2); assert.equal(b.wheel.kinds.pan.gestures, 1);
  assert.match(b.wheel.alignment, /^wall clocks/);
  assert.equal(b.wheel.kinds.pan.medianDelta, r1(Math.hypot(10, 40)));
  assert.equal(b.wheel.kinds.pan.panSpeed, Math.round(Math.hypot(40, 120) / 0.05));
  // v2 dump: rows on the page clock, relative to t0
  const t0 = 7000;
  const v2 = { ...v1, fmt: 2, t0, wheel: [[t0 + 910, 5, 0, 40, 0, 0], [t0 + 960, 6, 0, 40, 0, 0], [t0 + 1000, 40, 0, -20, 2, 0]], cams: [[t0 + 905, "s", 0, 0, 0.1, "b", "map"], [t0 + 1300, "e", 0, -80, 0.1, "b", "map"]], keys: [[t0 + 5010, 4, 1, 1, "c"]], ptr: [[t0 + 4900, 2, 100, 100, 160, 100, 300, 12, "pxd-item", 1, 0, 0]] };
  const c = analyse(v2);
  assert.equal(c.session.counts.wheel, 3); assert.equal(c.wheel.alignment, "recorder t0");
  assert.equal(c.wheel.kinds.pan.events, 3); assert.equal(c.wheel.kinds.zoom.events, 0);
  assert.equal(c.wheel.keys.byClass.c, 1);
  assert.equal(c.wheel.drags["drag|pxd-item"].distP50, 60);
  assert.equal(c.byContext.key.n, 1); // the key (5010) started later than the click event (4800): nearest start wins
  assert.ok(renderMarkdown(c).includes("Alignment: recorder t0"));
  // items 4-7: presses, hover, tail, worst columns
  const evx = [
    { n: "pointerdown", st: 100, d: 120, delay: 20, proc: 60, tg: "pxd-item:card", inb: true, z: 0.5 },
    { n: "pointerdown", st: 300, d: 80, delay: 10, proc: 40, tg: "pxd-item:card", inb: true, z: 0.5 },
    { n: "pointerdown", st: 500, d: 100, delay: 0, proc: 0, tg: null, inb: true, z: 0.5 },
    { n: "pointerdown", st: 700, d: 99, delay: 0, proc: 0, tg: "page", inb: false, z: 0.5 },
    { n: "pointerover", st: 1000, d: 50, tg: "pxd-edge", inb: true, z: 1 }, { n: "mouseover", st: 1002, d: 150, tg: "pxd-item:card", inb: true, z: 1 }, { n: "pointerout", st: 1003, d: 10, tg: "page", inb: false, z: 1 },
    { n: "mouseout", st: 2000, d: 60, tg: "page", inb: false, z: 1 },
  ];
  const v3 = { secs: 60, wall: 0, loaf: [{ st: 10000, d: 90, bl: 70, sl: 20, g: null, c: { z: 1 }, s: [{ d: 30, f: 0, u: "" }] }, { st: 12000, d: 80, sl: 0, g: null, c: { z: 1 }, s: [] }, { st: 30000, d: 70, sl: 0, g: null, c: { z: 1 }, s: [] }], ev: evx, gest: [{ kind: "drag", st: 9000, en: 9500, n: 5, c0: { z: 1 }, c1: { z: 1 }, fr, hitch: [], cards: [] }], samples: [] };
  const d = analyse(v3);
  const row = (e, t, b) => d.presses.find((p) => p.event === e && p.target === t && p.band === b);
  assert.equal(row("pointerdown", "pxd-item", "overview").n, 2); assert.equal(row("pointerdown", "pxd-item", "overview").p50, 120);
  assert.equal(row("pointerdown", "-", "all").n, 1); assert.equal(d.presses.filter((p) => p.event === "pointerdown" && p.band === "all").length, 2);
  assert.equal(d.presses.filter((p) => p.band !== "all")[0].target, "pxd-item"); // sorted by n * p50
  assert.deepEqual(d.hover.total, { n: 2, p50: 150, p90: 150, max: 150, over100: 1 });
  assert.equal(d.hover.rows.find((h) => h.where === "board").n, 1);
  assert.equal(d.reproduce.hover.reading.n, 1); assert.deepEqual(d.reproduce.presses, {});
  assert.deepEqual(d.reproduce.tail, { n: 2, ms: 170, worst: 90 }); // 30000 is more than 6 s after the drag
  assert.deepEqual([d.worst[0].bl, d.worst[0].sl, d.worst[0].rest], [70, 20, 40]);
  assert.ok(renderMarkdown(d).includes("## 3. Presses and clicks"));
  console.log("selftest ok");
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) { selftest(); return; }
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const file = argv.find((a, i) => !a.startsWith("--") && !["--wheel", "--json", "--top"].includes(argv[i - 1]));
  if (!file) { console.error("usage: analyse.mjs <dump.json> [--wheel <recw.json>] [--json <out.json>] [--top 25] | --selftest"); process.exit(2); }
  const dump = JSON.parse(readFileSync(file, "utf8"));
  const wf = flag("--wheel");
  const result = analyse(dump, { wheel: wf ? JSON.parse(readFileSync(wf, "utf8")) : undefined });
  const jf = flag("--json");
  if (jf) writeFileSync(jf, JSON.stringify(result, null, 1));
  console.log(renderMarkdown(result, { top: Number(flag("--top") || 25) }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
