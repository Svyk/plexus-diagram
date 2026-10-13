// A transparent layer over the board's visible rect, at the top of the page, while a wheel burst or a moved pointer
// gesture runs. Chrome hit-tests the page for every wheel event, every pointer move, and after every layout under
// a still cursor (its hover update). On a long Roam page each of those walks the page in paint order: 12-15 ms on
// the PhD page, wherever the cursor is, because the board sits inside a z-index:0 stacking context and the page
// after it is tested first. A fixed layer at the top is hit first: 0.1 ms. Nothing renders in it.
export const SHIELD_CLASS = "pxd-hit-shield";
const SAFETY_MS = 1500;

export function createHitShield({ doc, root, onWheel, onPress, enabled = () => true, later } = {}) {
  let el = null;
  let up = false;
  let safety = null;
  const view = () => doc?.defaultView || globalThis;

  // Root rect clipped to the window and to every clipping ancestor (Roam's scroll pane, the sidebar).
  const visibleRect = () => {
    const r = root?.getBoundingClientRect?.();
    if (!r) return null;
    const win = view();
    let left = Math.max(0, r.left);
    let top = Math.max(0, r.top);
    let right = Math.min(win.innerWidth || r.right, r.right);
    let bottom = Math.min(win.innerHeight || r.bottom, r.bottom);
    for (let a = root.parentElement; a && a !== doc.body && a !== doc.documentElement; a = a.parentElement) {
      let cs = null;
      try { cs = win.getComputedStyle?.(a); } catch { cs = null; }
      if (!cs || (cs.overflowX === "visible" && cs.overflowY === "visible")) continue;
      const q = a.getBoundingClientRect?.();
      if (!q) continue;
      left = Math.max(left, q.left); top = Math.max(top, q.top);
      right = Math.min(right, q.right); bottom = Math.min(bottom, q.bottom);
    }
    if (right - left < 8 || bottom - top < 8) return null;
    return { left, top, width: right - left, height: bottom - top };
  };

  const clearSafety = () => {
    if (typeof safety === "function") { try { safety(); } catch { /* cleared */ } }
    else if (safety != null) clearTimeout(safety);
    safety = null;
  };
  const armSafety = () => {
    clearSafety();
    safety = typeof later === "function" ? later(() => { safety = null; drop(); }, SAFETY_MS) : setTimeout(() => { safety = null; drop(); }, SAFETY_MS);
  };

  const drop = () => {
    clearSafety();
    if (!up) return;
    up = false;
    try { el?.remove?.(); } catch { /* gone */ }
  };

  const build = () => {
    el = doc.createElement("div");
    el.className = SHIELD_CLASS;
    el.setAttribute("aria-hidden", "true");
    el.addEventListener("wheel", (event) => {
      armSafety();
      let handled = false;
      try { handled = onWheel?.(event) === true; } catch { handled = false; }
      // A wheel the board does not take must reach what is under the shield: Roam's pane scrolls from the next one.
      if (!handled) drop();
    }, { passive: false });
    // The cursor moved: the next events must reach what is under it.
    el.addEventListener("pointermove", () => drop());
    // A press during the burst goes to the element under it. Board presses are read from pointerdown; the
    // compatibility mousedown that went to the shield is the one the board cancels anyway.
    el.addEventListener("pointerdown", (event) => {
      drop();
      event.preventDefault?.();
      event.stopPropagation?.();
      let target = null;
      try { target = doc.elementFromPoint(event.clientX, event.clientY); } catch { target = null; }
      if (!target) return;
      try { onPress?.(target, event); } catch { /* the press is lost, as without the shield it would not be */ }
    });
    el.addEventListener("contextmenu", () => drop());
  };

  // Put the layer up (or keep it up) for a gesture in progress. Cheap when already up.
  const raise = () => {
    if (!enabled()) { drop(); return false; }
    if (up) { armSafety(); return true; }
    if (!doc?.body || doc.fullscreenElement) return false;
    const rect = visibleRect();
    if (!rect) return false;
    if (!el) build();
    el.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:2147483646;background:transparent;contain:strict;`;
    doc.body.append(el);
    up = true;
    armSafety();
    return true;
  };

  return { raise, drop, isUp: () => up, element: () => el };
}
