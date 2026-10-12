// "Reading" motion while a PDF parses. A soft beam sweeps the page, the parts the parser finds draw in as
// thin outlines, and a 14 px ring with a running count ("3 tables · 18 paragraphs") sits in the header.
// Transform, opacity and stroke-dashoffset only. Overlays are absolutely positioned inside boxes that already
// exist, so nothing shifts. Under prefers-reduced-motion only the ring and the counts show. No timers, frames
// or listeners exist while no parse runs, and dispose() removes every node it made.

import { bboxToPagePercent } from "./parse-overlay.js";

export const MOTION_TIMING = Object.freeze({
  drawMs: 220,
  staggerMs: 25,
  boxCap: 40,
  countMs: 150,
  pulseMs: 600,
  holdMs: 2000,
  summaryMs: 4000,
  pageMs: 700,
  minPageMs: 250,
  maxPageMs: 4000,
  fractionMs: 300,
});

const SVG_NS = "http://www.w3.org/2000/svg";
const clamp01 = (n) => Math.max(0, Math.min(1, n));

// Pure. One colour family per part kind.
export function partKind(type) {
  const t = String(type || "").toLowerCase();
  if (t === "table") return "table";
  if (t === "figure" || t === "image" || t === "picture" || t === "chart") return "figure";
  if (t === "formula" || t === "equation") return "formula";
  if (t === "heading" || t === "title") return "heading";
  if (t === "caption") return "caption";
  return "text";
}

// Pure. Tables, figures, formulas; everything else that reads as text counts as a paragraph.
export function partCounts(blocks) {
  const out = { tables: 0, paragraphs: 0, figures: 0, formulas: 0 };
  for (const block of blocks || []) {
    if (!block) continue;
    const kind = partKind(block.type);
    if (kind === "table") out.tables += 1;
    else if (kind === "figure") out.figures += 1;
    else if (kind === "formula") out.formulas += 1;
    else out.paragraphs += 1;
  }
  return out;
}

