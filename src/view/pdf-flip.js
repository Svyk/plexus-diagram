// G2. One in-card PDF flipper. pdf.js draws the current page into the card; the pane stays closed.
// The document is cached while that url is showing and destroyed on deselect, a tier change, or dispose.
// No graph write, no console. A missing pdf.js or a .enc url leaves the cover as it is.

import { flipArrowsShown } from "../model/card-face.js";
import { detectPdfjs, firstPageAllowed } from "./pdf-first-page.js";

export const PDF_DARK_CLASSES = Object.freeze(["pxd-pdf-dark--off", "pxd-pdf-dark--dim", "pxd-pdf-dark--invert"]);
const HOVER_MS = 120;

export function normalizePdfDark(value) {
  return value === "off" || value === "dim" || value === "invert" ? value : "dim";
}

export function pdfDarkClass(value) {
  return `pxd-pdf-dark--${normalizePdfDark(value)}`;
}

// 1-based page index. A step past either end stays on that end.
export function flipStep(page, total, delta) {
  const countRaw = Number(total);
  const count = Number.isFinite(countRaw) && countRaw >= 1 ? Math.floor(countRaw) : 1;
  const atRaw = Number(page);
  const at = Number.isFinite(atRaw) ? Math.floor(atRaw) : 1;
  const next = at + (Number(delta) || 0);
  if (next < 1) return 1;
  if (next > count) return count;
  return next;
}

export function flipFromKey(key) {
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowRight") return 1;
  return 0;
}

export function flipFromWheel(deltaY) {
  const delta = Number(deltaY);
  if (!Number.isFinite(delta) || delta === 0) return 0;
  return delta > 0 ? 1 : -1;
}

export function pageBarText(page, total) {
  return `${page} / ${total}`;
}

// Card screen size times devicePixelRatio. Below 2 css px there is nothing to draw.
export function renderPixels(box) {
  const cssW = Number(box?.cssW);
  const cssH = Number(box?.cssH);
  if (!Number.isFinite(cssW) || !Number.isFinite(cssH) || cssW < 2 || cssH < 2) return null;
  const raw = Number(box?.dpr);
  const dpr = Number.isFinite(raw) && raw > 0 ? raw : 1;
  return {
    cssW,
    cssH,
    dpr,
    backingW: Math.max(1, Math.round(cssW * dpr)),
    backingH: Math.max(1, Math.round(cssH * dpr)),
  };
}

// Hover of a different card wins. Map and overview never pick one. urls is a function or a map of uid → url.
export function pickFlipTarget({ selected = "", hovered = "", lod = "detail", urls = null } = {}) {
  if (lod !== "detail") return "";
  const allow = (uid) => {
    if (!uid) return false;
    let url = "";
    if (typeof urls === "function") url = urls(uid);
    else if (urls && typeof urls.get === "function") url = urls.get(uid) || "";
    else if (urls && typeof urls === "object") url = urls[uid] || "";
    return firstPageAllowed(url);
  };
  const hover = typeof hovered === "string" ? hovered : "";
  const sel = typeof selected === "string" ? selected : "";
  if (hover && hover !== sel && allow(hover)) return hover;
  if (sel && allow(sel)) return sel;
  if (hover && allow(hover)) return hover;
  return "";
}

function destroyQuiet(obj) {
  if (!obj) return;
  try { obj.destroy?.(); } catch { /* already destroyed */ }
  try { obj.cancel?.(); } catch { /* already cancelled */ }
}

