// Native 13 swatches, a darker row, a lighter row, hex entry, and the 1.2 named colors.
// Named picks store the palette name. Everything else stores lowercase hex.

import { NATIVE_SWATCHES, PALETTE, hexColor, shadeHex } from "../model/schema.js";

const DARKER = -0.28;
const LIGHTER = 0.4;

export function buildColorPicker(doc, onPick, listen) {
  const box = doc.createElement("div");
  box.className = "pxd-picker";
  const on = (node, type, fn) => {
    if (listen) listen(node, type, fn);
    else node.addEventListener(type, fn);
  };
  const stop = (event) => { event.preventDefault?.(); event.stopPropagation?.(); };

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
      b.title = color;
      b.setAttribute("aria-label", color);
      b.setAttribute("data-color", color);
      if (!named) b.style.background = color;
      on(b, "click", (event) => { stop(event); onPick?.(color); });
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
