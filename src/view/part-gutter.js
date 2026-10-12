// Per-part gutter: a small vertical pill (Ask AI over a Copy | ▾ split button; ▾ opens the copy menu) beside the parsed part under the pointer or the
// keyboard focus. One element per pane, moved with a transform; built on first use. It shows after a short
// hover intent, fades in, stays while the pointer travels onto it, and hides when the pointer leaves both.
// No setPointerCapture, no graph writes; the host callbacks do the work.

import { askAiIcon, copyIcon } from "./ask-icon.js";

export const GUTTER = Object.freeze({ button: 24, gap: 6, pad: 2, intentMs: 120, hideMs: 160, copiedMs: 1200 });
// The pill: two 24 px buttons and the 12 px copy-menu arrow, 2 px apart, inside a 2 px border.
export const GUTTER_CARET = 12;
export const GUTTER_W = GUTTER.button + 4;
export const GUTTER_H = GUTTER.button * 2 + GUTTER_CARET + 8;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Pure. Where the pill goes, in client px. box: the part's client rect; host: the visible area it must stay in.
// side "left" hangs it GUTTER.gap outside the part's left edge (inside the part when that falls off the area);
// side "right" tucks it inside the part's right edge (outline rows keep their drag handle on the left).
// The top lines up with the part's top and is clamped to the area.
export function gutterSpot(box, host, { w = GUTTER_W, h = GUTTER_H, gap = GUTTER.gap, pad = GUTTER.pad, side = "left" } = {}) {
  const left = num(box?.left);
  const top = num(box?.top);
  const right = num(box?.right, left + num(box?.width));
  const bottom = num(box?.bottom, top + num(box?.height));
  const hl = num(host?.left);
  const ht = num(host?.top);
  const hr = num(host?.right, hl + num(host?.width));
  const hb = num(host?.bottom, ht + num(host?.height));
  let x = side === "right" ? right - w - gap : left - gap - w;
  let inside = side === "right";
  const minX = hl + pad;
  const maxX = Math.max(minX, hr - w - pad);
  if (x < minX) { x = minX; inside = true; }
  if (x > maxX) x = maxX;
  const minY = ht + pad;
  const maxY = Math.max(minY, hb - h - pad);
  const y = Math.max(minY, Math.min(maxY, top));
  return { x, y, inside, visible: bottom > ht && top < hb && right > hl && left < hr };
}

