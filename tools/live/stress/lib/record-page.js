// Passive real-use recorder v2 (page script). Evaluated by record.mjs; returns a JSON string. Idempotent.
// Observers and capture/passive listeners only: it never writes, dispatches, or focuses anything.
// Row layouts (times are performance.now() values of the page, i.e. the same clock as S.t0):
//   wheel [timeStamp, inputDelay, deltaX, deltaY, mods(1 ctrl, 2 meta, 4 shift), deltaMode]
//   cams  [t, why("start","s" wheel start,"e" wheel end,"pd","pu","g" gesture end), x, y, zoom, board, lod]
//   keys  [timeStamp, inputDelay, inBoard(0/1), isEditor(0/1), class]  class: "c" (a character: never which), a control key name, "mod+<key>", or "o"
//   ptr   [t, inputDelay, x1, y1, x2, y2, durMs, moves, targetKind, inBoard, button, mods(2 meta, 4 shift, 8 alt)]; a dblclick row has moves -2
(() => {
  if (window.__pxdRec && window.__pxdRec.on) return JSON.stringify({ already: true, since: Math.round((performance.now() - window.__pxdRec.t0) / 1000) });
  const now = () => performance.now();
  const S = window.__pxdRec = { fmt: 2, on: true, t0: now(), wall: Date.now(), loaf: [], ev: [], gest: [], samples: [], marks: [], wheel: [], cams: [], keys: [], ptr: [], drop: 0, off: [], timers: new Set() };
  const MAX = 80000;
  const safe = (fn) => (...a) => { try { return fn(...a); } catch (e) { S.err = String(e && e.message || e).slice(0, 120); } };
  const later = (fn, ms) => { const id = setTimeout(() => { S.timers.delete(id); safe(fn)(); }, ms); S.timers.add(id); return id; };
  const view = () => { try { const vs = window.__plexusDiagram && window.__plexusDiagram.views ? window.__plexusDiagram.views() : []; return vs.find((x) => x.root && x.root.isConnected && !x.root.hasAttribute("data-pxd-parked") && !x.root.hasAttribute("data-pxd-snap") && x.root.closest(".roam-article")) || null; } catch (e) { return null; } };
  const ctx = () => { try { const v = view(); if (!v) return null; let z = null, x = null, y = null; try { const q = v.viewport(); z = +q.zoom.toFixed(3); x = +q.x.toFixed(1); y = +q.y.toFixed(1); } catch (e) {} return { z, x, y, lod: v.root.getAttribute("data-pxd-lod"), b: v.root.getAttribute("data-board") }; } catch (e) { return null; } };
  const kindOf = (t) => { try { if (!t || t.nodeType !== 1) return ""; const h = t.closest(".pxd-port,.pxd-grip,.pxd-btn,.pxd-link,.pxd-edge,.pxd-item,.pxd-section,.pxd-root"); return h ? h.classList[0] : (t.closest("textarea, .rm-block__input") ? "roam-editor" : "page"); } catch (e) { return ""; } };
  const desc = (t) => { try { if (!t || t.nodeType !== 1) return null; const h = t.closest(".pxd-port,.pxd-grip,.pxd-btn,.pxd-link,.pxd-edge,.pxd-item,.pxd-section,.pxd-root"); const k = h ? h.classList[0] : (t.closest(".rm-block__input, textarea") ? "roam-editor" : (t.closest(".roam-sidebar-container, #right-sidebar") ? "sidebar" : "page")); const it = t.closest(".pxd-item"); return it ? k + ":" + (it.getAttribute("data-kind") || it.getAttribute("data-type") || "") : k; } catch (e) { return null; } };
  const inBoard = (t) => !!(t && t.nodeType === 1 && t.closest && t.closest(".pxd-root"));
  const isEd = (t) => !!(t && t.matches && t.matches("textarea, input, [contenteditable]"));
  const LIVE = ".pxd-rs, .pxd-item__page:not(.pxd-item__page--preview), .pxd-item__placeholder, .rm-block-main, .rm-block__input, img, canvas, .pxd-item__board, .pxd-item__query";
  // card states without forcing layout: world rects come from the snapshot source, no getBoundingClientRect
  const cards = () => {
    const v = view(); if (!v) return null;
    const src = v.snapshotSource && v.snapshotSource(); if (!src) return null;
    const cam = v.cameraRect(); const o = { n: 0, missing: 0, empty: 0, preview: 0, live: 0, other: 0 };
    for (const [uid, it] of src.board.items) {
      if (!it || it.type === "section") continue;
      const r = src.rects.get(uid); if (!r) continue;
      if (r.x + r.w < cam.x || r.x > cam.x + cam.w || r.y + r.h < cam.y || r.y > cam.y + cam.h) continue;
      o.n++;
      const shell = src.shellOf(uid); if (!shell || !shell.isConnected) { o.missing++; continue; }
      const body = shell.querySelector(".pxd-item__body"); if (!body) { o.other++; continue; }
      if (body.querySelector(".pxd-item__page--preview")) o.preview++; else if (body.querySelector(LIVE)) o.live++; else if (!body.children.length && !body.textContent.trim()) o.empty++; else o.other++;
    }
    return o;
  };
  const cam = (why) => { const v = view(); if (!v || S.cams.length >= MAX) return; const q = v.viewport(); S.cams.push([Math.round(now()), why, +q.x.toFixed(1), +q.y.toFixed(1), +q.zoom.toFixed(4), v.root.getAttribute("data-board") || "", v.root.getAttribute("data-pxd-lod") || ""]); };

  let g = null, gTimer = 0, raf = 0, last = 0;
  const frame = (ts) => { if (!g) { raf = 0; return; } if (last) { const d = ts - last; g.fr.n++; if (d > 17) g.fr.o17++; if (d > 34) { g.fr.o34++; if (g.hitch.length < 60) g.hitch.push([Math.round(ts - S.t0), Math.round(d)]); } if (d > 50) g.fr.o50++; if (d > g.fr.max) g.fr.max = d; } last = ts; raf = requestAnimationFrame(frame); };
  const begin = (kind, target, extra) => { g = Object.assign({ kind, st: Math.round(now() - S.t0), n: 0, c0: ctx(), fr: { n: 0, o17: 0, o34: 0, o50: 0, max: 0 }, hitch: [], tgt: desc(target), cards: [] }, extra || {}); last = 0; if (!raf) raf = requestAnimationFrame(frame); };
  const end = () => {
    if (!g) return; const G = g; g = null; clearTimeout(gTimer); G.en = Math.round(now() - S.t0); G.c1 = ctx(); G.fr.max = Math.round(G.fr.max);
    if (S.gest.length < 5000) S.gest.push(G); else S.drop++;
    safe(() => cam("g"))();
    for (const ms of [30, 100, 200, 350, 500, 800, 1200, 2500]) later(() => { if (!S.on || g) return; const t = now(); const c = cards(); if (c) { c.at = ms; c.cost = +(now() - t).toFixed(1); G.cards.push(c); } }, ms);
  };
  const L = (type, fn) => { const w = safe(fn); window.addEventListener(type, w, { capture: true, passive: true }); S.off.push(() => window.removeEventListener(type, w, { capture: true })); };

  let wlast = 0, wtimer = 0;
  L("wheel", (e) => {
    if (!inBoard(e.target)) return; const t = now();
    if (t - wlast > 180) cam("s"); wlast = t;
    if (S.wheel.length < MAX) S.wheel.push([Math.round(e.timeStamp), Math.round(t - e.timeStamp), +e.deltaX.toFixed(1), +e.deltaY.toFixed(1), (e.ctrlKey ? 1 : 0) | (e.metaKey ? 2 : 0) | (e.shiftKey ? 4 : 0), e.deltaMode]);
    const kind = (e.ctrlKey || e.metaKey) ? "zoom" : "pan";
    if (!g || g.kind !== kind) { end(); begin(kind, e.target); } g.n++; clearTimeout(gTimer); gTimer = setTimeout(safe(end), 180);
    clearTimeout(wtimer); wtimer = setTimeout(safe(() => cam("e")), 200);
  });
  let kEnd = 0;
  L("keydown", (e) => {
    const t = e.target; const n = now();
    const ch = e.key && e.key.length === 1 && !e.metaKey && !e.ctrlKey ? "c" : (/^(Backspace|Delete|Enter|Escape|Tab|Arrow)/.test(e.key || "") ? e.key : (e.metaKey || e.ctrlKey ? "mod+" + (e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key) : "o"));
    if (S.keys.length < MAX) S.keys.push([Math.round(e.timeStamp), Math.round(n - e.timeStamp), inBoard(t) ? 1 : 0, isEd(t) ? 1 : 0, ch]);
    if (!g) begin("key", t, { inb: inBoard(t), ed: isEd(t) });
    if (g && g.kind === "key") { g.n++; clearTimeout(gTimer); gTimer = setTimeout(safe(end), 1500); }
  });
  let pd = null;
  L("pointerdown", (e) => { const t = now(); pd = { t: Math.round(e.timeStamp), d: Math.round(t - e.timeStamp), x: Math.round(e.clientX), y: Math.round(e.clientY), k: kindOf(e.target), b: inBoard(e.target) ? 1 : 0, btn: e.button, m: 0, mods: (e.shiftKey ? 4 : 0) | (e.metaKey ? 2 : 0) | (e.altKey ? 8 : 0), el: inBoard(e.target) ? e.target : null }; cam("pd"); });
  L("pointermove", (e) => { if (!pd) return; pd.m++; if (!g && pd.el && Math.abs(e.clientX - pd.x) + Math.abs(e.clientY - pd.y) > 6) begin("drag", pd.el); if (g && g.kind === "drag") g.n++; });
  const up = (e) => { if (g && g.kind === "drag") end(); if (!pd) return; const q = pd; pd = null; if (S.ptr.length < MAX) S.ptr.push([q.t, q.d, q.x, q.y, Math.round(e.clientX), Math.round(e.clientY), Math.round(e.timeStamp - q.t), q.m, q.k, q.b, q.btn, q.mods]); later(() => cam("pu"), 60); };
  L("pointerup", up); L("pointercancel", up);
  L("dblclick", (e) => { if (S.ptr.length < MAX) S.ptr.push([Math.round(e.timeStamp), 0, Math.round(e.clientX), Math.round(e.clientY), 0, 0, 0, -2, kindOf(e.target), inBoard(e.target) ? 1 : 0, 0, 0]); });
  const hash = safe(() => { S.marks.push({ t: Math.round(now() - S.t0), hash: location.hash.slice(-40), vis: document.visibilityState }); });
  window.addEventListener("hashchange", hash); S.off.push(() => window.removeEventListener("hashchange", hash)); hash();

  const lo = new PerformanceObserver(safe((l) => { for (const e of l.getEntries()) { if (e.duration < 50) continue; if (S.loaf.length >= 9000) { S.drop++; continue; } const endT = e.startTime + e.duration;
    S.loaf.push({ st: Math.round(e.startTime - S.t0), d: Math.round(e.duration), bl: Math.round(e.blockingDuration || 0), rn: e.renderStart ? Math.round(endT - e.renderStart) : 0, sl: e.styleAndLayoutStart ? Math.round(endT - e.styleAndLayoutStart) : 0, g: g ? g.kind : null, c: ctx(),
      s: (e.scripts || []).filter((s) => s.duration >= 4).slice(0, 8).map((s) => ({ d: Math.round(s.duration), f: Math.round(s.forcedStyleAndLayoutDuration || 0), u: s.sourceURL || "", fn: (s.sourceFunctionName || "").slice(0, 40), inv: (s.invoker || "").slice(0, 70), pos: s.sourceCharPosition, it: s.invokerType })) }); } }));
  try { lo.observe({ type: "long-animation-frame", buffered: false }); S.off.push(() => lo.disconnect()); } catch (e) { S.noLoaf = String(e); }
  const eo = new PerformanceObserver(safe((l) => { for (const e of l.getEntries()) { if (e.duration < 40) continue; if (S.ev.length >= 8000) { S.drop++; continue; } const t = e.target; const el = t && t.nodeType === 1 ? t : null; const c = ctx();
    S.ev.push({ n: e.name, st: Math.round(e.startTime - S.t0), d: Math.round(e.duration), delay: Math.round(e.processingStart - e.startTime), proc: Math.round(e.processingEnd - e.processingStart), id: e.interactionId || 0, tg: desc(el), inb: inBoard(el), ed: isEd(el), z: c ? c.z : null }); } }));
  try { eo.observe({ type: "event", durationThreshold: 40, buffered: false }); S.off.push(() => eo.disconnect()); } catch (e) { S.noEv = String(e); }

  const sample = safe(() => { const c = ctx(); S.samples.push({ t: Math.round(now() - S.t0), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, els: document.getElementsByTagName("*").length, c, vis: document.visibilityState, focus: document.hasFocus() }); });
  const iv = setInterval(sample, 20000); S.off.push(() => clearInterval(iv)); sample(); safe(() => cam("start"))();
  try { const v = view(); if (v && v.longTasks) v.longTasks(); } catch (e) {} // first call arms the plexus long-task log

  S.dump = () => {
    let lt = null, sm = null, bo = null;
    try { const v = view() || window.__plexusDiagram.views().find((x) => x.root && x.root.isConnected); lt = v && v.longTasks ? v.longTasks() : null; sm = v && v.slowMounts ? v.slowMounts() : null; } catch (e) {}
    try { bo = window.__plexusDiagram.bgOverruns ? window.__plexusDiagram.bgOverruns() : null; } catch (e) {}
    return JSON.stringify({ fmt: 2, secs: Math.round((now() - S.t0) / 1000), wall: S.wall, t0: Math.round(S.t0), version: window.__plexusDiagram && window.__plexusDiagram.version, dpr: devicePixelRatio, inner: [innerWidth, innerHeight], loaf: S.loaf, ev: S.ev, gest: S.gest, samples: S.samples, marks: S.marks, wheel: S.wheel, cams: S.cams, keys: S.keys, ptr: S.ptr, drop: S.drop, noLoaf: S.noLoaf, noEv: S.noEv, plexusLongTasks: lt, slowMounts: sm, bgOverruns: bo, title: document.title });
  };
  S.stop = () => { S.on = false; end(); clearTimeout(gTimer); clearTimeout(wtimer); for (const f of S.off) { try { f(); } catch (e) {} } S.off = []; for (const id of S.timers) clearTimeout(id); S.timers.clear(); if (raf) cancelAnimationFrame(raf); raf = 0; };
  return JSON.stringify({ started: true, fmt: 2, version: window.__plexusDiagram && window.__plexusDiagram.version, ctx: ctx() });
})()