// createPdfFlip({ doc, win, lib, timers, urlOf, hostOf, sizeOf, onLive }) → controller.
// One getDocument at a time. Hover waits 120 ms unless timers.later is missing, in which case it runs now.
export function createPdfFlip({ doc, win, lib = null, timers = null, urlOf = null, hostOf = null, sizeOf = null, onLive = null } = {}) {
  let selected = "";
  let hovered = "";
  let lod = "detail";
  let currentUid = "";
  let currentUrl = "";
  let page = 1;
  let total = 1;
  let gen = 0;
  let renderSeq = 0;
  let pdf = null;
  let task = null;
  let renderTask = null;
  let loading = false;
  let announced = false;
  let host = null;
  let layer = null;
  let canvas = null;
  let bar = null;
  let pagesEl = null;
  let wheelNode = null;
  let wheelFn = null;
  let hoverTimer = null;
  let job = Promise.resolve();

  const schedule = (fn, ms) => {
    if (typeof timers?.later === "function") {
      const cancel = timers.later(fn, ms);
      return typeof cancel === "function" ? cancel : () => {};
    }
    fn();
    return () => {};
  };
  const clearHover = () => {
    if (!hoverTimer) return;
    try { hoverTimer(); } catch { /* already cleared */ }
    hoverTimer = null;
  };
  const announce = (on) => {
    if (announced === on) return;
    announced = on;
    try { onLive?.(on); } catch { /* host */ }
  };
  const track = (work) => {
    const run = job.then(work, work);
    job = run.then(() => {}, () => {});
    return run;
  };
  const engine = () => {
    if (lib && typeof lib.getDocument === "function") return lib;
    return detectPdfjs(win)?.lib || null;
  };
  const unwheel = () => {
    if (wheelNode && wheelFn) {
      try { wheelNode.removeEventListener("wheel", wheelFn); } catch { /* gone */ }
    }
    wheelNode = null;
    wheelFn = null;
  };
  const detach = () => {
    unwheel();
    try { layer?.remove?.(); } catch { /* gone */ }
    try { bar?.remove?.(); } catch { /* gone */ }
    layer = null;
    canvas = null;
    bar = null;
    pagesEl = null;
    host = null;
  };
  const paintBar = () => {
    if (pagesEl) pagesEl.textContent = pageBarText(page, total);
    if (!bar) return;
    const arrows = flipArrowsShown(total);
    for (const step of bar.querySelectorAll?.(".pxd-pdf-bar__step") || []) {
      if (arrows) step.removeAttribute?.("hidden");
      else step.setAttribute?.("hidden", "");
    }
    bar.classList?.toggle?.("pxd-pdf-bar--single", !arrows);
  };
  const cancelRender = () => {
    const current = renderTask;
    renderTask = null;
    destroyQuiet(current);
  };
  const dropLive = () => {
    clearHover();
    gen += 1;
    renderSeq += 1;
    cancelRender();
    const oldPdf = pdf;
    const oldTask = task;
    pdf = null;
    task = null;
    loading = false;
    currentUid = "";
    currentUrl = "";
    page = 1;
    total = 1;
    detach();
    destroyQuiet(oldTask);
    destroyQuiet(oldPdf);
    announce(false);
  };
  const onWheel = (event) => {
    if (!pdf || !selected || currentUid !== selected) return;
    if (event.ctrlKey || event.metaKey) return;
    const delta = flipFromWheel(event.deltaY);
    if (!delta) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    stepBy(delta);
  };
  const mount = (paper) => {
    if (!doc || typeof doc.createElement !== "function" || !paper) return;
    if (host === paper && layer && canvas) return;
    detach();
    host = paper;
    layer = doc.createElement("div");
    layer.className = "pxd-pdf-flip";
    canvas = doc.createElement("canvas");
    layer.append(canvas);
    paper.append(layer);
    wheelFn = onWheel;
    wheelNode = paper;
    paper.addEventListener("wheel", wheelFn, { passive: false });
  };
  const showBar = () => {
    if (!doc || !host) return;
    if (!bar) {
      bar = doc.createElement("div");
      bar.className = "pxd-pdf-bar pxd-chrome";
      const prev = doc.createElement("button");
      prev.type = "button";
      prev.className = "pxd-pdf-bar__step";
      prev.textContent = "‹";
      prev.setAttribute("aria-label", "Previous page");
      pagesEl = doc.createElement("span");
      pagesEl.className = "pxd-pdf-bar__pages";
      const next = doc.createElement("button");
      next.type = "button";
      next.className = "pxd-pdf-bar__step";
      next.textContent = "›";
      next.setAttribute("aria-label", "Next page");
      const halt = (event) => { event.stopPropagation?.(); };
      const bind = (node, delta) => {
        node.addEventListener("pointerdown", halt);
        node.addEventListener("mousedown", halt);
        node.addEventListener("click", (event) => {
          halt(event);
          event.preventDefault?.();
          stepBy(delta);
        });
      };
      bind(prev, -1);
      bind(next, 1);
      bar.append(prev, pagesEl, next);
      host.append(bar);
    }
    paintBar();
  };
  async function draw() {
    const mine = ++renderSeq;
    const loadGen = gen;
    const docPdf = pdf;
    const node = canvas;
    if (!docPdf || !node || typeof docPdf.getPage !== "function") return;
    const px = renderPixels(typeof sizeOf === "function" ? sizeOf(currentUid) : null);
    if (!px) return;
    let proxy = null;
    try { proxy = await docPdf.getPage(page); } catch { return; }
    if (mine !== renderSeq || loadGen !== gen || pdf !== docPdf || !proxy) return;
    let base = null;
    try { base = proxy.getViewport({ scale: 1 }); } catch { return; }
    const bw = Number(base?.width) || 0;
    const bh = Number(base?.height) || 0;
    if (bw < 1 || bh < 1) return;
    const fit = Math.min(px.cssW / bw, px.cssH / bh);
    let view = null;
    try { view = proxy.getViewport({ scale: fit * px.dpr }); } catch { return; }
    if (mine !== renderSeq || loadGen !== gen) return;
    node.width = px.backingW;
    node.height = px.backingH;
    if (node.style) {
      node.style.width = `${px.cssW}px`;
      node.style.height = `${px.cssH}px`;
    }
    const ctx = node.getContext?.("2d");
    if (ctx) {
      try {
        ctx.setTransform?.(1, 0, 0, 1, 0, 0);
        ctx.clearRect?.(0, 0, node.width, node.height);
        const ox = (px.backingW - (Number(view?.width) || 0)) / 2;
        const oy = (px.backingH - (Number(view?.height) || 0)) / 2;
        ctx.setTransform?.(1, 0, 0, 1, ox, oy);
      } catch { /* a stub context still accepts the render call */ }
    }
    cancelRender();
    let render = null;
    try { render = proxy.render?.({ canvasContext: ctx, viewport: view }); } catch { return; }
    renderTask = render;
    try { await (render?.promise || render); } catch { /* cancelled */ }
    if (renderTask === render) renderTask = null;
  }
  function stepBy(delta) {
    if (!pdf) return false;
    const next = flipStep(page, total, delta);
    if (next === page) return false;
    page = next;
    paintBar();
    track(() => draw());
    return true;
  }
  async function openDoc(uid, url) {
    if (currentUid === uid && currentUrl === url && (pdf || loading)) {
      const paper = typeof hostOf === "function" ? hostOf(uid) : null;
      if (paper && paper !== host) {
        mount(paper);
        if (pdf) {
          showBar();
          await draw();
        }
      }
      return;
    }
    const mine = ++gen;
    renderSeq += 1;
    cancelRender();
    const oldPdf = pdf;
    const oldTask = task;
    pdf = null;
    task = null;
    loading = true;
    currentUid = uid;
    currentUrl = url;
    page = 1;
    total = 1;
    destroyQuiet(oldTask);
    destroyQuiet(oldPdf);
    if (mine !== gen) return;
    const paper = typeof hostOf === "function" ? hostOf(uid) : null;
    const reader = engine();
    if (!paper || !reader || typeof reader.getDocument !== "function") {
      if (mine !== gen) return;
      loading = false;
      currentUid = "";
      currentUrl = "";
      detach();
      announce(false);
      return;
    }
    mount(paper);
    announce(true);
    let loadingTask = null;
    try { loadingTask = reader.getDocument({ url }); } catch { loadingTask = null; }
    if (mine !== gen) {
      destroyQuiet(loadingTask);
      return;
    }
    if (!loadingTask) {
      loading = false;
      announce(false);
      return;
    }
    task = loadingTask;
    let docPdf = null;
    try {
      docPdf = typeof loadingTask.promise?.then === "function" ? await loadingTask.promise : await loadingTask;
    } catch { docPdf = null; }
    if (mine !== gen || !docPdf) {
      destroyQuiet(docPdf);
      destroyQuiet(loadingTask);
      if (mine === gen) {
        loading = false;
        task = null;
        announce(false);
      }
      return;
    }
    pdf = docPdf;
    task = null;
    loading = false;
    const count = Number(docPdf.numPages);
    total = Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;
    page = 1;
    const paperNow = typeof hostOf === "function" ? hostOf(uid) : paper;
    if (paperNow && paperNow !== host) mount(paperNow);
    showBar();
    await draw();
  }
  const go = (uid) => {
    const url = typeof urlOf === "function" ? urlOf(uid) : "";
    if (!firstPageAllowed(url)) {
      dropLive();
      return;
    }
    track(() => openDoc(uid, url));
  };
  const queue = () => {
    clearHover();
    if (lod !== "detail") {
      dropLive();
      return;
    }
    const uid = pickFlipTarget({ selected, hovered, lod, urls: urlOf });
    if (!uid) {
      dropLive();
      return;
    }
    if (uid === hovered && uid !== selected) {
      hoverTimer = schedule(() => {
        hoverTimer = null;
        go(uid);
      }, HOVER_MS);
      return;
    }
    go(uid);
  };
  const assign = (next = {}) => {
    let changed = false;
    if (next && Object.prototype.hasOwnProperty.call(next, "selected")) {
      const value = typeof next.selected === "string" ? next.selected : "";
      if (value !== selected) { selected = value; changed = true; }
    }
    if (next && Object.prototype.hasOwnProperty.call(next, "hovered")) {
      const value = typeof next.hovered === "string" ? next.hovered : "";
      if (value !== hovered) { hovered = value; changed = true; }
    }
    if (next && Object.prototype.hasOwnProperty.call(next, "lod")) {
      const value = next.lod === "map" || next.lod === "overview" ? next.lod : "detail";
      if (value !== lod) { lod = value; changed = true; }
    }
    // A repeated sync (every content frame) must not restart the hover wait or reload the document.
    // A cover repaint swaps the paper node; the live canvas has to follow that node.
    if (!changed) {
      if ((pdf || loading) && currentUid) {
        const paper = typeof hostOf === "function" ? hostOf(currentUid) : null;
        if (paper && paper !== host) {
          mount(paper);
          if (pdf) {
            showBar();
            track(() => draw());
          }
        }
      } else if (!pdf && !loading && !hoverTimer && lod === "detail" && (selected || hovered)) {
        queue();
      }
      return;
    }
    queue();
  };

  return {
    assign,
    setSelected(uid) { assign({ selected: typeof uid === "string" ? uid : "" }); },
    setHover(uid) { assign({ hovered: typeof uid === "string" ? uid : "" }); },
    setLod(next) { assign({ lod: next }); },
    consumeKey(key) {
      if (!selected || currentUid !== selected || !pdf) return false;
      const delta = flipFromKey(key);
      if (!delta) return false;
      stepBy(delta);
      return true;
    },
    settle() {
      if (pdf && currentUid) track(() => draw());
    },
    destroy() { dropLive(); },
    live() { return Boolean(pdf || loading); },
    // The page the card shows right now (1 when it is not the live card).
    pageOf(uid) { return uid && uid === currentUid && pdf ? page : 1; },
    totalOf(uid) { return uid && uid === currentUid && pdf ? total : 0; },
    liveUid() { return currentUid; },
    idle() { return job; },
  };
}
