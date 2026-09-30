// Quick Look: a read-only, centered preview of one card (Space / context menu). Everything Roam-rendered
// goes through host.renderString and is unmounted on close; the overlay swallows pointer, wheel and key
// events so the board underneath never reacts.

import { boardPreview } from "../model/board.js";

const DEPTH = 3;
const LIMIT = 24;
const STOP_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "keydown", "keyup", "contextmenu"];

const childUid = (c) => c?.[":block/uid"] ?? c?.uid ?? "";
const childString = (c) => c?.[":block/string"] ?? c?.string ?? "";
const childKids = (c) => c?.[":block/children"] ?? c?.children ?? [];

export function createQuickLook({ doc = globalThis.document, root, host, timers, on = {} } = {}) {
  let node = null;
  let roots = [];
  let current = null;
  let cancelPending = null;
  let disposed = false;
  const offs = [];

  const el = (tag, cls, parent, text) => {
    const n = doc.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    parent?.append(n);
    return n;
  };

  const renderRoot = (parent, string, cls) => {
    const n = el("div", cls, parent);
    roots.push(n);
    if (!string) return n;
    try {
      if (host?.renderString) host.renderString(n, string);
      else n.textContent = string;
    } catch {
      n.textContent = string;
    }
    return n;
  };

  const renderBlocks = (parent, blocks, depth, budget) => {
    for (const b of blocks || []) {
      if (budget.n >= LIMIT * 4) return;
      budget.n += 1;
      const row = el("div", "pxd-ql__block", parent);
      renderRoot(row, childString(b), "pxd-rs pxd-ql__text");
      const kids = childKids(b);
      if (kids.length && depth < DEPTH) renderBlocks(el("div", "pxd-ql__children", row), kids, depth + 1, budget);
    }
  };

  const unmountRoots = () => {
    for (const n of roots) { try { host?.unmount?.(n); } catch { /* not a roam root */ } }
    roots = [];
  };

  const close = () => {
    if (!node) return false;
    cancelPending?.();
    cancelPending = null;
    unmountRoots();
    node.remove();
    node = null;
    current = null;
    offs.splice(0).forEach((off) => off());
    on.close?.();
    return true;
  };

  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };

  const fill = (body, item) => {
    const blocksInto = (result) => {
      if (!node || !body.parentElement) return;
      const budget = { n: 0 };
      renderBlocks(body, result || [], 1, budget);
    };
    const settle = (result, apply) => {
      if (result && typeof result.then === "function") {
        result.then((r) => { if (node && current === item) apply(r); }).catch(() => {});
      } else apply(result);
    };
    if (item.kind === "board") {
      let count = 0;
      try { count = boardPreview(item)?.count ?? 0; } catch { count = 0; }
      el("div", "pxd-ql__summary", body, `${count} ${count === 1 ? "item" : "items"}`);
    } else if (item.kind === "page") {
      settle(host?.pagePreview?.(item.title, DEPTH, LIMIT), (p) => {
        if (!p?.exists) { el("div", "pxd-ql__placeholder", body, "Empty page"); return; }
        blocksInto(p.blocks);
      });
    } else if (item.kind === "block") {
      const ref = item.target?.uid;
      const s = host?.blockString?.(ref);
      if (typeof s === "string" && s.trim()) renderRoot(body, s, "pxd-rs pxd-ql__string");
      settle(host?.pullTree?.(ref, DEPTH, LIMIT), (t) => {
        if (!(typeof s === "string" && s.trim()) && !(t || []).length) el("div", "pxd-ql__placeholder", body, "Empty card");
        blocksInto(t);
      });
    } else {
      if (item.string?.trim()) renderRoot(body, item.string, "pxd-rs pxd-ql__string");
      const kids = item.content?.length ? item.content : null;
      if (kids) blocksInto(kids);
      else settle(host?.pullTree?.(item.uid, DEPTH, LIMIT), (t) => {
        if (!item.string?.trim() && !(t || []).length) el("div", "pxd-ql__placeholder", body, "Empty card");
        blocksInto(t);
      });
    }
  };

  const open = (item) => {
    if (disposed || !item) return false;
    close();
    current = item;
    node = el("div", "pxd-quicklook pxd-chrome", root);
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-label", "Quick Look");
    for (const type of STOP_EVENTS) listen(node, type, (event) => event.stopPropagation());
    const head = el("div", "pxd-ql__head", node);
    el("div", "pxd-ql__title", head, item.kind === "board" ? item.title : (item.title || item.string || ""));
    let refs = null;
    try { refs = on.getRefCount?.(item); } catch { refs = null; }
    if (typeof refs === "number" && refs > 0) el("span", "pxd-ql__refs", head, String(refs));
    const body = el("div", "pxd-ql__body", node);
    fill(body, item);
    listen(doc, "pointerdown", (event) => {
      if (node && !node.contains(event.target)) close();
    }, true);
    listen(doc, "keydown", (event) => {
      if (event.key === "Escape" && node) { event.preventDefault?.(); event.stopPropagation?.(); close(); }
    }, true);
    return true;
  };

  return {
    open,
    close,
    toggle(item) { if (node) { close(); return false; } return open(item); },
    isOpen: () => Boolean(node),
    dispose() { close(); disposed = true; },
  };
}
