// Fullscreen placement, ported from 0.6 canvas.js:66-190. The board fills the article pane:
// below `.rm-topbar`, to the right of the left sidebar, left of the right sidebar. Observers
// follow sidebar animation; `body.pxd-has-fullscreen` hides the RoamJS breadcrumbs (CSS).

import { routeLeftZoomedDiagram } from "../discovery.js";
import { notedSpeedFlags } from "../settings.js";

const SIDEBAR_SELECTORS = [".roam-sidebar-container", ".rm-left-sidebar", "#roam-sidebar-container"];
const RIGHT_SIDEBAR_SELECTORS = ["#right-sidebar", ".rm-right-sidebar", "[class*=\"right-sidebar\"]"];
const RIGHT_INSET_COLLAPSE_PX = 8;

function raf(callback) {
  const fn = globalThis.requestAnimationFrame;
  if (typeof fn === "function") {
    const id = fn(callback);
    return () => globalThis.cancelAnimationFrame?.(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}

function firstMatch(root, selectors) {
  if (!root?.querySelector) return null;
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return null;
}

export function topbarOffset(root = globalThis.document) {
  const topbar = root?.querySelector?.(".rm-topbar");
  if (!topbar?.getBoundingClientRect) return 0;
  const bottom = topbar.getBoundingClientRect().bottom;
  return Number.isFinite(bottom) ? Math.max(0, Math.round(bottom)) : 0;
}

export function sidebarOffset(root = globalThis.document) {
  const sidebar = firstMatch(root, SIDEBAR_SELECTORS);
  if (!sidebar?.getBoundingClientRect) return 0;
  const rect = sidebar.getBoundingClientRect();
  if (!(Number(rect.width) > 0)) return 0;
  const right = Number(rect.right);
  return Number.isFinite(right) ? Math.max(0, Math.round(right)) : 0;
}

export function fullscreenInsets(root = globalThis.document) {
  const topbarBottom = topbarOffset(root);
  const article = root?.querySelector?.(".rm-article-wrapper");
  if (!article?.getBoundingClientRect) return { top: topbarBottom, left: 0, right: 0, bottom: 0 };
  const rect = article.getBoundingClientRect();
  const top = Math.max(Number(rect.top) || 0, topbarBottom);
  const left = Number.isFinite(Number(rect.left)) ? Math.round(rect.left) : 0;
  const view = root.defaultView || globalThis;
  const vw = Number(view.innerWidth);
  const vh = Number(view.innerHeight);
  let right = 0;
  if (Number.isFinite(Number(rect.right)) && Number.isFinite(vw) && vw > 0) {
    const gap = vw - rect.right;
    right = gap <= RIGHT_INSET_COLLAPSE_PX ? 0 : Math.max(0, Math.round(gap));
  }
  let bottom = 0;
  if (Number.isFinite(Number(rect.bottom)) && Number.isFinite(vh) && vh > 0) bottom = Math.max(0, Math.round(vh - rect.bottom));
  return { top: Math.round(top), left, right, bottom };
}

// C2 (UX4, speed flag fsCover): `body.pxd-fs-cover` hides the article's own content under a fullscreen board
// (extension.css, native guard). Roam renders the zoomed board block's children there, and they showed through for
// about a second while the big board zoomed (zoom-slow-outline.jpg frames 18-19). The feature holds the cover while a
// fullscreen board it unmounted on its own route mounts again (Roam re-rendered the block): the gap is then the
// article background, not the outline. feature.js drops the hold (reconcile, route change, unload).
export const FS_COVER_CLASS = "pxd-fs-cover";
export const COVER_HOLD_MS = 1500;
let coverHeld = false;
const coverOn = () => { try { return notedSpeedFlags().fsCover !== false; } catch { return true; } };
const hasClass = (body, name) => Boolean(body?.classList?.contains?.(name));
const setClass = (body, name, on) => body?.classList?.toggle?.(name, Boolean(on));
function setCover(root, on) {
  const body = root?.body;
  if (!body?.classList) return;
  if (on) {
    coverHeld = false;
    if (coverOn()) setClass(body, FS_COVER_CLASS, true);
  } else if (!coverHeld) {
    setClass(body, FS_COVER_CLASS, false);
  }
}
export function holdFsCover(root, on) {
  const body = root?.body;
  if (!body?.classList) return;
  coverHeld = Boolean(on) && coverOn() && hasClass(body, FS_COVER_CLASS);
  if (!coverHeld && !hasClass(body, "pxd-has-fullscreen")) setClass(body, FS_COVER_CLASS, false);
}

// Toggle fullscreen chrome on the mount element. Returns a disposer that stops following.
export function applyFullscreenChrome(mount, on, root = globalThis.document) {
  mount?.classList?.toggle?.("pxd-mount--fullscreen", Boolean(on));
  root?.body?.classList?.toggle?.("pxd-has-fullscreen", Boolean(on));
  setCover(root, Boolean(on));
  if (!on) {
    if (mount?.style) {
      for (const k of ["top", "left", "right", "bottom", "width", "height", "minHeight"]) mount.style[k] = "";
    }
    return () => {};
  }
  let alive = true;
  const place = () => {
    if (!alive || !mount?.style) return;
    const box = fullscreenInsets(root);
    mount.style.top = `${box.top}px`;
    mount.style.left = `${box.left}px`;
    mount.style.right = `${box.right}px`;
    mount.style.bottom = `${box.bottom}px`;
    mount.style.width = "auto";
    mount.style.height = "auto";
    mount.style.minHeight = "0";
  };
  const placeAfterAnim = () => { place(); raf(() => { place(); raf(place); }); };
  const disconnects = [];
  const article = root?.querySelector?.(".rm-article-wrapper");
  const sidebar = firstMatch(root, SIDEBAR_SELECTORS);
  const rightSidebar = firstMatch(root, RIGHT_SIDEBAR_SELECTORS);
  const RO = globalThis.ResizeObserver;
  // POL-5. With a ResizeObserver the first place() runs in its first callback, after the browser's own
  // layout and before paint. A place() here would force a whole-page layout in the middle of the mount.
  let observed = false;
  if (typeof RO === "function") {
    try {
      const ro = new RO(() => place());
      // Border box: Roam narrows the article for a docked panel (Live AI's chat) through its padding, and the
      // content box stays the same width, so a default observer never fires when the panel closes.
      if (article) { ro.observe(article, { box: "border-box" }); observed = true; }
      if (sidebar) { ro.observe(sidebar); observed = true; }
      if (rightSidebar && rightSidebar !== sidebar && rightSidebar !== article) { ro.observe(rightSidebar); observed = true; }
      disconnects.push(() => ro.disconnect());
    } catch { /* stub */ }
  }
  if (!observed) place();
  const MO = globalThis.MutationObserver;
  if (typeof MO === "function" && article) {
    try {
      const mo = new MO(() => placeAfterAnim());
      mo.observe(article, { attributes: true, attributeFilter: ["class"] });
      disconnects.push(() => mo.disconnect());
    } catch { /* stub */ }
  }
  const cancel = raf(place);
  return () => {
    alive = false;
    cancel();
    disconnects.forEach((d) => d());
  };
}

// Exit fullscreen when the route leaves the zoomed board page.
export function watchRouteExit({ boardUid, onExit, win = globalThis.window } = {}) {
  if (!win?.addEventListener) return () => {};
  const check = () => {
    const hash = win.location?.hash || "";
    if (routeLeftZoomedDiagram(boardUid, hash)) onExit?.();
  };
  win.addEventListener("hashchange", check);
  win.addEventListener("popstate", check);
  return () => {
    win.removeEventListener("hashchange", check);
    win.removeEventListener("popstate", check);
  };
}
