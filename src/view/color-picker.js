// Native 13 swatches, a darker row, a lighter row, hex entry, and the 1.2 named colors.
// Named picks store the palette name. Everything else stores lowercase hex.
// Pass onTag / onGear / tagMode as a fourth options object, or as the third argument
// when that argument is not the listen function. Omitting onTag keeps onPick.

import { HIGHLIGHT_COLORS } from "../model/highlight.js";
import { NATIVE_SWATCHES, PALETTE, hexColor, shadeHex } from "../model/schema.js";

const DARKER = -0.28;
const LIGHTER = 0.4;
const TAG_NOTE = "Hex, darker, and lighter stay on the card only.";
export const HIGHLIGHT_MARK_TIP = "The card and the list follow the tag. The mark painted in the PDF may stay yellow; Roam's reader changes it.";

function pickerArgs(listen, fourth) {
  if (listen && typeof listen === "object") return { listen: undefined, options: listen };
  if (typeof fourth === "function") return { listen, options: { onTag: fourth } };
  if (fourth && typeof fourth === "object") return { listen, options: fourth };
  return { listen, options: {} };
}

export function buildColorPicker(doc, onPick, listen, fourth) {
  const args = pickerArgs(listen, fourth);
  listen = args.listen;
  const options = args.options;
  const onTag = typeof options.onTag === "function" ? options.onTag : null;
  const onGear = typeof options.onGear === "function" ? options.onGear : null;
  const onHighlight = typeof options.onHighlight === "function" ? options.onHighlight : null;
  let tagMode = options.tagMode === true && onTag != null;

  const box = doc.createElement("div");
  box.className = "pxd-picker";
  const on = (node, type, fn) => {
    if (listen) listen(node, type, fn);
    else node.addEventListener(type, fn);
  };
  const stop = (event) => { event.preventDefault?.(); event.stopPropagation?.(); };

  if (onHighlight) {
    const wrap = doc.createElement("div");
    wrap.className = "pxd-picker__row";
    const cap = doc.createElement("div");
    cap.className = "pxd-picker__cap";
    cap.textContent = "Highlight";
    wrap.append(cap);
    const swatches = doc.createElement("div");
    swatches.className = "pxd-picker__swatches";
    for (const name of HIGHLIGHT_COLORS) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = `pxd-swatch pxd-picker__swatch pxd-c-${name}`;
      b.setAttribute("data-tip", "picker.swatch");
      b.setAttribute("data-tip-extra", HIGHLIGHT_MARK_TIP);
      b.setAttribute("title", HIGHLIGHT_MARK_TIP);
      b.setAttribute("aria-label", `#h/${name}`);
      b.setAttribute("data-color", name);
      b.setAttribute("data-highlight", name);
      on(b, "click", (event) => {
        stop(event);
        onHighlight(name);
      });
      swatches.append(b);
    }
    wrap.append(swatches);
    box.append(wrap);
  }

  if (onTag) {
    const gear = doc.createElement("button");
    gear.type = "button";
    gear.className = "pxd-btn pxd-picker__gear";
    gear.textContent = "Write as highlighter tag";
    gear.setAttribute("aria-label", "Write as highlighter tag");
    gear.setAttribute("aria-pressed", tagMode ? "true" : "false");
    if (tagMode) gear.classList.add("pxd-picker__gear--on");
    const note = doc.createElement("div");
    note.className = "pxd-picker__tag-note";
    note.textContent = TAG_NOTE;
    if (!tagMode) note.setAttribute("hidden", "");
    on(gear, "click", (event) => {
      stop(event);
      tagMode = !tagMode;
      gear.classList.toggle("pxd-picker__gear--on", tagMode);
      gear.setAttribute("aria-pressed", tagMode ? "true" : "false");
      if (tagMode) note.removeAttribute("hidden");
      else note.setAttribute("hidden", "");
      onGear?.(tagMode);
    });
    box.append(gear, note);
  }

  const row = (label, colors, named) => {
    const wrap = doc.createElement("div");
    wrap.className = "pxd-picker__row";
    const cap = doc.createElement("div");
    cap.className = "pxd-picker__cap";
    cap.textContent = label;
    wrap.append(cap);
    const swatches = doc.createElement("div");
    swatches.className = "pxd-picker__swatches";
    for (const color of colors) {
      if (!color) continue;
      const b = doc.createElement("button");
      b.type = "button";
      b.className = named ? `pxd-swatch pxd-picker__swatch pxd-c-${color}` : "pxd-swatch pxd-picker__swatch";
      b.setAttribute("data-tip", "picker.swatch");
      b.setAttribute("aria-label", color);
      b.setAttribute("data-color", color);
      if (!named) b.style.background = color;
      on(b, "click", (event) => {
        stop(event);
        if (named && tagMode && onTag) onTag(color);
        else onPick?.(color);
      });
      swatches.append(b);
    }
    wrap.append(swatches);
    box.append(wrap);
  };

  row("Colors", NATIVE_SWATCHES, false);
  row("Darker", NATIVE_SWATCHES.map((h) => shadeHex(h, DARKER)), false);
  row("Lighter", NATIVE_SWATCHES.map((h) => shadeHex(h, LIGHTER)), false);

  const hexRow = doc.createElement("div");
  hexRow.className = "pxd-picker__hex";
  const preview = doc.createElement("span");
  preview.className = "pxd-picker__preview";
  const input = doc.createElement("input");
  input.type = "text";
  input.className = "pxd-input pxd-picker__input";
  input.placeholder = "#rrggbb";
  input.setAttribute("aria-label", "Hex color");
  input.spellcheck = false;
  const paint = () => {
    const hex = hexColor(input.value);
    preview.style.background = hex || "transparent";
    input.classList.toggle("pxd-picker__input--bad", input.value.trim() !== "" && !hex);
  };
  const commit = () => {
    const hex = hexColor(input.value);
    if (hex) onPick?.(hex);
  };
  on(input, "input", paint);
  on(input, "change", commit);
  on(input, "keydown", (event) => {
    event.stopPropagation?.();
    if (event.key === "Enter") { event.preventDefault?.(); commit(); }
  });
  hexRow.append(preview, input);
  box.append(hexRow);

  row("Named", PALETTE, true);

  const clear = doc.createElement("button");
  clear.type = "button";
  clear.className = "pxd-btn pxd-picker__clear";
  clear.textContent = "No color";
  clear.setAttribute("aria-label", "No color");
  on(clear, "click", (event) => { stop(event); onPick?.(null); });
  box.append(clear);
  return box;
}
