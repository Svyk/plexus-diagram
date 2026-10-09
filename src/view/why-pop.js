// MEM-2. One field at a time: the label, or the why. Enter saves both values. Shift+Enter breaks the why line.

import { placePopover } from "../relchips.js";

const openPops = new Set();

function focusEl(el) {
  if (!el || typeof el.focus !== "function" || el.isConnected === false) return;
  try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch { /* gone */ } }
}

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

  const showWhy = focus === "why";
  const hint = doc.createElement("div");
  hint.className = "pxd-why__hint";
  hint.textContent = showWhy ? "Enter saves. Shift+Enter adds a line." : "Enter saves.";

  // The other field stays in memory so a save does not wipe the value that is not on screen.
  pop.append(showWhy ? whyField : labelField, hint);
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
      focusEl(opener);
      return;
    }
    if (event.key === "ArrowDown" && event.target === labelField && whyField.isConnected === true) {
      event.preventDefault();
      focusEl(whyField);
      return;
    }
    if (event.key === "ArrowUp" && event.target === whyField && labelField.isConnected === true) {
      let start = 0;
      try { start = whyField.selectionStart; } catch { start = 0; }
      if (start == null || start === 0) {
        event.preventDefault();
        focusEl(labelField);
      }
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
  const prior = doc.activeElement;
  const opener = prior && prior !== doc.body && prior !== doc.documentElement && !pop.contains(prior) ? prior : null;
  const field = focus === "why" ? whyField : labelField;
  try { field.focus(); } catch { /* stub */ }
  const closer = () => close(false);
  popCloser.set(pop, closer);
  return { el: pop, close: closer };
}