// Pure. Counts of a pxd-parse document (blocks in reading order).
export function docCounts(doc) {
  const blocks = [];
  for (const id of doc?.order || []) {
    const block = doc.blocks?.[id];
    if (block) blocks.push(block);
  }
  return partCounts(blocks);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Pure. "3 tables · 18 paragraphs · 2 figures", plus " · 4.2 s" when ms is given. Zero kinds are left out.
export function countLabel(counts, ms = null) {
  const c = counts || {};
  const bits = [];
  if (c.tables) bits.push(plural(c.tables, "table", "tables"));
  if (c.paragraphs) bits.push(plural(c.paragraphs, "paragraph", "paragraphs"));
  if (c.figures) bits.push(plural(c.figures, "figure", "figures"));
  if (c.formulas) bits.push(plural(c.formulas, "formula", "formulas"));
  const time = typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? `${(ms / 1000).toFixed(1)} s` : "";
  if (!bits.length) return time ? `No parts found · ${time}` : "Reading…";
  if (time) bits.push(time);
  return bits.join(" · ");
}

// Pure. Overall progress 0..1, or null when the route reports none.
export function overallFraction({ fraction = null, page = 0, pageCount = 0 } = {}) {
  const f = Number(fraction);
  if (fraction != null && Number.isFinite(f)) return clamp01(f);
  const p = Number(page);
  const n = Number(pageCount);
  if (n > 0 && p > 0) return clamp01(p / n);
  return null;
}

// Pure. stroke-dashoffset for a ring drawn with pathLength 100. Unknown progress shows a quarter arc.
export function ringOffset(fraction) {
  if (fraction == null || !Number.isFinite(Number(fraction))) return 75;
  return Math.round((1 - clamp01(Number(fraction))) * 1000) / 10;
}

// Pure. How long one page's sweep should take: the mean of the last three page times, clamped.
export function pageSweepMs(durations, t = MOTION_TIMING) {
  const last = (durations || []).filter((d) => Number.isFinite(d) && d > 0).slice(-3);
  if (!last.length) return t.pageMs;
  const mean = last.reduce((a, b) => a + b, 0) / last.length;
  return Math.round(Math.max(t.minPageMs, Math.min(t.maxPageMs, mean)));
}

// Pure. Where the beam goes for one progress report.
// { kind: "page", restart } sweeps the page once (a new page restarts at the top);
// { kind: "fraction", y } moves it to y (0..1) of the page; { kind: "loop" } when nothing is known.
export function beamPlan({ page = 0, pageCount = 0, fraction = null } = {}, lastPage = 0) {
  const p = Number(page) || 0;
  const n = Number(pageCount) || 0;
  if (p > 0 && n > 1) return { kind: "page", restart: p !== lastPage };
  const f = overallFraction({ fraction, page: p, pageCount: n });
  if (f == null) return { kind: "loop" };
  return { kind: "fraction", y: f };
}

// Pure. Part boxes of one page in percent of the page, with their draw-in delays. The first `cap` boxes draw
// in one after another; the rest fade in together.
export function partBoxes(blocks, page, { cap = MOTION_TIMING.boxCap, staggerMs = MOTION_TIMING.staggerMs } = {}) {
  const out = [];
  for (const block of blocks || []) {
    if (!block || !Array.isArray(block.bbox)) continue;
    const pct = bboxToPagePercent(block.bbox, page || {});
    if (!pct || !(pct.width > 0) || !(pct.height > 0)) continue;
    const i = out.length;
    out.push({
      id: block.id || "",
      kind: partKind(block.type),
      left: pct.left,
      top: pct.top,
      width: pct.width,
      height: pct.height,
      draw: i < cap,
      delay: i < cap ? i * staggerMs : 0,
    });
  }
  return out;
}

// Pure. "full" animates, "quiet" shows the ring and counts only, "off" shows nothing.
export function motionMode({ reduced = false, visible = true, lod = "detail" } = {}) {
  if (!visible) return "off";
  if (lod && lod !== "detail") return "off";
  return reduced ? "quiet" : "full";
}

export function prefersReducedMotion(win) {
  try { return Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches); } catch { return false; }
}

// A paint that runs at most every `minMs`; the last value always lands.
export function createThrottle({ minMs = MOTION_TIMING.countMs, now = () => Date.now(), setTimer, clearTimer, paint } = {}) {
  let last = -Infinity;
  let timer = null;
  let pending;
  let has = false;
  const fire = () => {
    timer = null;
    if (!has) return;
    has = false;
    last = now();
    const value = pending;
    pending = undefined;
    try { paint?.(value); } catch { /* paint */ }
  };
  return {
    push(value) {
      pending = value;
      has = true;
      const wait = minMs - (now() - last);
      if (wait <= 0) { if (timer != null) { clearTimer?.(timer); timer = null; } fire(); return; }
      if (timer == null) timer = setTimer?.(fire, wait);
    },
    flush() {
      if (timer != null) { clearTimer?.(timer); timer = null; }
      fire();
    },
    cancel() {
      if (timer != null) { clearTimer?.(timer); timer = null; }
      has = false;
      pending = undefined;
    },
  };
}

