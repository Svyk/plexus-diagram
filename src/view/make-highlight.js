// Turn a parsed text block into a native Roam PDF highlight.
// Prefer Roam's own callback on the PdfHighlighter fiber. The fallback selects
// the text-layer spans and dispatches mouseup so Roam's colour picker appears.
// This module writes nothing. It does not stop mouseup.

const CALLBACKS = ["onSelectionFinished", "addHighlight", "addPdfHighlight"];

function rectOf(bbox, page) {
  const box = Array.isArray(bbox) ? bbox : [0, 0, 0, 0];
  const width = Number(page?.w) || 0;
  const height = Number(page?.h) || 0;
  const pageNumber = Number(page?.n || page?.page) || 1;
  const scaled = {
    x1: box[0],
    y1: box[1],
    x2: box[2],
    y2: box[3],
    width,
    height,
    pageNumber,
  };
  return scaled;
}

export function highlightPosition(block, page) {
  const scaled = rectOf(block?.bbox, { ...page, n: block?.page });
  return {
    boundingRect: scaled,
    rects: [scaled],
    pageNumber: block?.page || scaled.pageNumber,
  };
}

function callbackOf(context) {
  if (!context || typeof context !== "object") return null;
  for (const name of CALLBACKS) {
    if (typeof context[name] === "function") return context[name];
  }
  return null;
}

function intersects(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function spanRect(span, pageEl) {
  const own = span?.getBoundingClientRect?.();
  const page = pageEl?.getBoundingClientRect?.();
  if (!own || !page) return null;
  return {
    left: own.left - page.left,
    top: own.top - page.top,
    right: own.right - page.left,
    bottom: own.bottom - page.top,
  };
}

export function spansInBbox(pageEl, bbox, page) {
  const want = rectOf(bbox, page);
  const target = {
    left: want.x1,
    top: want.y1,
    right: want.x2,
    bottom: want.y2,
  };
  const scale = pageEl?.clientWidth > 0 && page?.w > 0 ? pageEl.clientWidth / page.w : 1;
  const scaled = {
    left: target.left * scale,
    top: target.top * scale,
    right: target.right * scale,
    bottom: target.bottom * scale,
  };
  const nodes = pageEl?.querySelectorAll?.(".textLayer span") || [];
  const hits = [];
  for (const span of nodes) {
    const rect = spanRect(span, pageEl);
    if (intersects(rect, scaled)) hits.push(span);
  }
  return hits;
}

export function selectSpans(doc, spans) {
  const sel = doc?.getSelection?.() || doc?.defaultView?.getSelection?.();
  if (!sel || !spans?.length || typeof doc?.createRange !== "function") return false;
  try { sel.removeAllRanges?.(); } catch { /* stub */ }
  const range = doc.createRange();
  const first = spans[0];
  const last = spans[spans.length - 1];
  try {
    range.setStart(first.firstChild || first, 0);
    const end = last.firstChild || last;
    const len = typeof end.length === "number" ? end.length : (end.childNodes?.length || 0);
    range.setEnd(end, len);
    sel.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function uidOf(result) {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    if (typeof result.uid === "string") return result.uid;
    if (typeof result.id === "string") return result.id;
  }
  return "";
}

export async function makeHighlight({ block, live, pageEl, page, getContext, adoptCreated, toast } = {}) {
  if (!block || (block.type !== "para" && block.type !== "heading" && block.type !== "list" && block.type !== "caption" && block.type !== "footnote" && block.type !== "code")) {
    return { path: "skip", reason: "not-text" };
  }
  const context = typeof getContext === "function" ? getContext() : null;
  const fn = callbackOf(context);
  if (fn) {
    let result = null;
    try {
      result = await fn(highlightPosition(block, page), { text: block.text || "" });
    } catch {
      result = null;
    }
    const uid = uidOf(result);
    if (uid) {
      try { adoptCreated?.(uid); } catch { /* host */ }
      return { path: "roam", uid };
    }
  }
  const pageNode = typeof pageEl === "function" ? pageEl(block.page) : pageEl;
  const doc = pageNode?.ownerDocument || live?.ownerDocument || null;
  const spans = spansInBbox(pageNode, block.bbox, page);
  selectSpans(doc, spans);
  const layer = pageNode?.querySelector?.(".textLayer") || pageNode;
  if (layer && doc) {
    const event = { type: "mouseup", button: 0, bubbles: true, cancelable: true, target: layer };
    try {
      if (typeof layer.dispatchEvent === "function" && typeof doc.createEvent === "function") {
        layer.dispatchEvent(new (doc.defaultView?.MouseEvent || MouseEvent)("mouseup", { bubbles: true, cancelable: true }));
      } else {
        layer.dispatchEvent?.(event);
      }
    } catch {
      try { layer.dispatchEvent?.(event); } catch { /* stub */ }
    }
  }
  const message = "Pick a colour to save the highlight";
  try { toast?.(message); } catch { /* host */ }
  return { path: "picker", message };
}
