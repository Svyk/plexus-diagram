// Paint page photos back on top of an inverted PDF canvas.
// pdf.js draws photos into the same canvas as the text, so a CSS invert flips
// them too. A sibling canvas copies those pixels with drawImage, which reads
// the bitmap before the CSS filter. One operator list per page, cached.
// Masks and images under 36pt are left inverted.

import { applyPoint, mul } from "../model/parse/lines.js";

const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_FORM_BEGIN = 74;
const OP_FORM_END = 75;
const OP_MASK = 83;
const OP_IMAGE = 85;
const OP_INLINE = 86;
const OP_REPEAT = 88;
const MIN_SIDE = 36;

const installed = new WeakMap();

function unitBox(ctm) {
  const pts = [applyPoint(ctm, 0, 0), applyPoint(ctm, 1, 0), applyPoint(ctm, 1, 1), applyPoint(ctm, 0, 1)];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}

function viewportBox(box, transform) {
  const pts = [
    applyPoint(transform, box.x0, box.y0),
    applyPoint(transform, box.x1, box.y0),
    applyPoint(transform, box.x1, box.y1),
    applyPoint(transform, box.x0, box.y1),
  ];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}

function pushFrac(out, ctm, transform, width, height) {
  const user = unitBox(ctm);
  const side = Math.min(Math.abs(user.x1 - user.x0), Math.abs(user.y1 - user.y0));
  if (!Number.isFinite(side) || side < MIN_SIDE) return;
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!(w > 0) || !(h > 0)) return;
  const view = viewportBox(user, transform);
  const fw = view.x1 - view.x0;
  const fh = view.y1 - view.y0;
  if (!(fw > 0) || !(fh > 0)) return;
  out.push([view.x0 / w, view.y0 / h, fw / w, fh / h]);
}

export function photoFracs(ops, { transform, width, height } = {}) {
  const fn = ops?.fnArray || [];
  const args = ops?.argsArray || [];
  const m = transform && transform.length >= 6 ? transform : [1, 0, 0, -1, 0, Number(height) || 0];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const out = [];
  for (let i = 0; i < fn.length; i += 1) {
    const op = fn[i];
    const a = args[i];
    if (op === OP_SAVE) { stack.push(ctm); continue; }
    if (op === OP_RESTORE) { const prev = stack.pop(); if (prev) ctm = prev; continue; }
    if (op === OP_TRANSFORM) {
      if (a && a.length >= 6) ctm = mul(ctm, Array.from(a));
      continue;
    }
    if (op === OP_FORM_BEGIN) {
      stack.push(ctm);
      if (a && a[0] && a[0].length >= 6) ctm = mul(ctm, Array.from(a[0]));
      continue;
    }
    if (op === OP_FORM_END) { const prev = stack.pop(); if (prev) ctm = prev; continue; }
    if (op === OP_MASK) continue;
    if (op === OP_IMAGE || op === OP_INLINE) {
      pushFrac(out, ctm, m, width, height);
      continue;
    }
    if (op === OP_REPEAT) {
      const [, sx, sy, positions] = a || [];
      if (!positions) continue;
      for (let p = 0; p + 1 < positions.length; p += 2) {
        pushFrac(out, mul(ctm, [Number(sx) || 0, 0, 0, Number(sy) || 0, positions[p], positions[p + 1]]), m, width, height);
      }
    }
  }
  return out;
}

export function shouldRestoreContainer(node) {
  if (!node) return false;
  if (node.closest?.(".pxd-read, .pxd-root")) return false;
  return true;
}

function pdfPageOf(page) {
  const found = page?.pdfPage || page?.pdfPageView?.pdfPage;
  if (found && typeof found.getOperatorList === "function") return found;
  return null;
}

function viewportOf(pdfPage) {
  try {
    const view = pdfPage.getViewport?.({ scale: 1 }) || null;
    if (view?.transform?.length >= 6 && view.width > 0 && view.height > 0) return view;
  } catch { /* page not ready */ }
  return null;
}

function cacheKey(pdfPage, pageEl) {
  const fp = pdfPage.fingerprints?.[0] || pdfPage._pdfInfo?.fingerprint || "";
  const n = pageEl.getAttribute?.("data-page-number") || pdfPage.pageNumber || "";
  if (!fp && n === "") return "";
  return `${fp}:${n}`;
}

