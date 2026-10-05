// MEM-2. Label and why in one popover. Enter saves both. Shift+Enter breaks the why line.

import { placePopover } from "../relchips.js";

const openPops = new Set();

function darkDoc(doc) {
  return Boolean(doc.querySelector?.(".bp3-dark, .bt-theme-dark, .rm-dark-theme, body.roam-body.dark"));
}

// Unload calls this. A pop lives on document.body, so removing the board root does not remove it.
const popCloser = new WeakMap();

export function closeOpenWhyPopovers() {
  for (const pop of [...openPops]) {
    const closer = popCloser.get(pop);
    if (closer) closer();
    else {
      openPops.delete(pop);
      try { pop.remove(); } catch { /* already gone */ }
    }
  }
}

export function openWhyPopover({
  doc = globalThis.document,
  anchor,
  label = "",
  why = "",
  focus = "label",
  onSave,
  onCancel,
} = {}) {
  const pop = doc.createElement("div");
  pop.className = "pxd-why pxd-root";
  if (darkDoc(doc)) pop.classList.add("pxd-root--dark");
  pop.style.position = "fixed";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Edit connection");

  const labelField = doc.createElement("input");
  labelField.className = "pxd-why__label";
  labelField.type = "text";
  labelField.value = label;
  labelField.setAttribute("aria-label", "Label");

  const whyField = doc.createElement("textarea");
  whyField.className = "pxd-why__note";
  whyField.value = why;
  whyField.setAttribute("aria-label", "Why");

  const hint = doc.createElement("div");
  hint.className = "pxd-why__hint";
  hint.textContent = "Enter saves. Shift+Enter adds a line.";

  pop.append(labelField, whyField, hint);
  openPops.add(pop);
  const offs = [];
  const on = (el, type, fn) => {
    el.addEventListener(type, fn);
    offs.push(() => el.removeEventListener(type, fn));
  };
  let closed = false;
  const close = (save) => {
    if (closed) return;
    closed = true;
    openPops.delete(pop);
    const next = { label: labelField.value, why: whyField.value };
    offs.splice(0).forEach((off) => { try { off(); } catch { /* already off */ } });
    try { pop.remove(); } catch { /* already gone */ }
    if (save) onSave?.(next);
    else onCancel?.();
  };
  on(pop, "pointerdown", (event) => event.stopPropagation());
  on(pop, "keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(false);
      return;
    }
    if (event.key !== "Enter" || event.target !== whyField) return;
    if (event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  });
  on(labelField, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  });

  doc.body?.append(pop);
  const box = anchor || { left: 16, top: 16, right: 48, bottom: 40 };
  const view = doc.defaultView || globalThis;
  const placed = placePopover({
    anchor: box,
    size: { w: 280, h: 140 },
    viewport: { left: 0, top: 0, right: view.innerWidth || 800, bottom: view.innerHeight || 600 },
  });
  pop.style.left = `${placed.left}px`;
  pop.style.top = `${placed.top}px`;
  const field = focus === "why" ? whyField : labelField;
  try { field.focus(); } catch { /* stub */ }
  const closer = () => close(false);
  popCloser.set(pop, closer);
  return { el: pop, close: closer };
}
