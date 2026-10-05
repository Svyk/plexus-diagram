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
  let x0 = null;
  let y0 = null;
  let x1 = null;
  let y1 = null;
  const offs = [];

  const listen = (target, type, fn, opts) => {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };

  const place = () => {
    const imgBox = img.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    const imgLeft = axis(imgBox, "left", "x");
    const imgTop = axis(imgBox, "top", "y");
    const rootLeft = axis(rootBox, "left", "x");
    const rootTop = axis(rootBox, "top", "y");
    const ax = (x0 ?? imgLeft) - imgLeft;
    const ay = (y0 ?? imgTop) - imgTop;
    const bx = (x1 ?? x0 ?? imgLeft) - imgLeft;
    const by = (y1 ?? y0 ?? imgTop) - imgTop;
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
    let rect = null;
    try { rect = img.getBoundingClientRect(); } catch { rect = null; }
    const frac = fracFromDrag(rect, x0, y0, x1, y1);
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
    x0 = event.clientX;
    y0 = event.clientY;
    x1 = event.clientX;
    y1 = event.clientY;
    place();
  };

  const onMouseDown = (event) => {
    event.stopPropagation();
    if (inBar(event.target, bar)) return;
    event.preventDefault();
  };

  const onMove = (event) => {
    if (!dragging) return;
    x1 = event.clientX;
    y1 = event.clientY;
    place();
  };

  const onUp = (event) => {
    if (!dragging) return;
    dragging = false;
    x1 = event.clientX;
    y1 = event.clientY;
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
