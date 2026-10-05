// REG-3. A fixed root over one outline image. mountRegionMark draws the rectangle.

import { mountRegionMark } from "./region-mark.js";

export const OUTLINE_TOAST = {
  ready: "The image is not ready",
  copied: "Region made, ref copied",
  notImage: "That block is not an image",
  failed: "The region was not saved",
};

export function outlineToast(doc, message) {
  if (!doc?.body || !message) return () => {};
  const node = doc.createElement("div");
  node.className = "pxd-outline-toast";
  node.setAttribute("role", "status");
  node.textContent = message;
  const dark = doc.documentElement?.classList?.contains?.("bp3-dark");
  node.style.position = "fixed";
  node.style.left = "16px";
  node.style.bottom = "16px";
  node.style.zIndex = "90";
  node.style.padding = "6px 8px";
  node.style.border = `1px solid ${dark ? "#fff" : "#1f2937"}`;
  node.style.background = "transparent";
  node.style.boxShadow = "none";
  node.style.color = "inherit";
  doc.body.append(node);
  const timer = globalThis.setTimeout(() => node.remove(), 2400);
  return () => {
    globalThis.clearTimeout(timer);
    node.remove();
  };
}

function placeRoot(root, img) {
  const box = img.getBoundingClientRect();
  const style = root.style;
  style.position = "fixed";
  style.left = `${box.left}px`;
  style.top = `${box.top}px`;
  style.width = `${box.width}px`;
  style.height = `${box.height}px`;
  style.overflow = "visible";
  style.margin = "0";
  style.padding = "0";
  style.background = "transparent";
  style.border = "none";
  style.borderRadius = "0";
  style.boxShadow = "none";
  style.contain = "none";
  style.zIndex = "80";
}

export function mountOutlineRegion({ doc = globalThis.document, img, onConfirm, onCancel } = {}) {
  const noop = { destroy() {} };
  if (!doc?.body || !img || typeof img.getBoundingClientRect !== "function") return noop;

  const root = doc.createElement("div");
  root.className = "pxd-root";
  placeRoot(root, img);
  doc.body.append(root);

  let dead = false;
  const offs = [];
  const listen = (target, type, fn, opts) => {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };

  const teardown = () => {
    if (dead) return;
    dead = true;
    mark?.destroy?.();
    offs.splice(0).forEach((off) => { try { off(); } catch { /* already gone */ } });
    root.remove();
  };

  const follow = () => {
    if (dead) return;
    if (img.isConnected === false) {
      teardown();
      onCancel?.();
      return;
    }
    placeRoot(root, img);
  };

  listen(doc, "scroll", follow, true);
  const view = doc.defaultView;
  if (view && view !== doc) listen(view, "resize", follow);

  const arm = globalThis.setTimeout(() => {
    if (dead) return;
    listen(doc, "pointerdown", (event) => {
      if (dead || root.contains(event.target)) return;
      teardown();
      onCancel?.();
    }, true);
  }, 0);
  offs.push(() => globalThis.clearTimeout(arm));

  const mark = mountRegionMark({
    doc,
    root,
    img,
    onConfirm: (value) => {
      teardown();
      onConfirm?.(value);
    },
    onCancel: () => {
      teardown();
      onCancel?.();
    },
  });

  return { destroy: teardown, root };
}
