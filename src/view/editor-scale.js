// The world is a CSS transform. Chrome then places a textarea caret as if that
// transform were absent, and the glyphs are a bitmap blown up by the zoom.
// Lay the editor out at screen size and counter-scale it so the net scale is 1:
// a click's local x matches the letter, and the text is painted at screen pixels.

const nearOne = (z) => Math.abs(z - 1) < 0.001;

// Rest text is not transformed. The world scale is the zoom, body font is 13px
// (14px on a block-look card), and .pxd-item__string is line-height 1.4.
// Screen size is that CSS size times zoom. The editor's net scale is 1, so its
// font and line-height have to be the screen size in px or the glyphs disagree.
export const REST_FONT_PX = 13;
export const REST_LINE = 1.4;

export function restCounterScale(zoom, cssFont = REST_FONT_PX, lineRatio = REST_LINE) {
  const z = Number(zoom);
  const scale = z > 0 && Number.isFinite(z) ? z : 1;
  const font = Number(cssFont);
  const base = font > 0 && Number.isFinite(font) ? font : REST_FONT_PX;
  const ratio = Number(lineRatio);
  const line = ratio > 0 && Number.isFinite(ratio) ? ratio : REST_LINE;
  return { z: scale, screenFont: base * scale, screenLine: base * line * scale };
}

export function editorCounterScale(zoom, baseFont = 14) {
  const z = Number(zoom);
  if (!(z > 0) || !Number.isFinite(z) || nearOne(z)) return null;
  const font = Number(baseFont);
  const base = font > 0 && Number.isFinite(font) ? font : 14;
  return {
    z,
    width: `${z * 100}%`,
    height: `${z * 100}%`,
    transform: `scale(${1 / z})`,
    fontPx: base * z,
    linePx: base * REST_LINE * z,
  };
}

const paint = (style, name, value) => {
  if (!style) return;
  if (value) style.setProperty?.(name, value);
  else style.removeProperty?.(name);
};

export function applyEditorCounterScale(editor, zoom, baseFont = 14, paintLine = false) {
  const style = editor?.style;
  if (!style?.setProperty) return false;
  const next = editorCounterScale(zoom, baseFont);
  const body = editor.parentElement;
  if (!next) {
    for (const name of ["position", "left", "top", "width", "height", "transform", "transform-origin"]) paint(style, name, "");
    style.removeProperty?.("--pxd-ed-z");
    for (const node of editor.querySelectorAll?.("textarea, .rm-block__input") || []) {
      node.style?.removeProperty?.("font-size");
      node.style?.removeProperty?.("line-height");
      node.style?.removeProperty?.("height");
    }
    if (body?.dataset?.pxdScreen === "1" && body.style) {
      body.style.position = "";
      delete body.dataset.pxdScreen;
    }
    return false;
  }
  if (body?.style) {
    body.style.position = "relative";
    if (body.dataset) body.dataset.pxdScreen = "1";
  }
  paint(style, "position", "absolute");
  paint(style, "left", "0");
  paint(style, "top", "0");
  paint(style, "width", next.width);
  paint(style, "height", next.height);
  paint(style, "transform", next.transform);
  paint(style, "transform-origin", "top left");
  style.setProperty("--pxd-ed-z", String(next.z));
  const font = `${next.fontPx}px`;
  const line = `${next.linePx}px`;
  // Roam pins the textarea height in px at the unscaled font. An important auto
  // height lets the line box follow the screen font, or the glyphs stay clipped.
  // The transform stays on the editor. The textarea is not scaled on its own:
  // Roam Caret reads rect.width / offsetWidth and that ratio has to be 1.
  for (const node of editor.querySelectorAll?.("textarea, .rm-block__input") || []) {
    node.style?.setProperty?.("font-size", font, "important");
    if (paintLine) node.style?.setProperty?.("line-height", line, "important");
    node.style?.setProperty?.("height", "auto", "important");
    // A one-row textarea at height auto is one line tall; field-sizing (Chromium 123+, Roam Desktop is 140)
    // sizes it to its text, so a wrapped note keeps all its lines while editing.
    if (node.tagName === "TEXTAREA") node.style?.setProperty?.("field-sizing", "content", "important");
  }
  return true;
}
