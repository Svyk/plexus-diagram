// RE-2: popovers, the child peek and card menus stay clear of board chrome. The obstacles are the visible dock,
// board bar, rail, minimap, Properties panel and side panel; placement is the PO-3 placer with those rects.

import { placePopover } from "../relchips.js";

export const CHROME_SELECTOR = ".pxd-toolbar, .pxd-dock, .pxd-rail, .pxd-minimap, .pxd-props, .pxd-panel";

const visible = (node, win) => {
  if (!node || node.hidden || node.style?.display === "none") return false;
  try {
    const style = win?.getComputedStyle?.(node);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  } catch { /* no computed style */ }
  return true;
};

// Viewport rects of the chrome that is on screen right now. `skip` leaves out nodes that hold the anchor itself
// (a popover opened from the dock may sit over the dock's own button, never over its neighbours).
export function chromeObstacles(root, { win = root?.ownerDocument?.defaultView, skip = null } = {}) {
  const out = [];
  let nodes = [];
  try { nodes = [...(root?.querySelectorAll?.(CHROME_SELECTOR) || [])]; } catch { nodes = []; }
  for (const node of nodes) {
    if (skip && (node === skip || node.contains?.(skip))) continue;
    if (!visible(node, win)) continue;
    const r = node.getBoundingClientRect?.();
    if (!r || !(r.right > r.left) || !(r.bottom > r.top)) continue;
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return out;
}

// Puts `node` (absolute inside `root`) beside the viewport rect `anchor`. Returns the placement.
// `origin` is the positioned ancestor the left/top are measured from (default: the root).
export function placeNearAnchor(node, anchor, root, { gap = 6, skip = null, origin = root, win = root?.ownerDocument?.defaultView } = {}) {
  const r = root?.getBoundingClientRect?.();
  const o = origin?.getBoundingClientRect?.() || r;
  if (!node || !anchor || !r) return null;
  node.style.maxHeight = "";
  node.style.overflowY = "";
  const size = { w: Number(node.offsetWidth) || 180, h: Number(node.offsetHeight) || 120 };
  const at = placePopover({
    anchor,
    size,
    viewport: { left: r.left, top: r.top, right: r.right || r.left + size.w, bottom: r.bottom || r.top + size.h },
    gap,
    obstacles: chromeObstacles(root, { win, skip }),
  });
  node.style.left = `${Math.round(at.left - o.left)}px`;
  node.style.top = `${Math.round(at.top - o.top)}px`;
  if (at.maxHeight) {
    node.style.maxHeight = `${at.maxHeight}px`;
    node.style.overflowY = "auto";
  }
  return at;
}

export const pointAnchor = (x, y) => ({ left: x, top: y, right: x + 1, bottom: y + 1 });