// One surface: an overlay inside a page-sized box (beam + part outlines) and a header badge (ring + count).
// overlayHost / headHost may change while a parse runs (the reader follows the page being read).
// mode(): "full" | "quiet" | "off", read on every report so offscreen and map-zoom surfaces go still.
export function createParseMotion({ doc, overlayHost = null, overlayPage = 0, headHost = null, mode = () => "full", now = () => Date.now(), timing = MOTION_TIMING, cls = "" } = {}) {
  const win = () => doc?.defaultView || null;
  const later = (fn, ms) => (win()?.setTimeout || setTimeout)(fn, ms);
  const unlater = (id) => (win()?.clearTimeout || clearTimeout)(id);
  const frame = (fn) => {
    const raf = win()?.requestAnimationFrame;
    if (typeof raf === "function") return { raf: raf.call(win(), fn) };
    return { timer: later(fn, 16) };
  };
  const unframe = (h) => {
    if (!h) return;
    if (h.raf != null) { try { win()?.cancelAnimationFrame?.(h.raf); } catch { /* stub */ } }
    if (h.timer != null) unlater(h.timer);
  };
  const svgEl = (tag) => (typeof doc?.createElementNS === "function" ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag));

  let overlay = null;
  let carrier = null;
  let partsSvg = null;
  let head = null;
  let ringFill = null;
  let headText = null;
  let hostEl = overlayHost;
  let hostPage = Number(overlayPage) || 0;
  let headEl = headHost;
  let state = "idle";
  let lastPage = 0;
  let pageAt = 0;
  const durations = [];
  const frames = new Set();
  const timers = new Set();
  let disposed = false;

  const wait = (fn, ms) => {
    const id = later(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };
  const nextFrame = (fn) => {
    const h = frame(() => { frames.delete(h); fn(); });
    frames.add(h);
    return h;
  };
  const clearAll = () => {
    for (const id of timers) unlater(id);
    timers.clear();
    for (const h of frames) unframe(h);
    frames.clear();
  };

  const counter = createThrottle({
    minMs: timing.countMs,
    now,
    setTimer: (fn, ms) => wait(fn, ms),
    clearTimer: (id) => { timers.delete(id); unlater(id); },
    paint: (text) => { if (headText) headText.textContent = text; },
  });

  const currentMode = () => {
    try { return mode?.() || "full"; } catch { return "full"; }
  };

  const ensureOverlay = () => {
    if (!hostEl || !doc) return null;
    if (overlay && overlay.parentElement === hostEl) return overlay;
    dropOverlay();
    overlay = doc.createElement("div");
    overlay.className = `pxd-pmotion${cls ? ` ${cls}` : ""}`;
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.pointerEvents = "none";
    carrier = doc.createElement("div");
    carrier.className = "pxd-pmotion__carrier";
    const beam = doc.createElement("div");
    beam.className = "pxd-pmotion__beam";
    carrier.append(beam);
    partsSvg = svgEl("svg");
    partsSvg.setAttribute("class", "pxd-pmotion__parts");
    partsSvg.setAttribute("viewBox", "0 0 100 100");
    partsSvg.setAttribute("preserveAspectRatio", "none");
    overlay.append(carrier, partsSvg);
    hostEl.append(overlay);
    return overlay;
  };
  function dropOverlay() {
    try { overlay?.remove?.(); } catch { /* gone */ }
    overlay = null;
    carrier = null;
    partsSvg = null;
  }

  const ensureHead = () => {
    if (!headEl || !doc) return null;
    if (head && head.parentElement === headEl) return head;
    try { head?.remove?.(); } catch { /* gone */ }
    head = doc.createElement("div");
    head.className = "pxd-pmotion-head";
    head.setAttribute("role", "status");
    head.setAttribute("aria-live", "polite");
    const ring = svgEl("svg");
    ring.setAttribute("class", "pxd-pmotion-head__ring");
    ring.setAttribute("viewBox", "0 0 16 16");
    ring.setAttribute("width", "14");
    ring.setAttribute("height", "14");
    ring.setAttribute("aria-hidden", "true");
    const track = svgEl("circle");
    track.setAttribute("class", "pxd-pmotion-head__track");
    track.setAttribute("cx", "8");
    track.setAttribute("cy", "8");
    track.setAttribute("r", "6");
    ringFill = svgEl("circle");
    ringFill.setAttribute("class", "pxd-pmotion-head__fill");
    ringFill.setAttribute("cx", "8");
    ringFill.setAttribute("cy", "8");
    ringFill.setAttribute("r", "6");
    ringFill.setAttribute("pathLength", "100");
    ringFill.setAttribute("transform", "rotate(-90 8 8)");
    ringFill.style.strokeDashoffset = "100";
    ring.append(track, ringFill);
    headText = doc.createElement("span");
    headText.className = "pxd-pmotion-head__text";
    headText.textContent = "Reading…";
    head.append(ring, headText);
    headEl.append(head);
    return head;
  };
  const dropHead = () => {
    try { head?.remove?.(); } catch { /* gone */ }
    head = null;
    ringFill = null;
    headText = null;
  };

  const setRing = (fraction) => {
    if (!ringFill) return;
    head?.classList.toggle("pxd-pmotion-head--spin", fraction == null);
    ringFill.style.strokeDashoffset = String(ringOffset(fraction));
  };

  const moveBeam = (plan) => {
    if (!carrier || !overlay) return;
    if (plan.kind === "loop") {
      overlay.classList.add("pxd-pmotion--loop");
      return;
    }
    overlay.classList.remove("pxd-pmotion--loop");
    if (plan.kind === "fraction") {
      carrier.style.transition = `transform ${timing.fractionMs}ms ease-out`;
      carrier.style.transform = `translateY(${(plan.y * 100).toFixed(2)}%)`;
      return;
    }
    if (!plan.restart) return;
    const ms = pageSweepMs(durations, timing);
    carrier.style.transition = "none";
    carrier.style.transform = "translateY(0%)";
    const node = carrier;
    // Two frames: the first commits the jump to the top, the second starts the sweep from there.
    nextFrame(() => nextFrame(() => {
      if (node !== carrier) return;
      node.style.transition = `transform ${ms}ms linear`;
      node.style.transform = "translateY(100%)";
    }));
  };

  const drawBoxes = (boxes, { pulse = false } = {}) => {
    if (!partsSvg) return;
    const animate = currentMode() === "full" && !pulse;
    const made = [];
    for (const box of boxes || []) {
      const rect = svgEl("rect");
      rect.setAttribute("class", `pxd-pmotion__part pxd-pmotion__part--${box.kind || "text"}${box.draw === false ? " pxd-pmotion__part--fade" : ""}`);
      rect.setAttribute("x", String(box.left));
      rect.setAttribute("y", String(box.top));
      rect.setAttribute("width", String(box.width));
      rect.setAttribute("height", String(box.height));
      rect.setAttribute("rx", "0.6");
      rect.setAttribute("pathLength", "100");
      rect.setAttribute("vector-effect", "non-scaling-stroke");
      if (box.id) rect.setAttribute("data-block", box.id);
      if (animate && box.draw !== false && box.delay) rect.style.transitionDelay = `${box.delay}ms`;
      if (!animate) rect.classList?.add?.("pxd-pmotion__part--in");
      partsSvg.append(rect);
      made.push(rect);
    }
    if (animate && made.length) nextFrame(() => nextFrame(() => { for (const rect of made) rect.classList?.add?.("pxd-pmotion__part--in"); }));
    return made;
  };

  const setState = (next) => {
    state = next;
    for (const node of [overlay, head]) {
      if (!node) continue;
      node.classList.remove("pxd-pmotion--running", "pxd-pmotion--done", "pxd-pmotion--error", "pxd-pmotion--fading");
      node.classList.add(`pxd-pmotion--${next}`);
    }
  };

  const stop = () => {
    clearAll();
    counter.cancel();
    dropOverlay();
    dropHead();
    state = "idle";
    lastPage = 0;
    durations.length = 0;
  };

  const applyMode = () => {
    const m = currentMode();
    if (m === "off") { dropOverlay(); dropHead(); return m; }
    ensureHead();
    if (m === "full") ensureOverlay();
    else dropOverlay();
    if (head) head.classList.toggle("pxd-pmotion-head--quiet", m === "quiet");
    return m;
  };

  return {
    // The overlay follows a new page box (or none). Its drawn parts belong to the old page, so they go.
    setOverlayHost(el, page = 0) {
      if (el === hostEl && Number(page) === hostPage) return;
      hostEl = el || null;
      hostPage = Number(page) || 0;
      dropOverlay();
      if (state === "running") { applyMode(); setState("running"); if (hostPage && hostPage === lastPage) moveBeam({ kind: "page", restart: true }); }
    },
    setHeadHost(el) {
      if (el === headEl) return;
      headEl = el || null;
      dropHead();
      if (state !== "idle") { applyMode(); setState(state); }
    },
    overlayPage: () => hostPage,
    start() {
      if (disposed) return;
      clearAll();
      counter.cancel();
      dropOverlay();
      lastPage = 0;
      durations.length = 0;
      pageAt = now();
      applyMode();
      setState("running");
      if (headText) headText.textContent = "Reading…";
      setRing(0);
    },
    // info: { fraction?, page?, pageCount?, counts? }
    progress(info = {}) {
      if (disposed) return;
      if (state !== "running") this.start();
      const m = applyMode();
      if (m === "off") return;
      setState("running");
      setRing(overallFraction(info));
      if (info.counts) counter.push(countLabel(info.counts));
      if (m !== "full") { lastPage = Number(info.page) || lastPage; return; }
      const plan = beamPlan(info, lastPage);
      if (plan.kind === "page" && plan.restart) {
        const t = now();
        if (lastPage) durations.push(t - pageAt);
        pageAt = t;
      }
      // The overlay sits on one page: sweep it when that is the page being read, else track overall progress.
      const p = Number(info.page) || 0;
      if (plan.kind === "page" && hostPage && p && hostPage !== p) {
        const f = overallFraction(info);
        moveBeam(f == null ? { kind: "loop" } : { kind: "fraction", y: f });
      } else {
        moveBeam(plan);
      }
      lastPage = p || lastPage;
    },
    // Parts that landed on `page`, as partBoxes() plans. Drawn only on the overlay's own page.
    parts(page, boxes) {
      if (disposed || state !== "running") return;
      if (Number(page) !== hostPage) return;
      if (currentMode() !== "full") return;
      if (!ensureOverlay()) return;
      drawBoxes(boxes);
    },
    // Finish: the beam fades, the boxes pulse once and stay faint for holdMs (unless keep), the head shows the
    // summary with the time for summaryMs, then everything goes.
    done({ counts = null, ms = null, boxes = null, keep = false } = {}) {
      if (disposed || state === "idle") return;
      clearAll();
      counter.cancel();
      const m = applyMode();
      if (m === "off") { stop(); return; }
      setState("done");
      setRing(1);
      if (headText) headText.textContent = countLabel(counts || {}, ms);
      if (m === "full" && partsSvg) {
        if (typeof partsSvg.replaceChildren === "function") partsSvg.replaceChildren();
        drawBoxes(boxes || [], { pulse: true });
        wait(() => {
          if (!overlay) return;
          if (keep) { dropOverlay(); return; }
          overlay.classList.add("pxd-pmotion--fading");
        }, timing.pulseMs + timing.holdMs);
      } else {
        dropOverlay();
      }
      wait(() => { if (head) head.classList.add("pxd-pmotion--fading"); }, timing.summaryMs);
      wait(() => stop(), Math.max(timing.summaryMs, timing.pulseMs + timing.holdMs) + 400);
    },
    // An error ends the motion: the beam stops, the ring turns the warn colour, the head says so briefly.
    fail(message = "") {
      if (disposed || state === "idle") return;
      clearAll();
      counter.cancel();
      dropOverlay();
      if (currentMode() === "off") { stop(); return; }
      ensureHead();
      setState("error");
      if (headText) headText.textContent = message || "Parse stopped";
      head?.classList.remove("pxd-pmotion-head--spin");
      wait(() => { if (head) head.classList.add("pxd-pmotion--fading"); }, timing.summaryMs);
      wait(() => stop(), timing.summaryMs + 400);
    },
    cancel() { stop(); },
    state: () => state,
    // Read-only probes for tests and the live harness.
    nodes: () => ({ overlay, head, carrier, parts: partsSvg }),
    pending: () => ({ timers: timers.size, frames: frames.size }),
    dispose() {
      disposed = true;
      stop();
    },
  };
}