function placeOverlay(doc, canvas) {
  const parent = canvas.parentElement;
  if (!parent) return null;
  let overlay = canvas.nextElementSibling;
  if (!overlay?.classList?.contains("pxd-pdf-photo")) {
    overlay = doc.createElement("canvas");
    overlay.className = "pxd-pdf-photo";
    try { overlay.setAttribute("aria-hidden", "true"); } catch { /* stub */ }
    const style = overlay.style;
    if (style) {
      style.position = "absolute";
      style.left = "0";
      style.top = "0";
      style.width = "100%";
      style.height = "100%";
      style.pointerEvents = "none";
      style.filter = "none";
    }
    if (canvas.nextElementSibling) parent.insertBefore(overlay, canvas.nextElementSibling);
    else parent.append(overlay);
  }
  return overlay;
}

function drawPhotos(canvas, overlay, fracs) {
  const w = Number(canvas.width) || 0;
  const h = Number(canvas.height) || 0;
  overlay.width = w;
  overlay.height = h;
  const ctx = overlay.getContext?.("2d");
  if (!ctx || typeof ctx.drawImage !== "function") return false;
  try { ctx.clearRect?.(0, 0, w, h); } catch { /* stub */ }
  let drew = false;
  for (const frac of fracs) {
    const sx = frac[0] * w;
    const sy = frac[1] * h;
    const sw = frac[2] * w;
    const sh = frac[3] * h;
    if (!(sw > 0) || !(sh > 0)) continue;
    ctx.drawImage(canvas, sx, sy, sw, sh, sx, sy, sw, sh);
    drew = true;
  }
  return drew;
}

export function installPdfPhotoRestore(doc) {
  if (!doc?.body || typeof MutationObserver !== "function") return () => {};
  const prior = installed.get(doc);
  if (prior) return prior;
  const seen = new WeakMap();
  const inflight = new WeakSet();
  const cache = new Map();
  let gen = 0;

  const paint = async (canvas, page, sizeKey) => {
    const ticket = gen;
    const pdfPage = pdfPageOf(page);
    if (!pdfPage) return;
    inflight.add(canvas);
    try {
      const key = cacheKey(pdfPage, page);
      let fracs = key && cache.has(key) ? cache.get(key) : null;
      if (!fracs) {
        const list = await pdfPage.getOperatorList();
        if (ticket !== gen) return;
        const view = viewportOf(pdfPage);
        const width = view?.width || 0;
        const height = view?.height || 0;
        const transform = view?.transform || [1, 0, 0, -1, 0, height];
        fracs = photoFracs(list, { transform, width, height });
        if (key) cache.set(key, fracs);
      }
      if (ticket !== gen) return;
      if (!fracs.length) {
        seen.set(canvas, sizeKey);
        return;
      }
      const overlay = placeOverlay(doc, canvas);
      if (!overlay || ticket !== gen) {
        overlay?.remove?.();
        return;
      }
      const drew = drawPhotos(canvas, overlay, fracs);
      if (ticket !== gen || !drew) {
        overlay.remove?.();
        return;
      }
      seen.set(canvas, sizeKey);
    } catch {
      /* operator list can fail while the page is still opening */
    } finally {
      inflight.delete(canvas);
    }
  };

  const queuePaint = (canvas) => {
    if (!canvas || canvas.nodeType !== 1 || canvas.classList?.contains("pxd-pdf-photo")) return;
    const w = Number(canvas.width) || 0;
    const h = Number(canvas.height) || 0;
    if (w < 1 || h < 1) return;
    const page = canvas.closest?.(".page");
    const box = canvas.closest?.(".rm-pdf-container");
    if (!page || !box || !shouldRestoreContainer(box)) return;
    const sizeKey = `${w}x${h}`;
    if (seen.get(canvas) === sizeKey || inflight.has(canvas)) return;
    void paint(canvas, page, sizeKey);
  };

  const consider = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (String(node.tagName || "").toUpperCase() === "CANVAS") queuePaint(node);
    const nested = node.querySelectorAll?.("canvas") || [];
    for (const canvas of nested) queuePaint(canvas);
  };

  const obs = new MutationObserver((records) => {
    for (const rec of records) {
      const nodes = rec.addedNodes || [];
      for (const node of nodes) consider(node);
    }
  });

  const stop = () => {
    gen += 1;
    installed.delete(doc);
    try { obs.disconnect(); } catch { /* already gone */ }
    const photos = doc.querySelectorAll?.(".pxd-pdf-photo") || [];
    for (const node of [...photos]) {
      try { node.remove?.(); } catch { /* already gone */ }
    }
  };

  try {
    const existing = doc.querySelectorAll?.("canvas") || [];
    for (const canvas of existing) consider(canvas);
    obs.observe(doc.body, { childList: true, subtree: true });
  } catch {
    return () => {};
  }
  installed.set(doc, stop);
  return stop;
}
