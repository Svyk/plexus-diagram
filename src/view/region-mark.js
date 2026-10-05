// REG-2. Drag a rectangle on one image. Confirm reports the fraction; the caller writes.

import { fracFromDrag } from "../model/image-region.js";

const inBar = (node, bar) => Boolean(bar?.contains?.(node));

const axis = (rect, primary, fallback) => {
  const n = rect?.[primary];
  if (typeof n === "number" && Number.isFinite(n)) return n;
  const m = rect?.[fallback];
  return typeof m === "number" && Number.isFinite(m) ? m : 0;
};

export function mountRegionMark({ doc = globalThis.document, root, img, onConfirm, onCancel } = {}) {
  const noop = { destroy() {} };
  if (!doc || !root || !img || typeof root.append !== "function") return noop;

  const layer = doc.createElement("div");
  layer.className = "pxd-region-layer";
  const draft = doc.createElement("div");
  draft.className = "pxd-region-draft";
  const bar = doc.createElement("div");
  bar.className = "pxd-region-bar";
  const input = doc.createElement("input");
  input.className = "pxd-region-caption";
  input.type = "text";
  input.maxLength = 80;
  input.setAttribute("aria-label", "Caption");
  const button = doc.createElement("button");
  button.className = "pxd-region-confirm";
  button.type = "button";
  button.setAttribute("aria-label", "Confirm");
  button.textContent = "Confirm";
  bar.append(input, button);
  layer.append(draft, bar);
  root.append(layer);

  let dead = false;
  let dragging = false;
  // The drag is kept as fractions of the image, so a scroll, pan or zoom before Confirm cannot shift it.
  let x0 = null;
  let y0 = null;
  let x1 = null;
  let y1 = null;
  const offs = [];

  const imgBox = () => {
    let box = null;
    try { box = img.getBoundingClientRect(); } catch { box = null; }
    return { left: axis(box, "left", "x"), top: axis(box, "top", "y"), w: axis(box, "width", "w"), h: axis(box, "height", "h") };
  };
  const fx = (clientX, box) => (box.w > 0 ? (clientX - box.left) / box.w : 0);
  const fy = (clientY, box) => (box.h > 0 ? (clientY - box.top) / box.h : 0);

  const listen = (target, type, fn, opts) => {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };

  const place = () => {
    const box = imgBox();
    const rootBox = root.getBoundingClientRect();
    const imgLeft = box.left;
    const imgTop = box.top;
    const rootLeft = axis(rootBox, "left", "x");
    const rootTop = axis(rootBox, "top", "y");
    const px = (n) => Math.round(n * 1e6) / 1e6;
    const ax = px((x0 ?? 0) * box.w);
    const ay = px((y0 ?? 0) * box.h);
    const bx = px((x1 ?? x0 ?? 0) * box.w);
    const by = px((y1 ?? y0 ?? 0) * box.h);
    const left = (imgLeft - rootLeft) + Math.min(ax, bx);
    const top = (imgTop - rootTop) + Math.min(ay, by);
    draft.style.left = `${left}px`;
    draft.style.top = `${top}px`;
    draft.style.width = `${Math.abs(bx - ax)}px`;
    draft.style.height = `${Math.abs(by - ay)}px`;
    bar.style.left = `${left}px`;
    bar.style.top = `${top + Math.abs(by - ay) + 4}px`;
  };

  const destroy = () => {
    if (dead) return;
    dead = true;
    dragging = false;
    offs.splice(0).forEach((off) => { try { off(); } catch { /* already gone */ } });
    layer.remove();
  };

  const confirm = () => {
    if (dead) return;
    const box = imgBox();
    const client = (f, origin, size) => (f == null ? null : origin + f * size);
    const frac = fracFromDrag(
      { left: box.left, top: box.top, width: box.w, height: box.h },
      client(x0, box.left, box.w), client(y0, box.top, box.h), client(x1, box.left, box.w), client(y1, box.top, box.h),
    );
    if (!frac) return;
    const caption = String(input.value ?? "");
    try { onConfirm?.({ frac, caption }); }
    finally { destroy(); }
  };

  const cancel = () => {
    if (dead) return;
    destroy();
    onCancel?.();
  };

  const onPointerDown = (event) => {
    event.stopPropagation();
    if (inBar(event.target, bar)) return;
    event.preventDefault();
    if (event.button != null && event.button !== 0) return;
    dragging = true;
    const box = imgBox();
    x0 = fx(event.clientX, box);
    y0 = fy(event.clientY, box);
    x1 = x0;
    y1 = y0;
    place();
  };

  const onMouseDown = (event) => {
    event.stopPropagation();
    if (inBar(event.target, bar)) return;
    event.preventDefault();
  };

  const onMove = (event) => {
    if (!dragging) return;
    const box = imgBox();
    x1 = fx(event.clientX, box);
    y1 = fy(event.clientY, box);
    place();
  };

  const onUp = (event) => {
    if (!dragging) return;
    dragging = false;
    const box = imgBox();
    x1 = fx(event.clientX, box);
    y1 = fy(event.clientY, box);
    place();
    try { input.focus(); } catch { /* stub */ }
  };

  const onKey = (event) => {
    if (dead) return;
    if (event.key === "Escape") {
      event.preventDefault?.();
      event.stopPropagation?.();
      cancel();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault?.();
      event.stopPropagation?.();
      confirm();
    }
  };

  listen(layer, "pointerdown", onPointerDown);
  listen(layer, "mousedown", onMouseDown);
  listen(doc, "pointermove", onMove);
  listen(doc, "pointerup", onUp);
  listen(doc, "keydown", onKey);
  const win = doc.defaultView;
  if (win && win !== doc) listen(win, "keydown", onKey, true);
  listen(button, "click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    confirm();
  });
  place();
  return { destroy };
}