export function createPartGutter({
  doc,
  mount,
  onAsk = null,
  onCopy = null,
  onMenu = null,
  timing = GUTTER,
} = {}) {
  const win = () => doc?.defaultView || null;
  const later = (fn, ms) => (win()?.setTimeout || setTimeout)(fn, ms);
  const unlater = (id) => { if (id != null) (win()?.clearTimeout || clearTimeout)(id); };
  const bound = [];
  const on = (node, type, fn, capture = false) => {
    if (!node?.addEventListener) return;
    node.addEventListener(type, fn, capture);
    bound.push([node, type, fn, capture]);
  };
  let pill = null;
  let askBtn = null;
  let copyBtn = null;
  let moreBtn = null;
  let block = null;
  let pendingBlock = null;
  let showTimer = null;
  let hideTimer = null;
  let copiedTimer = null;
  let shown = false;
  let over = false;
  let disposed = false;
  let placedKey = "";

  const stopShow = () => { unlater(showTimer); showTimer = null; pendingBlock = null; };
  // While the pill is up, any scroll in the document (the part's own scroller, wherever it sits) hides it: the part
  // moved and the pill would stay behind. Armed only while shown.
  let scrollArmed = false;
  const onAnyScroll = () => hideNow();
  const armScroll = (on) => {
    if (on === scrollArmed || !doc?.addEventListener) return;
    scrollArmed = on;
    if (on) doc.addEventListener("scroll", onAnyScroll, true);
    else doc.removeEventListener?.("scroll", onAnyScroll, true);
  };
  const stopHide = () => { unlater(hideTimer); hideTimer = null; };

  const stop = (event) => { event.stopPropagation?.(); };
  const build = () => {
    if (pill || !doc || !mount) return pill;
    pill = doc.createElement("div");
    pill.className = "pxd-pgutter";
    pill.setAttribute("role", "toolbar");
    pill.setAttribute("aria-label", "Part actions");
    pill.setAttribute("aria-hidden", "true");
    askBtn = doc.createElement("button");
    askBtn.type = "button";
    askBtn.className = "pxd-pgutter__btn pxd-pgutter__ask pxd-chrome";
    askBtn.setAttribute("aria-label", "Ask AI about this part (Shift-click: add to question)");
    askBtn.setAttribute("data-tip", "gutter.ask");
    askBtn.tabIndex = -1;
    const ai = askAiIcon(doc, 16);
    if (ai) askBtn.append(ai);
    copyBtn = doc.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "pxd-pgutter__btn pxd-pgutter__copy pxd-chrome";
    copyBtn.setAttribute("aria-label", "Copy");
    copyBtn.setAttribute("data-tip", "gutter.copy");
    copyBtn.tabIndex = -1;
    const cp = copyIcon(doc, 16);
    if (cp) copyBtn.append(cp);
    moreBtn = doc.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "pxd-pgutter__btn pxd-pgutter__more pxd-chrome";
    moreBtn.setAttribute("aria-label", "Copy as…");
    moreBtn.setAttribute("aria-haspopup", "menu");
    moreBtn.setAttribute("data-tip", "gutter.copy-more");
    moreBtn.tabIndex = -1;
    moreBtn.textContent = "▾";
    pill.append(askBtn, copyBtn, moreBtn);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) {
      on(pill, type, (event) => { stop(event); if (type !== "dblclick") event.preventDefault?.(); });
    }
    on(pill, "pointerenter", () => { over = true; stopHide(); });
    on(pill, "pointerleave", () => { over = false; hideSoon(); });
    on(pill, "focusout", (event) => { if (!pill?.contains?.(event?.relatedTarget)) hideSoon(); });
    on(askBtn, "click", (event) => {
      stop(event);
      event.preventDefault?.();
      const target = block;
      if (!target) return;
      try { onAsk?.(target, { shift: Boolean(event.shiftKey) }); } catch { /* host */ }
    });
    on(copyBtn, "click", (event) => {
      stop(event);
      event.preventDefault?.();
      const target = block;
      if (!target) return;
      let result;
      try { result = onCopy?.(target); } catch { result = false; }
      if (result && typeof result.then === "function") void result.then((ok) => markCopied(ok !== false), () => markCopied(false));
      else markCopied(result !== false);
    });
    on(copyBtn, "contextmenu", (event) => {
      if (typeof onMenu !== "function" || !block) return;
      stop(event);
      event.preventDefault?.();
      try { onMenu(block, copyBtn); } catch { /* menu */ }
    });
    // The split button's arrow: the copy menu with every format, under the arrow. From the keyboard (Enter, Space,
    // ArrowDown) the menu's first item takes the focus.
    const openMenu = (event, fromKey) => {
      stop(event);
      event.preventDefault?.();
      if (typeof onMenu !== "function" || !block) return;
      try { onMenu(block, moreBtn); } catch { /* menu */ }
      if (!fromKey) return;
      const first = doc.querySelector?.(".pxd-copy-menu .pxd-copy-menu__item");
      try { first?.focus?.(); } catch { /* menu */ }
    };
    on(moreBtn, "click", (event) => openMenu(event, event.detail === 0));
    on(moreBtn, "keydown", (event) => { if (event.key === "ArrowDown") openMenu(event, true); });
    mount.append(pill);
    return pill;
  };

  function markCopied(ok) {
    if (!copyBtn) return;
    unlater(copiedTimer);
    copyBtn.classList.toggle("pxd-pgutter__copy--done", ok);
    copyBtn.classList.toggle("pxd-pgutter__copy--fail", !ok);
    copyBtn.setAttribute("aria-label", ok ? "Copied" : "Could not copy");
    copiedTimer = later(() => {
      copiedTimer = null;
      copyBtn?.classList.remove("pxd-pgutter__copy--done", "pxd-pgutter__copy--fail");
      copyBtn?.setAttribute("aria-label", "Copy");
    }, timing.copiedMs);
  }

  const place = (rect, opts) => {
    if (!build()) return false;
    const host = opts?.host || mount.getBoundingClientRect?.() || null;
    const spot = gutterSpot(rect, host, { side: opts?.side || "left" });
    if (!spot.visible) return false;
    let origin = null;
    try { origin = mount.getBoundingClientRect?.() || null; } catch { origin = null; }
    const x = Math.round(spot.x - num(origin?.left));
    const y = Math.round(spot.y - num(origin?.top));
    pill.style.transform = `translate(${x}px, ${y}px)`;
    placedKey = `${Math.round(num(rect.left))},${Math.round(num(rect.top))},${Math.round(num(rect.right))},${Math.round(num(rect.bottom))}`;
    pill.classList.toggle("pxd-pgutter--inside", spot.inside);
    return true;
  };

  const reveal = (target, rect, opts) => {
    stopShow();
    if (disposed) return;
    if (!place(rect, opts)) { hideNow(); return; }
    block = target;
    pill.setAttribute("data-block", target?.id || "");
    pill.setAttribute("aria-hidden", "false");
    askBtn.tabIndex = 0;
    copyBtn.tabIndex = 0;
    moreBtn.tabIndex = typeof onMenu === "function" ? 0 : -1;
    moreBtn.hidden = typeof onMenu !== "function";
    pill.classList.add("pxd-pgutter--show");
    shown = true;
    armScroll(true);
  };

  function hideNow() {
    stopShow();
    stopHide();
    armScroll(false);
    shown = false;
    over = false;
    block = null;
    if (!pill) return;
    pill.classList.remove("pxd-pgutter--show");
    pill.setAttribute("aria-hidden", "true");
    pill.removeAttribute("data-block");
    if (askBtn) askBtn.tabIndex = -1;
    if (copyBtn) copyBtn.tabIndex = -1;
    if (moreBtn) moreBtn.tabIndex = -1;
  }

  function hideSoon() {
    stopShow();
    if (!shown || over || hideTimer != null) return;
    hideTimer = later(() => { hideTimer = null; if (!over) hideNow(); }, timing.hideMs);
  }

  return {
    // A part is under the pointer (or focused). rect: its client rect. opts: { host, side, immediate }.
    intent(target, rect, opts = {}) {
      if (disposed || !target || !rect) return;
      stopHide();
      if (shown && block?.id === target.id) {
        const key = `${Math.round(num(rect.left))},${Math.round(num(rect.top))},${Math.round(num(rect.right))},${Math.round(num(rect.bottom))}`;
        if (key !== placedKey) { placedKey = key; place(rect, opts); }
        return;
      }
      // Moving from one part to the next while the pill is up follows at once; a fresh hover waits for intent.
      if (shown || opts.immediate) { reveal(target, rect, opts); return; }
      if (pendingBlock?.id === target.id && showTimer != null) return;
      stopShow();
      pendingBlock = target;
      showTimer = later(() => { showTimer = null; const t = pendingBlock; pendingBlock = null; if (t) reveal(t, rect, opts); }, timing.intentMs);
    },
    leave: () => hideSoon(),
    hide: () => hideNow(),
    contains: (node) => Boolean(pill && node && pill.contains?.(node)),
    current: () => (shown ? block : null),
    element: () => pill,
    dispose() {
      disposed = true;
      hideNow();
      unlater(copiedTimer);
      copiedTimer = null;
      while (bound.length) {
        const [node, type, fn, capture] = bound.pop();
        try { node.removeEventListener(type, fn, capture); } catch { /* gone */ }
      }
      try { pill?.remove?.(); } catch { /* gone */ }
      pill = null;
      askBtn = null;
      copyBtn = null;
      moreBtn = null;
    },
  };
}
