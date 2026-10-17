// C3 (UX4, speed flag scopedZoomVars). The zoom-sized CSS variables written on the board root (--pxd-inv-zoom,
// --pxd-screen-px, --pxd-map-font, --pxd-overview-font) are inherited, so each write restyled every element under the
// root, edges and labels included: ~157 ms at overview on the 1,560-card bench board (33k elements), against 55-65 ms
// for the tier flip itself. On a big board they go into one rule of a per-board stylesheet instead, set on the classes
// that read them (ZOOM_VAR_CONSUMERS; test/ux4-c-zoom.test.js lints every var() use against this list). A change to
// that rule restyles those elements and what they contain: 68 ms on the same board.
export const ZOOM_VARS = Object.freeze(["--pxd-inv-zoom", "--pxd-screen-px", "--pxd-map-font", "--pxd-overview-font"]);
export const ZOOM_VAR_CONSUMERS = Object.freeze([
  "pxd-port", "pxd-grip", "pxd-item__header", "pxd-section__title", "pxd-out", "pxd-out-menu", "pxd-out-menu__row", "pxd-edge__end",
  "pxd-hl-add", "pxd-landmark", "pxd-pdf-pills", "pxd-pdf-pill", "pxd-pmotion-head",
]);
const ZV_ATTR = "data-pxd-zv";
let seq = 0;

export function createZoomVars(doc, root) {
  let style = null;
  let rule = null;
  const id = String(++seq);
  const ensure = () => {
    if (rule) return rule;
    const host = doc?.head || doc?.body;
    if (!host || typeof doc.createElement !== "function") return null;
    root.setAttribute(ZV_ATTR, id);
    style = doc.createElement("style");
    style.setAttribute("data-pxd-zoom-vars", id);
    style.textContent = `.pxd-root[${ZV_ATTR}="${id}"] :is(${ZOOM_VAR_CONSUMERS.map((c) => `.${c}`).join(", ")}) {}`;
    host.append(style);
    rule = style.sheet?.cssRules?.[0] || null;
    if (!rule) { style.remove(); style = null; }
    return rule;
  };
  return {
    // false: no stylesheet here (the caller writes the root instead).
    set(name, value) {
      const r = ensure();
      if (!r) return false;
      r.style.setProperty(name, value);
      return true;
    },
    clear() {
      if (!rule) return;
      for (const name of ZOOM_VARS) rule.style.removeProperty(name);
    },
    dispose() {
      try { style?.remove(); } catch { /* gone */ }
      style = null;
      rule = null;
    },
  };
}
