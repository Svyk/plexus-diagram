// R4 (speed flag bucketLayers). The big board layers (card shells, edges, edge labels) hold their children in
// buckets of at most BUCKET_SIZE (2x before a split): <div class="pxd-bucket"> (display: contents) or <g>.
//
// Why: Roam loads all of Tailwind, whose `.space-y-N > :not([hidden]) ~ :not([hidden])` rules (1,548 of them) make
// Blink restyle every later sibling when a child is inserted or removed. In a flat layer of 1,500 shells or 2,100
// edges that is the whole layer for each mid-list change (headless Chromium with Roam's CSS, 1,560-card fixture at
// overview: a mid-list edge 83 ms, a shell 58 ms; in buckets of 64: 19 and 20 ms, the same as at the end of the list).
// DOM order is still board order, so paint order is unchanged.

export const BUCKET_CLASS = "pxd-bucket";
export const BUCKET_SIZE = 64;
const SVG_NS = "http://www.w3.org/2000/svg";

const isBucket = (node) => Boolean(node?.classList?.contains?.(BUCKET_CLASS));
const kidCount = (node) => (typeof node?.childElementCount === "number" ? node.childElementCount : node?.children?.length || 0);
const lastKid = (node) => node?.lastElementChild ?? node?.children?.[kidCount(node) - 1] ?? null;

// container: the layer. on(): true while this layer should bucket (big boards, flag on). With on() false every call
// is the plain layer operation, and children already in buckets are still found (has) and moved (insertBefore).
export function createBucketHost(container, { doc = globalThis.document, svg = false, size = BUCKET_SIZE, on = () => true } = {}) {
  const make = () => {
    const b = svg && typeof doc?.createElementNS === "function" ? doc.createElementNS(SVG_NS, "g") : doc.createElement("div");
    if (svg) b.setAttribute("class", BUCKET_CLASS);
    else b.className = BUCKET_CLASS;
    return b;
  };
  const tail = () => {
    let last = lastKid(container);
    if (!isBucket(last) || kidCount(last) >= size) {
      last = make();
      container.append(last);
    }
    return last;
  };
  // A bucket past twice the size gives its second half to a new bucket right after it.
  const split = (b) => {
    const n = kidCount(b);
    if (n <= size * 2) return;
    const kids = [...b.children].slice(n - size);
    const next = make();
    const siblings = [...(container.children || [])];
    container.insertBefore(next, siblings[siblings.indexOf(b) + 1] || null);
    next.append(...kids);
  };
  const host = {
    // True when el is in this layer: directly or in one of its buckets.
    has(el) {
      const p = el?.parentElement;
      return Boolean(p) && (p === container || (isBucket(p) && p.parentElement === container));
    },
    // Where a new child goes when it is added at the end of the layer.
    target() { return on() ? tail() : container; },
    append(el) { host.target().append(el); },
    // before: a child of this layer (in a bucket or not), or null for the end.
    insertBefore(el, before) {
      const p = before?.parentElement;
      if (!before || !p || !(p === container || (isBucket(p) && p.parentElement === container))) { host.append(el); return; }
      p.insertBefore(el, before);
      if (isBucket(p)) split(p);
    },
    // Puts these elements, in this order, at the end of the layer. The bulk paths (a full re-order of every shell)
    // fill buckets in order, one fragment per bucket.
    appendAll(els) {
      if (!els.length) return;
      if (!on()) {
        const frag = typeof doc?.createDocumentFragment === "function" ? doc.createDocumentFragment() : null;
        if (!frag) { for (const el of els) container.append(el); return; }
        frag.append(...els);
        container.append(frag);
        return;
      }
      let i = 0;
      while (i < els.length) {
        const b = tail();
        const room = Math.max(1, size - kidCount(b));
        b.append(...els.slice(i, i + room));
        i += room;
      }
    },
    // Empty buckets cost nothing to keep; a full re-order drops them so the layer does not grow without bound.
    prune() {
      for (const b of [...(container.children || [])]) if (isBucket(b) && kidCount(b) === 0) b.remove();
    },
  };
  return host;
}
