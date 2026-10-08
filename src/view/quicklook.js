// Quick Look: a read-only, centered preview of one card (Space / context menu). Everything Roam-rendered
// goes through host.renderString and is unmounted on close; the overlay swallows pointer, wheel and key
// events so the board underneath never reacts.

import { boardPreview } from "../model/board.js";
import { quickLookTitle, startPage } from "../model/card-face.js";
import { flipStep } from "./pdf-flip.js";
import { detectPdfjs, firstPageAllowed } from "./pdf-first-page.js";

const DEPTH = 3;
const LIMIT = 24;
const STOP_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "keydown", "keyup", "contextmenu"];

const childUid = (c) => c?.[":block/uid"] ?? c?.uid ?? "";
const childString = (c) => c?.[":block/string"] ?? c?.string ?? "";
const childKids = (c) => c?.[":block/children"] ?? c?.children ?? [];

// A PDF card previews its own page: pdf.js draws the card's current page to the Quick Look width, with a themed
// page pill (‹ N / M ›, arrow keys). Roam's reader (white toolbar, last page it showed, sideways scrollbar) is
// only the fallback for files pdf.js cannot open here (.enc uploads, no pdf.js).
export function createQuickLook({ doc = globalThis.document, root, host, timers, on = {}, win = doc?.defaultView || null, pdfLib = null } = {}) {
  let node = null;
  let pdfOff = null;
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
    try { pdfOff?.(); } catch { /* already closed */ }
    pdfOff = null;
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

  const engine = () => {
    if (pdfLib && typeof pdfLib.getDocument === "function") return pdfLib;
    return detectPdfjs(win)?.lib || null;
  };
  // Returns true when the pdf.js preview took the body.
  const fillPdf = (body, item) => {
    let spec = null;
    try { spec = on.pdfOf?.(item) || null; } catch { spec = null; }
    const url = typeof spec?.url === "string" ? spec.url : "";
    const lib = engine();
    if (!lib || !firstPageAllowed(url)) return false;
    node.classList.add("pxd-quicklook--pdf");
    const stage = el("div", "pxd-ql__pdf", body);
    const canvas = el("canvas", "pxd-ql__canvas", stage);
    const pill = el("div", "pxd-ql__pill", node);
    pill.setAttribute("role", "toolbar");
    pill.setAttribute("aria-label", "Pages");
    const prev = el("button", "pxd-ql__step", pill, "‹");
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous page");
    const pages = el("span", "pxd-ql__pages", pill, "");
    const next = el("button", "pxd-ql__step", pill, "›");
    next.type = "button";
    next.setAttribute("aria-label", "Next page");
    let pdf = null;
    let task = null;
    let render = null;
    let page = startPage(spec?.page, 0);
    let total = 0;
    let seq = 0;
    let live = true;
    const paint = () => {
      pages.textContent = total ? `${page} / ${total}` : "";
      prev.disabled = page <= 1;
      next.disabled = !total || page >= total;
      pill.classList.toggle("pxd-ql__pill--single", total <= 1);
    };
    const draw = async () => {
      const mine = ++seq;
      if (!pdf) return;
      let proxy = null;
      try { proxy = await pdf.getPage(page); } catch { return; }
      if (!live || mine !== seq || !proxy) return;
      let base = null;
      try { base = proxy.getViewport({ scale: 1 }); } catch { return; }
      const width = Number(stage.clientWidth) || 600;
      const dpr = Number(win?.devicePixelRatio) || 1;
      const scale = width / (Number(base?.width) || width);
      let view = null;
      try { view = proxy.getViewport({ scale: scale * dpr }); } catch { return; }
      canvas.width = Math.max(1, Math.round(view.width));
      canvas.height = Math.max(1, Math.round(view.height));
      canvas.style.width = `${Math.round(view.width / dpr)}px`;
      canvas.style.height = `${Math.round(view.height / dpr)}px`;
      try { render?.cancel?.(); } catch { /* done */ }
      try { render = proxy.render({ canvasContext: canvas.getContext("2d"), viewport: view }); } catch { return; }
      try { await (render?.promise || render); } catch { /* cancelled */ }
      if (mine === seq) stage.scrollTop = 0;
    };
    const step = (delta) => {
      const to = flipStep(page, total || 1, delta);
      if (to === page) return false;
      page = to;
      paint();
      void draw();
      return true;
    };
    for (const [button, delta] of [[prev, -1], [next, 1]]) {
      button.addEventListener("click", (event) => { event.stopPropagation(); step(delta); });
    }
    const onKey = (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (step(event.key === "ArrowLeft" ? -1 : 1)) { event.preventDefault?.(); event.stopPropagation?.(); }
    };
    doc.addEventListener("keydown", onKey, true);
    pdfOff = () => {
      live = false;
      doc.removeEventListener("keydown", onKey, true);
      try { render?.cancel?.(); } catch { /* done */ }
      try { task?.destroy?.(); } catch { /* done */ }
      try { pdf?.destroy?.(); } catch { /* done */ }
      render = null;
      task = null;
      pdf = null;
    };
    paint();
    (async () => {
      try { task = lib.getDocument({ url }); } catch { task = null; }
      if (!task) return;
      let got = null;
      try { got = await (task.promise || task); } catch { got = null; }
      if (!live || !got) return;
      pdf = got;
      total = Number(got.numPages) || 1;
      page = startPage(spec?.page, total);
      paint();
      await draw();
    })().catch(() => {});
    return true;
  };

  const fill = (body, item) => {
    if (item.kind === "pdf" && fillPdf(body, item)) return;
    if (item.kind === "pdf") node.classList.add("pxd-quicklook--pdf-roam");
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
    let shown = "";
    try { shown = item.kind === "pdf" ? on.titleOf?.(item) || "" : ""; } catch { shown = ""; }
    el("div", "pxd-ql__title", head, item.kind === "board" ? item.title : item.kind === "pdf" ? quickLookTitle(item, shown) : (item.title || item.string || ""));
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
