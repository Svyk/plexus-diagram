// Cell ends for arrows on table cards. A Roam table cell is a block: Roam Grid stamps its uid on
// `.rg-cell[data-uid]`, a native Roam table keeps it in the id of the cell's block input. These helpers
// find the uid under a node, find the element for a uid, measure it against the visible part of the
// card, and watch the table for scroll and size changes. Nothing here writes.

const UID_AT_END = /-([\w-]{9})$/;
const UID_RE = /^[\w-]{1,36}$/;

const hasClass = (node, name) => Boolean(node?.classList?.contains?.(name));

export function cellUidOf(node) {
  if (!node || typeof node.closest !== "function") return null;
  const grid = node.closest(".rg-cell");
  if (grid) {
    const uid = grid.dataset?.uid || grid.getAttribute?.("data-uid") || "";
    return UID_RE.test(uid) ? uid : null;
  }
  const td = node.closest("td");
  if (!td || !td.closest?.(".rm-table")) return null;
  const input = td.querySelector?.(".rm-block__input, .roam-block");
  const m = UID_AT_END.exec(String(input?.id || ""));
  return m ? m[1] : null;
}

export function cellElementOf(node) {
  if (!node || typeof node.closest !== "function") return null;
  return node.closest(".rg-cell") || node.closest("td");
}

export function findCell(host, uid) {
  if (!host || !UID_RE.test(String(uid || ""))) return null;
  const grids = host.querySelectorAll?.(".rg-cell") || [];
  for (const cell of grids) {
    if ((cell.dataset?.uid || cell.getAttribute?.("data-uid")) === uid) return cell;
  }
  const tds = host.querySelectorAll?.(".rm-table td") || [];
  for (const td of tds) if (cellUidOf(td) === uid) return td;
  return null;
}

const rectOf = (node) => {
  const r = node?.getBoundingClientRect?.();
  if (!r) return null;
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width ?? r.right - r.left, height: r.height ?? r.bottom - r.top };
};

const round1 = (n) => Math.round(n * 10) / 10;

// The part of the card where a cell can be seen: the card body, the table host, and every scroller between.
function visibleClip(cell, host, body) {
  let clip = rectOf(body);
  const cut = (node) => {
    const r = rectOf(node);
    if (!r) return;
    if (!clip) { clip = r; return; }
    clip = { top: Math.max(clip.top, r.top), bottom: Math.min(clip.bottom, r.bottom), left: Math.max(clip.left, r.left), right: Math.min(clip.right, r.right) };
  };
  cut(host);
  for (let n = cell?.parentElement; n && n !== host && n !== body; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight || n.scrollWidth > n.clientWidth) cut(n);
  }
  return clip;
}

// Same shape as the page-row measure so blockAnchor / blockInner take it unchanged. A cell that is not
// rendered, or sits outside the clip on either axis, is reported so the end clamps to the card edge.
export function measureCell({ card, host, body, uid, zoom = 1 } = {}) {
  const cardRect = rectOf(card);
  const bodyRect = rectOf(body);
  if (!cardRect || !bodyRect) return null;
  const z = zoom || 1;
  const out = { bodyTop: round1((bodyRect.top - cardRect.top) / z), bodyBottom: round1((bodyRect.bottom - cardRect.top) / z) };
  const cell = findCell(host, uid);
  const r = cell ? rectOf(cell) : null;
  if (!r || (!r.width && !r.height)) return { ...out, rowTop: null, rowHeight: 0, rendered: false };
  const clip = visibleClip(cell, host, body);
  const rowHeight = round1(r.height / z);
  let rowTop = round1((r.top - cardRect.top) / z);
  if (clip) {
    const cx = (r.left + r.right) / 2;
    if (cx < clip.left || cx > clip.right) rowTop = round1(out.bodyTop - rowHeight * 2 - 1);
    else {
      const cy = (r.top + r.bottom) / 2;
      if (cy < clip.top) rowTop = round1(out.bodyTop - rowHeight * 2 - 1);
      else if (cy > clip.bottom) rowTop = round1(out.bodyBottom + 1);
    }
  }
  const left = clip ? Math.max(r.left, clip.left) : r.left;
  const right = clip ? Math.min(r.right, clip.right) : r.right;
  return { ...out, rowTop, rowHeight, rowLeft: round1((left - cardRect.left) / z), rowRight: round1((right - cardRect.left) / z), rendered: true };
}

// Scroll every scroller between the cell and the card body so the cell sits in the middle of each view.
export function revealCell(cell, body) {
  if (!cell) return false;
  const r = rectOf(cell);
  if (!r || (!r.width && !r.height)) return false;
  for (let n = cell.parentElement; n; n = n.parentElement) {
    const canY = n.scrollHeight > n.clientHeight;
    const canX = n.scrollWidth > n.clientWidth;
    if (canY || canX) {
      const v = rectOf(n);
      if (v) {
        if (canY) n.scrollTop = Math.max(0, (Number(n.scrollTop) || 0) + ((r.top + r.bottom) / 2 - (v.top + v.bottom) / 2));
        if (canX) n.scrollLeft = Math.max(0, (Number(n.scrollLeft) || 0) + ((r.left + r.right) / 2 - (v.left + v.right) / 2));
      }
    }
    if (n === body) break;
  }
  return true;
}

// Calls `onChange` when the table scrolls or changes size. Scroll does not bubble, so it is caught in the
// capture phase on the table host and the card body. Returns an off function that removes both.
export function watchTable({ host, body, onChange, doc } = {}) {
  if (!host || typeof onChange !== "function") return () => {};
  const view = doc?.defaultView || globalThis;
  const RO = view.ResizeObserver || globalThis.ResizeObserver;
  let ro = null;
  if (typeof RO === "function") {
    ro = new RO(() => onChange());
    try { ro.observe(host); if (host.firstElementChild) ro.observe(host.firstElementChild); } catch { /* not observable */ }
  }
  const opts = { capture: true, passive: true };
  host.addEventListener?.("scroll", onChange, opts);
  if (body && body !== host) body.addEventListener?.("scroll", onChange, opts);
  return () => {
    try { ro?.disconnect(); } catch { /* already off */ }
    host.removeEventListener?.("scroll", onChange, opts);
    if (body && body !== host) body.removeEventListener?.("scroll", onChange, opts);
  };
}

export const isTableCard = (card) => hasClass(card, "pxd-item--roam-table");
