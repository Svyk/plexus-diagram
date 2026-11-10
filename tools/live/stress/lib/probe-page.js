(() => {
  const V = 2;
  try { if (window.__pxdStress && window.__pxdStress.v === V) return JSON.stringify({ already: true, v: V }); } catch (e) {}
  const now = () => performance.now();
  const safe = (fn, dflt = null) => { try { const r = fn(); return r === undefined ? dflt : r; } catch (e) { return dflt; } };
  const r1 = (x) => Math.round(x * 10) / 10;
  const pct = (list, p) => { if (!list.length) return null; const a = list.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1))]; };
  // buffers drop their oldest rows in blocks so an idle page cannot grow without bound
  const push = (a, x, cap) => { a.push(x); if (a.length > cap + 256) a.splice(0, 256); };

  const MAIN_OK = (v) => v.root && v.root.isConnected && !v.root.hasAttribute("data-pxd-parked") && !v.root.hasAttribute("data-pxd-snap") && v.root.closest(".roam-article");
  const view = (where) => safe(() => {
    const vs = window.__plexusDiagram && window.__plexusDiagram.views ? window.__plexusDiagram.views() : [];
    if (where === "sidebar") return vs.find((v) => v.root && v.root.isConnected && v.root.closest("#right-sidebar")) || null;
    return vs.find(MAIN_OK) || null;
  });

  const LIVE_SEL = ".pxd-rs, .pxd-item__page:not(.pxd-item__page--preview), .pxd-item__placeholder, .rm-block-main, .rm-block__input, img, canvas, .pxd-item__board, .pxd-item__query";
  // no layout reads: only querySelector, children and textContent
  const bodyState = (shell) => {
    const body = shell.querySelector(".pxd-item__body");
    if (!body) return "empty";
    if (body.querySelector(".pxd-item__page--preview")) return "preview";
    if (body.querySelector(LIVE_SEL)) return "live";
    if (!body.children.length && !(body.textContent || "").trim()) return "empty";
    return "other";
  };
  const hits = (r, c) => r.x < c.x + c.w && r.x + r.w > c.x && r.y < c.y + c.h && r.y + r.h > c.y;
  // Map uid -> state for the non-section cards whose world rect meets the camera; null when the view has no snapshot
  const scan = (v) => {
    const src = v.snapshotSource(), cam = v.cameraRect();
    if (!src || !cam) return null;
    const out = new Map();
    for (const [uid, it] of src.board.items) {
      if (it.type === "section") continue;
      const r = src.rects.get(uid);
      if (!r || !hits(r, cam)) continue;
      const sh = src.shellOf(uid);
      out.set(uid, !sh || !sh.isConnected ? "missing" : bodyState(sh));
    }
    return out;
  };
  const tally = (m) => { const o = { n: 0, missing: 0, empty: 0, preview: 0, live: 0, other: 0 }; for (const s of m.values()) { o.n++; o[s]++; } return o; };

  const lite = () => safe(() => {
    const v = view(); if (!v) return null;
    const vp = v.viewport() || {};
    return { zoom: vp.zoom ?? null, x: vp.x ?? null, y: vp.y ?? null, lod: v.root.getAttribute("data-pxd-lod"), board: v.root.getAttribute("data-board"), attached: safe(() => v.paintAudit().attached), mounted: safe(() => v.stats().mounted) };
  });

  const desc = (t) => safe(() => {
    if (!t || t.nodeType !== 1) return null;
    const h = t.closest(".pxd-port,.pxd-grip,.pxd-btn,.pxd-link,.pxd-edge,.pxd-item,.pxd-section,.pxd-root");
    const k = h ? h.classList[0] : (t.closest(".rm-block__input, textarea") ? "roam-editor" : (t.closest(".roam-sidebar-container, #right-sidebar") ? "sidebar" : "page"));
    const it = t.closest(".pxd-item");
    return it ? k + ":" + (it.getAttribute("data-kind") || it.getAttribute("data-type") || "") : k;
  });

  // run cb after the next frame has been presented: rAF, then a message task
  const mc = new MessageChannel(), afterQ = [];
  mc.port1.onmessage = () => { const f = afterQ.shift(); if (f) safe(f); };
  const afterPaint = (cb) => requestAnimationFrame(() => { afterQ.push(cb); mc.port2.postMessage(0); });

  // ---- global buffers, filled by observers from install on
  const LT = [], LOAF = [], EV = [], obsFailed = [];
  let lastBusy = 0;
  const obs = [];
  const loading = document.readyState !== "complete";
  const watch = (type, opts, handler) => {
    try {
      const o = new PerformanceObserver((l) => safe(() => handler(l.getEntries())));
      o.observe({ type, ...opts });
      obs.push({ o, handler });
    } catch (e) { obsFailed.push(type); }
  };
  watch("longtask", { buffered: loading }, (es) => { for (const e of es) { push(LT, [e.startTime, e.duration], 3000); lastBusy = Math.max(lastBusy, e.startTime + e.duration); } });
  watch("long-animation-frame", { buffered: loading }, (es) => {
    for (const e of es) {
      if (e.duration < 50) continue;
      const end = e.startTime + e.duration;
      push(LOAF, {
        st: e.startTime, d: r1(e.duration), bl: r1(e.blockingDuration || 0), rn: e.renderStart ? r1(end - e.renderStart) : 0, sl: e.styleAndLayoutStart ? r1(end - e.styleAndLayoutStart) : 0,
        scripts: (e.scripts || []).filter((s) => s.duration >= 4).slice(0, 12).map((s) => ({ d: r1(s.duration), f: r1(s.forcedStyleAndLayoutDuration || 0), u: s.sourceURL || "", fn: (s.sourceFunctionName || "").slice(0, 40), inv: (s.invoker || "").slice(0, 70), it: s.invokerType, pos: s.sourceCharPosition })),
      }, 1500);
      lastBusy = Math.max(lastBusy, end);
    }
  });
  watch("event", { durationThreshold: 16, buffered: loading }, (es) => {
    for (const e of es) push(EV, { n: e.name, st: e.startTime, d: e.duration, delay: r1(e.processingStart - e.startTime), proc: r1(e.processingEnd - e.processingStart), id: e.interactionId || 0, tg: desc(e.target) }, 3000);
  });
  const drain = () => { for (const x of obs) safe(() => x.handler(x.o.takeRecords())); };

  // ---- the measured window
  let W = null, epoch = 0;
  const newWin = (opts) => ({ ep: ++epoch, on: true, label: opts.label || "", content: opts.content !== false, contentMs: opts.contentMs || 50, t0: now(), frames: [], lastTs: 0, marks: [], input: { n: 0, firstAt: null, lastAt: null, kinds: { wheel: 0, key: 0, pointer: 0 } }, wheelLat: [], wheelPending: false, wheelFrom: 0, disc: null, act: null, c0: null, lastSample: -1e9, samplePending: false, sampleN: 0, tracked: new Map(), ign: new Set(), finished: [], leftBeforeLive: 0, entered: 0, maxMissing: 0, maxEmpty: 0, cost: 0, timeline: [], lastTally: null, stopAt: 0 });

  const frameLoop = (w) => {
    const tick = (ts) => {
      if (W !== w || !w.on) return;
      if (w.lastTs) push(w.frames, ts - w.lastTs, 40000);
      w.lastTs = ts;
      if (w.content && !w.samplePending && ts - w.lastSample >= w.contentMs) { w.samplePending = true; afterQ.push(() => sample(w)); mc.port2.postMessage(0); }
      if (w.stopAt && ts > w.stopAt) return; // the implicit cold window stops spinning after 2 minutes
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const sample = (w) => {
    w.samplePending = false;
    if (W !== w || !w.on) return;
    const t1 = now();
    w.lastSample = t1;
    const v = view();
    const m = v && safe(() => scan(v));
    if (!m) { w.cost += now() - t1; return; }
    const t = t1 - w.t0;
    const first = w.sampleN === 0;
    w.sampleN++;
    for (const [uid, st] of m) {
      let e = w.tracked.get(uid);
      if (!e) {
        if (w.ign.has(uid)) continue;
        if (first && st === "live") { w.ign.add(uid); continue; }
        e = { enter: t, readable: null, live: null, st };
        w.tracked.set(uid, e);
        w.entered++;
      }
      if (e.readable == null && (st === "preview" || st === "live" || st === "other")) e.readable = t;
      if (e.live == null && st === "live") e.live = t;
    }
    for (const uid of w.ign) if (!m.has(uid)) w.ign.delete(uid);
    for (const [uid, e] of w.tracked) {
      if (m.has(uid)) continue;
      w.tracked.delete(uid);
      if (e.live == null) w.leftBeforeLive++;
      else push(w.finished, e, 20000);
    }
    const o = tally(m);
    w.lastTally = o;
    w.maxMissing = Math.max(w.maxMissing, o.missing);
    w.maxEmpty = Math.max(w.maxEmpty, o.empty);
    push(w.timeline, [Math.round(t), o.missing, o.empty, o.preview, o.live], 6000);
    w.cost += now() - t1;
  };

  // ---- input log: passive, trusted events only
  const onInput = (kind, discrete) => (e) => {
    const w = W;
    if (!w || !w.on || !e.isTrusted || e.timeStamp < w.t0) return;
    const at = e.timeStamp - w.t0, I = w.input;
    I.n++; I.kinds[kind]++;
    if (I.firstAt == null) I.firstAt = r1(at);
    I.lastAt = r1(at);
    if (kind === "wheel") {
      if (!w.wheelPending) { w.wheelPending = true; w.wheelFrom = e.timeStamp; afterPaint(() => { w.wheelPending = false; if (W === w && w.on) push(w.wheelLat, now() - w.wheelFrom, 5000); }); }
    } else if (discrete && !w.disc) {
      const d = w.disc = { ts: e.timeStamp, proxy: null };
      afterPaint(() => { d.proxy = now() - d.ts; });
    }
  };
  // old listeners (from an earlier probe version) feed the newest probe through this holder
  window.__pxdStressInput = (kind, discrete, e) => safe(() => onInput(kind, discrete)(e));
  if (!window.__pxdStressListeners) {
    window.__pxdStressListeners = true;
    const L = (type, kind, discrete) => window.addEventListener(type, (e) => { const f = window.__pxdStressInput; if (f) f(kind, discrete, e); }, { capture: true, passive: true });
    L("wheel", "wheel", false);
    L("pointerdown", "pointer", true);
    L("pointerup", "pointer", true);
    L("click", "pointer", true);
    L("keydown", "key", true);
  }

  const api = {
    v: V,
    view,
    info() {
      const v = view();
      const vp = v ? safe(() => v.viewport()) || {} : {};
      const src = v ? safe(() => v.snapshotSource()) : null;
      let sections = null, items = null;
      if (src && src.board) { sections = 0; items = 0; for (const it of src.board.items.values()) { if (it.type === "section") sections++; else items++; } }
      const st = v ? safe(() => v.stats()) || {} : {};
      return {
        v: V, version: safe(() => window.__plexusDiagram.version), board: v ? v.root.getAttribute("data-board") : null, zoom: vp.zoom ?? null, x: vp.x ?? null, y: vp.y ?? null,
        lod: v ? v.root.getAttribute("data-pxd-lod") : null, items, sections, attached: v ? safe(() => v.paintAudit().attached) : null, mounted: st.mounted ?? null, shells: st.shells ?? null,
        boardEls: v ? v.root.querySelectorAll("*").length : null, docEls: document.getElementsByTagName("*").length,
        heapMB: performance.memory ? r1(performance.memory.usedJSHeapSize / 1048576) : null, vis: document.visibilityState, focus: document.hasFocus(), inner: [innerWidth, innerHeight], dpr: devicePixelRatio,
      };
    },
    cards() {
      const v = view();
      const m = v && safe(() => scan(v));
      return m ? tally(m) : null;
    },
    hz() {
      return new Promise((resolve) => {
        const d = []; let last = 0, n = 0;
        const tick = (ts) => { if (last) d.push(ts - last); last = ts; if (++n <= 40) requestAnimationFrame(tick); else { const m = pct(d, 50); resolve(m ? Math.round(1000 / m) : null); } };
        requestAnimationFrame(tick);
      });
    },
    arm(opts = {}) {
      safe(() => { if (W) W.on = false; });
      const w = W = newWin(opts);
      w.c0 = lite();
      safe(() => { const v = view(); if (v && v.longTasks) v.longTasks(); }); // the first call arms Plexus's own observer
      frameLoop(w);
      return w.c0;
    },
    mark(name) { if (W && W.on) W.marks.push([String(name), r1(now() - W.t0)]); },
    act() {
      const w = W; if (!w || !w.on || w.act) return;
      const a = w.act = { at: now(), ms: null };
      afterPaint(() => { a.ms = now() - a.at; });
    },
    quiet({ gap = 1500, max = 20000 } = {}) {
      return new Promise((resolve) => {
        const t = now();
        const iv = setInterval(() => {
          drain();
          const n = now(), waited = n - t;
          if (n - lastBusy > gap || waited >= max) { clearInterval(iv); resolve(Math.round(waited)); }
        }, 100);
      });
    },
    take() {
      const w = W;
      if (!w) return null;
      drain();
      const tEnd = now();
      w.on = false;
      const t0 = w.t0, rel = (x) => r1(x - t0);
      // slow frames that started inside the window
      const loaf = LOAF.filter((f) => f.st >= t0 && f.st <= tEnd);
      const stalls = { n: loaf.length, total: r1(loaf.reduce((a, f) => a + f.d, 0)), worst: loaf.reduce((a, f) => Math.max(a, f.d), 0), list: loaf.slice().sort((a, b) => b.d - a.d).slice(0, 40).map((f) => ({ ...f, st: rel(f.st) })) };
      const lt = LT.filter((x) => x[0] >= t0 && x[0] <= tEnd);
      const long = { n: lt.length, total: r1(lt.reduce((a, x) => a + x[1], 0)), worst: lt.reduce((a, x) => Math.max(a, x[1]), 0) };
      const fr = w.frames.slice(1);
      const frames = { n: fr.length, p50: safe(() => r1(pct(fr, 50))), p95: safe(() => r1(pct(fr, 95))), p99: safe(() => r1(pct(fr, 99))), max: fr.length ? r1(Math.max(...fr)) : null, over34: fr.filter((x) => x > 34).length, over50: fr.filter((x) => x > 50).length, over100: fr.filter((x) => x > 100).length };
      const evs = EV.filter((e) => e.st >= t0 && e.st <= tEnd);
      const wl = w.wheelLat;
      const input = {
        n: w.input.n, firstAt: w.input.firstAt, lastAt: w.input.lastAt, kinds: w.input.kinds,
        wheel: { n: wl.length, p50: wl.length ? r1(pct(wl, 50)) : null, p95: wl.length ? r1(pct(wl, 95)) : null, max: wl.length ? r1(Math.max(...wl)) : null },
        events: evs.slice().sort((a, b) => b.d - a.d).slice(0, 60).map((e) => ({ n: e.n, st: rel(e.st), d: e.d, delay: e.delay, proc: e.proc, id: e.id, tg: e.tg })),
      };
      // time to next paint: the earliest of the first discrete input and an act() call, else the first wheel
      let ttnp = null;
      const dc = w.disc, ac = w.act;
      const useDisc = dc && (!ac || dc.ts <= ac.at);
      if (useDisc) { const hit = EV.find((e) => Math.abs(e.st - dc.ts) <= 2); ttnp = hit ? hit.d : dc.proxy; }
      else if (ac) ttnp = ac.ms;
      else if (wl.length) ttnp = wl[0];
      if (typeof ttnp === "number") ttnp = r1(ttnp); else ttnp = null;
      let content = null;
      if (w.content) {
        const ents = [...w.finished, ...w.tracked.values()];
        const dl = (k) => ents.filter((e) => e[k] != null).map((e) => e[k] - e.enter);
        const dist = (a) => ({ n: a.length, p50: a.length ? r1(pct(a, 50)) : null, p95: a.length ? r1(pct(a, 95)) : null, max: a.length ? r1(Math.max(...a)) : null });
        const rows = w.timeline, keep = rows.length <= 120 ? rows : Array.from({ length: 120 }, (_, i) => rows[Math.floor((i * (rows.length - 1)) / 119)]);
        const still = [...w.tracked.values()];
        content = {
          samples: w.sampleN, cost: r1(w.cost), lod: safe(() => { const v = view(); return v ? v.root.getAttribute("data-pxd-lod") : null; }), maxMissing: w.maxMissing, maxEmpty: w.maxEmpty, entered: w.entered,
          readable: dist(dl("readable")), live: dist(dl("live")), neverReadable: still.filter((e) => e.readable == null).length, neverLive: still.filter((e) => e.live == null).length, leftBeforeLive: w.leftBeforeLive,
          end: w.lastTally || { n: 0, missing: 0, empty: 0, preview: 0, live: 0, other: 0 }, timeline: keep,
        };
      }
      const v = view();
      const plexus = {
        longTasks: v ? safe(() => v.longTasks().filter((r) => r.start >= t0)) : null,
        slowMounts: v ? safe(() => v.slowMounts().filter((r) => r.at >= t0)) : null,
        paintAudit: v ? safe(() => v.paintAudit()) : null,
        bgOverruns: safe(() => window.__plexusDiagram.bgOverruns().length),
      };
      return { label: w.label, ms: r1(tEnd - t0), t0, stalls, long, frames, input, ttnp, content, marks: w.marks.slice(), c0: w.c0, c1: lite(), plexus, noObs: obsFailed.slice() };
    },
  };

  // ---- cold load: marks like the PXD-20 probe, and an implicit window that starts at navigation
  const cold = { title: null, paint: null, live: null };
  Object.defineProperty(cold, "lt", { get: () => LT.map((x) => [Math.round(x[0]), Math.round(x[1])]), enumerable: false });
  Object.defineProperty(cold, "loaf", { get: () => LOAF.slice(), enumerable: false });
  api.cold = cold;
  window.__pxdStress = api;
  if (loading) {
    const w = W = newWin({ label: "cold", content: false });
    w.t0 = 0;
    w.stopAt = 120000;
    frameLoop(w);
    const tick = () => {
      const t = Math.round(now());
      if (cold.title == null && document.querySelector(".roam-article .rm-title-display")) { cold.title = t; safe(() => performance.mark("cold-title")); }
      const roots = [...document.querySelectorAll(".roam-article .pxd-root")];
      if (cold.paint == null && roots.some((r) => r.querySelector(".pxd-item, .pxd-section, canvas, .pxd-viewport"))) { cold.paint = t; safe(() => performance.mark("cold-paint")); }
      // a live board can have its camera over empty space, so a snapshot source also counts
      if (cold.live == null && (roots.some((r) => !r.hasAttribute("data-pxd-snap") && !r.hasAttribute("data-pxd-parked") && r.querySelector(".pxd-item")) || safe(() => { const v = view(); return !!(v && v.snapshotSource()); }, false))) { cold.live = t; safe(() => performance.mark("cold-live")); }
      if (t < 120000 && cold.live == null) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  return JSON.stringify({ installed: true, v: V });
})()
