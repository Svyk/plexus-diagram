// Connections, derived links, temp wire, guides and marquee as SVG. Arrowheads are explicit
// filled triangle paths (no <marker>), colors come from `pxd-c-<palette>` classes on the
// group (never var() in presentation attributes), and only edges touching moving items are
// recomputed during a drag.

import { createBucketHost } from "./buckets.js";
import { shownEdgeLabel } from "../model/arrow-home.js";
import { edgeAnchor, routedEdge } from "../model/board.js";
import { edgeMayTarget, regionInnerEnd } from "../model/endpoints.js";
import { arrowHeadPath, arrowSize, blockAnchor, blockInner, center, edgePath, screenPx, sidePoint } from "../model/geometry.js";
import { routeAround } from "../model/section6.js";
import { PALETTE, hexColor } from "../model/schema.js";
import { highlightPill } from "../model/pdf-chips.js";
import { whyTip } from "../model/why.js";
import { paintSuggest } from "./suggest-lines.js";
import { notedSpeedFlags } from "../settings.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PAIR_OFFSET = 18;
const LABEL_HIDE_ZOOM = 0.3;
const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

// Liang-Barsky clip of the segment (x1,y1)-(x2,y2) against rect r.
export function segmentMeetsRect(x1, y1, x2, y2, r) {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, x1 - r.x) && clip(dx, r.x + r.w - x1) && clip(-dy, y1 - r.y) && clip(dy, r.y + r.h - y1);
}

const setClass = (el, name) => {
  el.setAttribute("class", name);
  if (el.classList && !el.classList.contains(name.split(" ")[0])) el.className = name;
};

export function createEdgeLayer({ doc = globalThis.document, svg, labelsLayer, overlaySvg, onLabelCommit, blockText, onHover, virtualOff = () => false, deferPark = () => false, onParkDue = null, bucketed = () => false, childHint = null } = {}) {
  // R4 (bucketLayers): on a big board edges and labels sit in buckets (buckets.js), so parking or adding one edge
  // restyles its bucket, not every later edge.
  const edgeHost = svg ? createBucketHost(svg, { doc, svg: true, on: bucketed }) : null;
  const labelHost = labelsLayer ? createBucketHost(labelsLayer, { doc, on: bucketed }) : null;
  const edgeEls = new Map(); // uid → {g, hit, line, head, tail, dot, label}
  const laneHidden = new Set();
  const linkEls = new Map(); // key → {g, hit, line, head, label}
  let wire = null;
  let marquee = null;
  let lasso = null;
  let regionPen = null;
  const guideEls = [];
  const ghostEls = [];
  let focusSet = null;
  let searchEdges = null;
  let zoomCache = 1;
  let editingLabel = null;
  let hoverUid = null;
  const measures = new Map(); // BA-3: edge uid → { from?, to? } row measurements, only for edges with block ends
  const listeners = [];

  const mk = (tag, cls, parent) => {
    const el = doc.createElementNS(SVG_NS, tag);
    setClass(el, cls);
    parent?.append(el);
    return el;
  };
  const listen = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    listeners.push(() => el.removeEventListener(type, fn, opts));
  };

  // Reverse pairs, once per board model: the scan per edge made a full render O(edges²) (2,114 edges: 4.5M checks).
  let pairsOf = null;
  let pairs = new Map();
  const pairOffset = (board, edge) => {
    if (pairsOf !== board.edges) {
      pairsOf = board.edges;
      pairs = new Map();
      for (const e of board.edges.values()) {
        const key = `${e.from}\0${e.to}`;
        const list = pairs.get(key);
        if (list) list.push(e.uid);
        else pairs.set(key, [e.uid]);
      }
    }
    for (const uid of pairs.get(`${edge.to}\0${edge.from}`) || []) {
      if (uid !== edge.uid) return edge.uid < uid ? PAIR_OFFSET : -PAIR_OFFSET;
    }
    return 0;
  };
  // Past VIRTUAL_EDGES connections an edge is in the DOM only while the box of its two ends meets the view (render's
  // and reveal's `view`). An edge off to the side is built, painted and placed when it comes near.
  const VIRTUAL_EDGES = 300;
  const virtualEdges = (board) => board.edges.size > VIRTUAL_EDGES && virtualOff() !== true;
  let view = null;
  // The segment between the two ends' centres meets the view, or an end box does. A bounding box was not enough:
  // the PhD main board's links cross the whole board, so nearly every box met the view.
  // Parking uses a wider box than attaching, so edges on the border do not flip in and out on every settle.
  const widen = (r, f) => (r ? { x: r.x - r.w * f, y: r.y - r.h * f, w: r.w * (1 + 2 * f), h: r.h * (1 + 2 * f) } : r);
  const edgeFar = (board, edge, rects) => {
    const keep = view;
    view = widen(keep, 0.125);
    try { return !edgeNear(board, edge, rects); } finally { view = keep; }
  };
  // C2: at the overview canvas tier every edge is a hairline on the view's canvas; only a pinned one is DOM.
  let canvasTier = () => false;
  const edgeNear = (board, edge, rects) => {
    if (canvasTier()) return false;
    if (!view) return true;
    const a = rects.get(edgeAnchor(board, edge.from, edge.homeFrom));
    const b = rects.get(edgeAnchor(board, edge.to, edge.homeTo));
    if (!a || !b) return true;
    const meets = (r) => r.x < view.x + view.w && r.x + r.w > view.x && r.y < view.y + view.h && r.y + r.h > view.y;
    if (meets(a) || meets(b)) return true;
    return segmentMeetsRect(a.x + a.w / 2, a.y + a.h / 2, b.x + b.w / 2, b.y + b.h / 2, view);
  };
  const parkEdge = (rec) => {
    if (rec.parked) return;
    rec.parked = true;
    rec.stale = true;
    rec.g.remove();
    rec.label.remove();
    for (const end of ["from", "to"]) dropInner(rec, end);
  };
  // E3-1 (perf2, speed flag idlePark): a far edge that leaves the view at a settle is not removed in the settle's tasks
  // (a zoom-in to detail parked ~1,500 edges in two of them); it is marked stale, kept as it was (off the view), and
  // parked later in background slices (parkSome). It is placed again if the camera brings it back first.
  const parkDue = new Set();
  let parkNoted = false;
  const parkLater = (uid, rec) => {
    let later = false;
    try { later = deferPark() === true; } catch { later = false; }
    if (!later) { parkEdge(rec); return; }
    rec.stale = true;
    if (parkDue.has(uid)) return;
    parkDue.add(uid);
    if (!parkNoted) {
      parkNoted = true;
      queueMicrotask(() => { parkNoted = false; if (parkDue.size) { try { onParkDue?.(); } catch { /* the view parks them */ } } });
    }
  };
  const unparkEdge = (rec) => {
    if (!rec.parked) return;
    rec.parked = false;
    if (drag?.recs.has(rec)) drag.layer.append(rec.g);
    else if (drag?.crossing?.has(rec)) drag.cross.append(rec.g);
    else edgeHost?.append(rec.g);
    labelHost?.append(rec.label);
  };

  // E6 (perf2, speed flag dragLayer). A drag of a big selection re-pathed every edge touching it on every pointer
  // frame and repainted the whole edges <svg> (PhD main board, 185 cards: p95 333 ms). The edges with both ends in
  // the moving set go into one more <svg> (same class, so it sits where the edges layer sits) that is its own
  // compositor layer; a frame moves it with one transform. Only the edges that cross the selection are placed.
  let drag = null;
  const beginDrag = (board, moving) => {
    endDrag(null);
    if (!svg?.parentElement || !moving?.size) return 0;
    const layer = doc.createElementNS(SVG_NS, "svg");
    setClass(layer, "pxd-edges pxd-edges--drag");
    layer.setAttribute("aria-hidden", "true");
    layer.style.willChange = "transform";
    svg.after?.(layer);
    if (!layer.parentElement) svg.parentElement.append(layer);
    const recs = new Map();
    // E3-6: the edges with one end in the moving set are re-pathed every frame. In the edges <svg> each `d` write
    // repainted the whole layer (PhD main board: ~2,000 paths, a 125-card drag p50 232 ms with or without the group).
    // They sit in their own layer for the drag, so a frame repaints those paths only.
    const cross = doc.createElementNS(SVG_NS, "svg");
    setClass(cross, "pxd-edges pxd-edges--cross");
    cross.setAttribute("aria-hidden", "true");
    cross.style.willChange = "transform";
    const crossing = new Set();
    for (const edge of board.edges.values()) {
      const a = moving.has(edge.from), b = moving.has(edge.to);
      if (!a && !b) continue;
      const rec = edgeEls.get(edge.uid);
      if (!rec || rec.parked) continue;
      if (a !== b) { crossing.add(rec); cross.append(rec.g); continue; }
      const label = rec.label?.style?.transform || "";
      recs.set(rec, label);
      layer.append(rec.g);
    }
    // Derived links touching the moving set are re-placed every frame too (all of them): same layer.
    const links = [];
    for (const rec of linkEls.values()) {
      if (!moving.has(rec.from) && !moving.has(rec.to)) continue;
      links.push(rec);
      cross.append(rec.g);
    }
    if (crossing.size || links.length) layer.parentElement?.insertBefore?.(cross, layer);
    drag = { layer, recs, cross, crossing, links, inner: new Set([...recs.keys()].map((rec) => rec.uid)) };
    return recs.size;
  };
  const dragBy = (dx, dy) => {
    if (!drag) return;
    drag.layer.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : "";
    // Labels are divs over the board (hidden below 0.3): one transform each, from where the drag found them.
    for (const [rec, base] of drag.recs) if (rec.label && base) rec.label.style.transform = `translate(${dx}px, ${dy}px) ${base}`;
  };
  // ctx { board, rects, zoom }: place the riders where the model has them now (the drop's commit already moved
  // them, a cancel did not), in the task that puts them back, so no frame shows them at the pre-drag spot.
  const endDrag = (ctx) => {
    if (!drag) return;
    const { layer, recs, cross, crossing, links } = drag;
    drag = null;
    for (const rec of crossing || []) if (!rec.parked && edgeEls.has(rec.uid) && rec.g.parentElement === cross) edgeHost.append(rec.g);
    for (const rec of links || []) if (rec.g.parentElement === cross) edgeHost.append(rec.g);
    cross?.remove();
    for (const [rec, base] of recs) {
      if (rec.parked || !edgeEls.has(rec.uid)) continue;
      edgeHost.append(rec.g);
      if (rec.label && base) rec.label.style.transform = base;
      const edge = ctx?.board?.edges.get(rec.uid);
      if (edge && ctx.rects) placeEdge(ctx.board, edge, rec, ctx.rects, ctx.zoom ?? zoomCache);
    }
    layer.remove();
  };

  // A measured end. A region enters the card and stops on the region edge. A folded pin stays on the card face.
  const endOn = (spec, rect, other) => {
    if (!spec || !rect || spec.face) return null;
    if (spec.region && spec.image) {
      return regionInnerEnd({
        card: rect,
        image: { x: rect.x + spec.image.x, y: rect.y + spec.image.y, w: spec.image.w, h: spec.image.h },
        frac: spec.frac,
        poly: spec.poly,
        other: center(other),
      });
    }
    const an = blockAnchor({ rect, rowTop: spec.rowTop, rowHeight: spec.rowHeight, bodyTop: spec.bodyTop, bodyBottom: spec.bodyBottom, other: center(other) });
    return {
      point: an.point,
      side: an.side,
      clamp: an.clamped,
      inner: !an.clamped ? { rect, side: an.side, point: an.point, rowLeft: spec.rowLeft, rowRight: spec.rowRight, cell: spec.cell === true } : null,
    };
  };
  const geometryFor = (board, edge, rects, depth = 0) => {
    if (!board || !edge || depth > 1) return null;
    const fromItem = board.items.get(edge.from);
    const toItem = board.items.get(edge.to);
    const fromEdge = !fromItem ? board.edges.get(edge.from) : null;
    const toEdge = !toItem ? board.edges.get(edge.to) : null;
    if (fromEdge || toEdge) {
      if (fromEdge && toEdge) return null;
      if ((fromEdge && !edgeMayTarget(fromEdge, board.edges)) || (toEdge && !edgeMayTarget(toEdge, board.edges))) return null;
      const targetGeo = geometryFor(board, fromEdge || toEdge, rects, depth + 1);
      if (!targetGeo?.mid) return null;
      const stub = { x: targetGeo.mid.x, y: targetGeo.mid.y, w: 0, h: 0 };
      const itemUid = fromEdge ? edge.to : edge.from;
      const itemHome = fromEdge ? edge.homeTo : edge.homeFrom;
      const itemRect = rects.get(edgeAnchor(board, itemUid, itemHome));
      if (!itemRect) return null;
      const a = fromEdge ? stub : itemRect;
      const b = toEdge ? stub : itemRect;
      let fromSide = edge.fromSide;
      let toSide = edge.toSide;
      let fromPoint = fromEdge ? { x: stub.x, y: stub.y } : undefined;
      let toPoint = toEdge ? { x: stub.x, y: stub.y } : undefined;
      let fromClamp = null;
      let toClamp = null;
      let fromInnerSpec = null;
      let toInnerSpec = null;
      let fromReady = null;
      let toReady = null;
      const m = edge.fromBlock || edge.toBlock ? measures.get(edge.uid) : null;
      if (m?.from && edge.fromBlock && !fromEdge) {
        const hit = endOn(m.from, a, b);
        if (hit) {
          fromPoint = hit.point;
          fromSide = hit.side;
          fromClamp = hit.clamp ?? null;
          if (hit.region) fromReady = hit.inner || null;
          else fromInnerSpec = hit.inner || null;
        }
      }
      if (m?.to && edge.toBlock && !toEdge) {
        const hit = endOn(m.to, b, a);
        if (hit) {
          toPoint = hit.point;
          toSide = hit.side;
          toClamp = hit.clamp ?? null;
          if (hit.region) toReady = hit.inner || null;
          else toInnerSpec = hit.inner || null;
        }
      }
      const geo = edgePath({ a, b, fromSide, toSide, route: edge.route, offset: pairOffset(board, edge), fromPoint, toPoint });
      geo.fromClamp = fromClamp;
      geo.toClamp = toClamp;
      geo.fromW = a.w;
      geo.toW = b.w;
      geo.fromBlockAnchored = Boolean(fromPoint) && !fromEdge && !m?.from?.region;
      geo.toBlockAnchored = Boolean(toPoint) && !toEdge && !m?.to?.region;
      geo.fromInner = fromReady || (fromInnerSpec ? blockInner(fromInnerSpec) : null);
      geo.toInner = toReady || (toInnerSpec ? blockInner(toInnerSpec) : null);
      return geo;
    }
    const routed = routedEdge(board, edge, rects);
    if (!routed) return null;
    let via = edge.via;
    if ((!via || !via.length) && edge.route === "around") {
      const obstacles = [];
      for (const [uid, rect] of rects) {
        if (uid === edge.from || uid === edge.to || !rect) continue;
        const item = board.items.get(uid);
        if (item?.type === "card" || item?.type === "text") obstacles.push(rect);
      }
      via = routeAround(center(routed.a), center(routed.b), obstacles);
    }
    let fromSide = edge.fromSide;
    let toSide = edge.toSide;
    let fromPoint;
    let toPoint;
    let fromClamp = null;
    let toClamp = null;
    let fromInnerSpec = null;
    let toInnerSpec = null;
    let fromReady = null;
    let toReady = null;
    const m = edge.fromBlock || edge.toBlock ? measures.get(edge.uid) : null;
    if (m) {
      if (m.from && edge.fromBlock && routed.from === edge.from) {
        const hit = endOn(m.from, routed.a, routed.b);
        if (hit) {
          fromPoint = hit.point;
          fromSide = hit.side;
          fromClamp = hit.clamp ?? null;
          if (hit.region) fromReady = hit.inner || null;
          else fromInnerSpec = hit.inner || null;
        }
      }
      if (m.to && edge.toBlock && routed.to === edge.to) {
        const hit = endOn(m.to, routed.b, routed.a);
        if (hit) {
          toPoint = hit.point;
          toSide = hit.side;
          toClamp = hit.clamp ?? null;
          if (hit.region) toReady = hit.inner || null;
          else toInnerSpec = hit.inner || null;
        }
      }
    }
    // A card that lives inside a board card on this board enters that card the way a block arrow does:
    // a pill on the board card's edge, labelled with the moved card. No inner segment into the card.
    if (routed.fromHome && fromClamp == null) fromClamp = "top";
    if (routed.toHome && toClamp == null) toClamp = "top";
    const geo = edgePath({ a: routed.a, b: routed.b, fromSide, toSide, route: edge.route, offset: pairOffset(board, edge), via, fromPoint, toPoint });
    geo.fromClamp = fromClamp;
    geo.toClamp = toClamp;
    geo.fromW = routed.a.w;
    geo.toW = routed.b.w;
    geo.fromHome = routed.fromHome || null;
    geo.toHome = routed.toHome || null;
    if (m) { geo.fromBlockAnchored = Boolean(fromPoint) && !m.from?.region; geo.toBlockAnchored = Boolean(toPoint) && !m.to?.region; geo.fromInner = fromReady || (fromInnerSpec ? blockInner(fromInnerSpec) : null); geo.toInner = toReady || (toInnerSpec ? blockInner(toInnerSpec) : null); }
    return geo;
  };

  const buildEdge = (edge) => {
    const g = mk("g", "pxd-edge", edgeHost?.target());
    g.dataset.uid = edge.uid;
    g.setAttribute("data-uid", edge.uid);
    const hit = mk("path", "pxd-edge__hit", g);
    const line = mk("path", "pxd-edge__line", g);
    const tail = mk("path", "pxd-edge__head pxd-edge__tail", g);
    const head = mk("path", "pxd-edge__head", g);
    const dot = mk("circle", "pxd-edge__dot", g);
    dot.setAttribute("r", "4");
    const label = doc.createElement("div");
    label.className = "pxd-label";
    label.dataset.uid = edge.uid;
    label.setAttribute("data-uid", edge.uid);
    labelHost?.append(label);
    const rec = { uid: edge.uid, g, hit, line, head, tail, dot, label, geo: null };
    edgeEls.set(edge.uid, rec);
    return rec;
  };

  // BA-3/BA-4: a block end carries a small dot (tooltip = the block text) that becomes a marker with a chevron
  // when the row is scrolled out of the card. Built only for edges that have block ends.
  const bendOf = (rec, end) => {
    if (rec.bends?.[end]) return rec.bends[end];
    const g = mk("g", "pxd-edge__bend", rec.g);
    g.setAttribute("data-end", end);
    g.dataset.end = end;
    const pill = mk("rect", "pxd-edge__bend-pill", g);
    pill.setAttribute("height", "18");
    pill.setAttribute("rx", "9");
    pill.setAttribute("y", "-9");
    const text = mk("text", "pxd-edge__bend-text", g);
    text.setAttribute("y", "4");
    mk("circle", "pxd-edge__bend-dot", g).setAttribute("r", "5");
    mk("path", "pxd-edge__bend-chevron", g);
    g.setAttribute("data-tip", "edge.bend");
    rec.bends = { ...(rec.bends || {}), [end]: { g, clamp: null, side: null, pill, text, words: "" } };
    return rec.bends[end];
  };
  const dropBend = (rec, end) => {
    const bend = rec.bends?.[end];
    if (!bend) return;
    bend.g.remove();
    delete rec.bends[end];
  };
  // UX4 C1 (childEndMark, via childHint): an end on a child block of a folded card stays on the card edge and gets a
  // quiet mark: a hollow dot in the arrow's colour on the line, just behind the head (or ahead of the tail). One
  // <circle> per such end, placed with the edge; nothing per frame. The dot is the end's tooltip and click target.
  const CHILD_R = 3;
  const placeChildMark = (rec, end, spec, zoom) => {
    const marks = rec.childMarks || (rec.childMarks = {});
    let node = marks[end];
    if (!spec) {
      if (node) { node.remove(); delete marks[end]; }
      if (!marks.from && !marks.to) rec.childMarks = null;
      return;
    }
    if (!node) {
      node = mk("circle", "pxd-edge__child", rec.g);
      node.setAttribute("data-end", end);
      node.dataset.end = end;
      node.setAttribute("data-tip", "edge.child");
      styleZoomReader(node);
      marks[end] = node;
    }
    const r = CHILD_R * screenPx(zoom);
    const back = spec.offset + r * 1.4;
    const dx = Math.cos(spec.angle), dy = Math.sin(spec.angle);
    node.setAttribute("r", String(Math.round(r * 100) / 100));
    node.setAttribute("cx", String(Math.round((spec.point.x + spec.sign * dx * back) * 100) / 100));
    node.setAttribute("cy", String(Math.round((spec.point.y + spec.sign * dy * back) * 100) / 100));
    if (node.__pxdUid !== spec.uid) {
      node.__pxdUid = spec.uid;
      let text = "";
      try { text = String(blockText?.(spec.uid) ?? "").trim().slice(0, 120); } catch { text = ""; }
      node.setAttribute("data-tip-extra", text || "Block");
    }
  };
  const placeChildMarks = (board, edge, rec, geo, zoom, size) => {
    if (typeof childHint !== "function" && !rec.childMarks) return;
    const m = measures.get(edge.uid);
    const hint = (end) => {
      const card = end === "from" ? edge.from : edge.to;
      const block = end === "from" ? edge.fromBlock : edge.toBlock;
      if (!geo || !block || m?.[end] || (end === "from" ? geo.fromBlockAnchored || geo.fromHome : geo.toBlockAnchored || geo.toHome)) return false;
      try { return childHint?.(card, block) === true; } catch { return false; }
    };
    placeChildMark(rec, "to", hint("to") ? { point: geo.end, angle: geo.endAngle, sign: -1, offset: edge.dir === "none" ? 0 : size, uid: edge.toBlock } : null, zoom);
    placeChildMark(rec, "from", hint("from") ? { point: geo.start, angle: geo.startAngle, sign: 1, offset: edge.dir === "two" ? size : 0, uid: edge.fromBlock } : null, zoom);
  };
  const PILL_CHAR = 6;
  const PILL_PAD = 16;
  const PILL_MIN = 40;
  const placeBend = (rec, end, point, clamp, zoom, side, cardW = 0) => {
    const bend = bendOf(rec, end);
    // RE-4: the group is drawn in screen pixels at any zoom.
    const scale = screenPx(zoom);
    bend.g.setAttribute("transform", `translate(${point.x} ${point.y}) scale(${scale})`);
    if (bend.clamp !== clamp) {
      bend.clamp = clamp;
      bend.g.setAttribute("class", `pxd-edge__bend${clamp ? " pxd-edge__bend--clamped" : ""}`);
      bend.g.setAttribute("data-clamp", clamp || "");
      bend.g.setAttribute("data-tip-state", clamp ? "clamped" : "inline");
      bend.g.querySelector?.(".pxd-edge__bend-chevron")?.setAttribute("d", clamp === "bottom" ? "M-3 -1.5L0 1.5L3 -1.5" : "M-3 1.5L0 -1.5L3 1.5");
    }
    // RF-2: a clamped end is a pill "↑ first words" / "↓ first words" on the outside of the card edge.
    const full = clamp ? `${clamp === "bottom" ? "\u2193" : "\u2191"} ${bend.words || "Block"}` : "";
    // RE-4: the pill sits inside the card, on the edge side the arrow ends at, and is never wider than the card
    // (on screen) minus 16 px: the text is cut with an ellipsis.
    const cardScreen = cardW > 0 ? cardW * (Number(zoom) > 0 ? Number(zoom) : 1) : Infinity;
    const maxW = Math.max(PILL_MIN, cardScreen - PILL_PAD);
    const wantW = Math.max(PILL_MIN, full.length * PILL_CHAR + PILL_PAD);
    const w = Math.round(Math.min(wantW, maxW));
    const fit = Math.max(1, Math.floor((w - PILL_PAD) / PILL_CHAR));
    const label = full.length > fit ? `${full.slice(0, Math.max(1, fit - 1))}\u2026` : full;
    const key = `${clamp || ""}|${side || ""}|${label}|${w}`;
    if (bend.pillKey !== key) {
      bend.pillKey = key;
      if (clamp) {
        const inward = side === "left" ? 1 : -1;
        bend.text.textContent = label;
        bend.pill.setAttribute("width", String(w));
        bend.pill.setAttribute("x", String(inward > 0 ? 10 : -10 - w));
        bend.text.setAttribute("x", String(inward > 0 ? 18 : -10 - w + 8));
        bend.text.setAttribute("text-anchor", "start");
      } else {
        bend.text.textContent = "";
      }
    }
  };
  const bendTitle = (rec, end, uid) => {
    const bend = rec.bends?.[end];
    if (!bend) return;
    let text = "";
    try { text = String(blockText?.(uid) ?? "").trim().slice(0, 120); } catch { text = ""; }
    bend.g.setAttribute("data-tip-extra", text || "Block");
    const first = (text || "Block").split(/\s+/).slice(0, 4).join(" ");
    bend.words = first.length > 22 ? `${first.slice(0, 21)}\u2026` : first;
  };

  // RF-2: the part of a block arrow that sits inside the card. Drawn in the overlay (above the cards) as its own
  // group per end, colored like the edge; only for edges whose row is on screen.
  const innerClass = (rec) => `pxd-inner${rec.innerCls || ""}`;
  const paintInner = (rec) => {
    for (const n of Object.values(rec.inner || {})) {
      setClass(n.g, innerClass(rec));
      if (rec.innerHex) n.g.style.setProperty("--pxd-line", rec.innerHex);
      else n.g.style.removeProperty("--pxd-line");
    }
  };
  const innerOf = (rec, end) => {
    if (rec.inner?.[end]) return rec.inner[end];
    const g = mk("g", innerClass(rec), overlaySvg);
    g.setAttribute("data-edge", rec.uid);
    g.setAttribute("data-end", end);
    const line = mk("path", "pxd-inner__line", g);
    const head = mk("path", "pxd-inner__head", g);
    const dot = mk("circle", "pxd-inner__dot", g);
    dot.setAttribute("r", "3");
    rec.inner = { ...(rec.inner || {}), [end]: { g, line, head, dot } };
    paintInner(rec);
    return rec.inner[end];
  };
  const dropInner = (rec, end) => {
    const n = rec.inner?.[end];
    if (!n) return;
    n.g.remove();
    delete rec.inner[end];
  };
  const placeInner = (rec, edge, geo, zoom) => {
    for (const end of ["from", "to"]) {
      const spec = geo ? (end === "from" ? geo.fromInner : geo.toInner) : null;
      if (!spec) { dropInner(rec, end); continue; }
      const n = innerOf(rec, end);
      n.line.setAttribute("d", `M${spec.from.x} ${spec.from.y}L${spec.tip.x} ${spec.tip.y}`);
      const arrow = end === "to" ? edge.dir !== "none" : edge.dir === "two";
      if (arrow) {
        n.head.removeAttribute("display");
        n.head.setAttribute("d", arrowHeadPath(spec.tip, spec.angle, arrowSize(zoom, edge.weight)));
        n.dot.setAttribute("display", "none");
      } else {
        n.head.setAttribute("display", "none");
        n.dot.removeAttribute("display");
        n.dot.setAttribute("cx", String(spec.tip.x));
        n.dot.setAttribute("cy", String(spec.tip.y));
      }
      if (arrow && end === "to") rec.head.setAttribute("display", "none");
      if (arrow && end === "from") rec.tail.setAttribute("display", "none");
    }
  };
  const setHover = (uid, on) => {
    if (on) hoverUid = uid;
    else if (hoverUid === uid) hoverUid = null;
    const rec = edgeEls.get(uid);
    if (!rec) return;
    rec.g.classList?.toggle("pxd-edge--hover", Boolean(on));
    rec.innerCls = String(rec.innerCls || "").replace(/ pxd-inner--hover/g, "") + (on ? " pxd-inner--hover" : "");
    paintInner(rec);
  };

  // Selected-edge end handles: dragging one re-targets that end (BA-2). Built lazily, only for the selected edge.
  const placeEnds = (rec, geo) => {
    if (!rec.ends || !geo) return;
    let covered = false;
    const text = String(rec.label?.textContent || "");
    const half = text ? (Number(rec.label.offsetWidth) || text.length * 6.5 + 18) / 2 : 0;
    for (const end of ["from", "to"]) {
      const p = end === "from" ? geo.start : geo.end;
      rec.ends[end].setAttribute("cx", String(p.x));
      rec.ends[end].setAttribute("cy", String(p.y));
      if (half && geo.mid && Math.hypot(p.x - geo.mid.x, p.y - geo.mid.y) <= half + 12) covered = true;
    }
    // BUG-3: a short edge's label sits over its end handles; it steps aside while the edge is selected.
    rec.label?.classList?.toggle("pxd-label--clear", covered);
  };
  const syncEnds = (rec, on) => {
    if (!on) {
      if (!rec.ends) return;
      rec.ends.from.remove();
      rec.ends.to.remove();
      rec.ends = null;
      rec.label?.classList?.remove("pxd-label--clear");
      return;
    }
    if (rec.ends) return;
    rec.ends = {};
    for (const end of ["from", "to"]) {
      const c = mk("circle", "pxd-edge__end", rec.g);
      c.setAttribute("r", "6");
      c.setAttribute("data-end", end);
      c.dataset.end = end;
      styleZoomReader(c);
      rec.ends[end] = c;
    }
    placeEnds(rec, rec.geo);
  };
  // PXD-2 (zoomVarScope): the board writes its zoom variables on the card layers, so this layer has none. Its two
  // readers, the end handles and the child marks, carry them inline. Null leaves them to the root (flag off).
  let zoomVars = null;
  const styleZoomReader = (node) => {
    if (!zoomVars) return;
    for (const [name, value] of zoomVars) node.style?.setProperty?.(name, value);
  };
  const setZoomVars = (vars) => {
    zoomVars = vars ? Object.entries(vars).filter(([, value]) => value != null) : null;
    for (const rec of edgeEls.values()) {
      if (rec.ends) { styleZoomReader(rec.ends.from); styleZoomReader(rec.ends.to); }
      if (rec.childMarks) for (const node of Object.values(rec.childMarks)) styleZoomReader(node);
    }
  };

  const dimmed = (e) => Boolean(focusSet) && !(focusSet.has(e.from) && focusSet.has(e.to));

  // The board card a missing end is drawn to. Null when the stored card is itself on this board.
  const housedEnd = (board, edge, end) => {
    const stored = end === "from" ? edge?.from : edge?.to;
    const home = end === "from" ? edge?.homeFrom : edge?.homeTo;
    if (!home?.cardUid || !board?.items || board.items.has(stored) || !board.items.has(home.cardUid)) return null;
    return home;
  };
  const homeWords = (home) => {
    const title = String(home?.title || "Untitled");
    return title.length > 22 ? `${title.slice(0, 21)}\u2026` : title;
  };

  const paintEdge = (board, edge, rec, { covered, selected }) => {
    const cls = ["pxd-edge"];
    const named = PALETTE.includes(edge.color);
    const hex = hexColor(edge.color);
    if (named) cls.push(`pxd-c-${edge.color}`);
    if (edge.dash === "dashed") cls.push("pxd-edge--dashed");
    if (edge.dash === "animated") cls.push("pxd-edge--animated");
    if (edge.weight > 1) cls.push(`pxd-edge--w${edge.weight}`);
    if (selected) cls.push("pxd-edge--selected");
    if (covered) cls.push("pxd-edge--covered");
    const fromHome = housedEnd(board, edge, "from");
    const toHome = housedEnd(board, edge, "to");
    const endLive = (uid, home) => Boolean(board?.items?.has(uid) || board?.edges?.has(uid) || home);
    // A resolved home is drawn, so it is not the red missing-end stroke. The stored flag stays false:
    // focus mode and export still treat the endpoint as off this board.
    if (!edge.valid && !(endLive(edge.from, fromHome) && endLive(edge.to, toHome))) cls.push("pxd-edge--invalid");
    rec.from = edge.from;
    rec.to = edge.to;
    const searchOn = Boolean(searchEdges?.has(edge.uid));
    const dim = dimmed(edge) || (searchEdges ? !searchOn : false);
    if (dim) cls.push("pxd-edge--dim");
    if (searchOn) cls.push("pxd-edge--hit");
    const hovered = hoverUid === edge.uid && (edge.fromBlock || edge.toBlock);
    if (hovered) cls.push("pxd-edge--hover");
    rec.innerCls = `${named ? ` pxd-c-${edge.color}` : ""}${selected ? " pxd-inner--selected" : ""}${dim ? " pxd-inner--dim" : ""}${hovered ? " pxd-inner--hover" : ""}`;
    rec.innerHex = hex || "";
    paintInner(rec);
    setClass(rec.g, cls.join(" "));
    if (hex) rec.g.style.setProperty("--pxd-line", hex);
    else rec.g.style.removeProperty("--pxd-line");
    const wasClear = Boolean(rec.ends) && rec.label.classList.contains("pxd-label--clear");
    const words = shownEdgeLabel(edge.label, [fromHome, toHome]);
    rec.label.className = `pxd-label${named ? ` pxd-c-${edge.color}` : ""}${words || edge.why ? "" : " pxd-label--empty"}${edge.why ? " pxd-label--why" : ""}${selected ? " pxd-label--selected" : ""}${dim ? " pxd-label--dim" : ""}`;
    rec.label.title = edge.why ? whyTip(edge.why) : "";
    if (wasClear) rec.label.classList.add("pxd-label--clear");
    rec.label.style.color = hex || "";
    if (editingLabel?.uid !== edge.uid) rec.label.textContent = words;
    rec.dir = edge.dir;
    rec.weight = edge.weight;
    for (const end of ["from", "to"]) {
      const home = end === "from" ? fromHome : toHome;
      if (home) {
        const bend = bendOf(rec, end);
        bend.words = homeWords(home);
        bend.g.setAttribute("data-tip-extra", bend.words);
        continue;
      }
      const uid = end === "from" ? edge.fromBlock : edge.toBlock;
      if (!uid) { if (rec.bends?.[end]) dropBend(rec, end); continue; }
      bendOf(rec, end);
      bendTitle(rec, end, uid);
    }
  };

  const pagePill = (rec, end, text, point) => {
    let node = rec.pagePills?.[end];
    if (!text || !point) {
      node?.remove();
      if (rec.pagePills) delete rec.pagePills[end];
      return;
    }
    if (!node) {
      node = mk("text", "pxd-edge__page", rec.g);
      rec.pagePills = { ...(rec.pagePills || {}), [end]: node };
    }
    if (node.textContent !== text) node.textContent = text;
    node.setAttribute("x", String(point.x));
    node.setAttribute("y", String(point.y - 10));
  };
  const paintPagePills = (board, edge, rec, geo) => {
    for (const end of ["from", "to"]) {
      const item = board?.items?.get(end === "from" ? edge.from : edge.to);
      const page = item?.kind === "highlight" ? item.highlight?.page : null;
      pagePill(rec, end, highlightPill(page), geo ? (end === "from" ? geo.start : geo.end) : null);
    }
  };
  let placements = 0;
  const placeEdge = (board, edge, rec, rects, zoom) => {
    // E6: an edge riding the drag layer is placed once, when the drag ends (its layer carries it until then).
    if (drag?.recs.has(rec)) { rec.stale = true; return; }
    placements += 1;
    const geo = geometryFor(board, edge, rects);
    rec.geo = geo;
    if (!geo) {
      rec.g.setAttribute("display", "none");
      rec.label.style.display = "none";
      placeChildMarks(board, edge, rec, null, zoom, 0);
      placeInner(rec, edge, null, zoom);
      paintPagePills(board, edge, rec, null);
      return;
    }
    if (laneHidden.has(edge.uid)) {
      rec.g.setAttribute("display", "none");
      rec.label.style.display = "none";
      return;
    }
    rec.g.removeAttribute("display");
    rec.label.style.display = "";
    rec.hit.setAttribute("d", geo.d);
    rec.line.setAttribute("d", geo.d);
    const size = arrowSize(zoom, edge.weight);
    if (edge.dir === "none") {
      rec.head.setAttribute("display", "none");
      rec.tail.setAttribute("display", "none");
    } else {
      rec.head.removeAttribute("display");
      rec.head.setAttribute("d", arrowHeadPath(geo.end, geo.endAngle, size));
      if (edge.dir === "two") {
        rec.tail.removeAttribute("display");
        rec.tail.setAttribute("d", arrowHeadPath(geo.start, geo.startAngle + Math.PI, size));
      } else {
        rec.tail.setAttribute("display", "none");
      }
    }
    rec.dot.setAttribute("cx", String(geo.mid.x));
    rec.dot.setAttribute("cy", String(geo.mid.y));
    if (edge.fromBlock || edge.toBlock || rec.inner) placeInner(rec, edge, geo, zoom);
    if (edge.fromBlock || edge.toBlock || geo.fromHome || geo.toHome || rec.bends) {
      for (const end of ["from", "to"]) {
        const home = end === "from" ? geo.fromHome : geo.toHome;
        if (home) {
          const bend = bendOf(rec, end);
          bend.g.removeAttribute("display");
          if (!bend.words) bend.words = homeWords(home);
          placeBend(rec, end, end === "from" ? geo.start : geo.end, (end === "from" ? geo.fromClamp : geo.toClamp) || "top", zoom, end === "from" ? geo.fromSide : geo.toSide, end === "from" ? geo.fromW : geo.toW);
          continue;
        }
        const anchored = end === "from" ? geo.fromBlockAnchored : geo.toBlockAnchored;
        const uid = end === "from" ? edge.fromBlock : edge.toBlock;
        if (!uid || !anchored) { if (rec.bends?.[end]) rec.bends[end].g.setAttribute("display", "none"); continue; }
        const bend = bendOf(rec, end);
        bend.g.removeAttribute("display");
        placeBend(rec, end, end === "from" ? geo.start : geo.end, end === "from" ? geo.fromClamp : geo.toClamp, zoom, end === "from" ? geo.fromSide : geo.toSide, end === "from" ? geo.fromW : geo.toW);
      }
    }
    placeChildMarks(board, edge, rec, geo, zoom, size);
    placeEnds(rec, geo);
    paintPagePills(board, edge, rec, geo);
    rec.label.style.transform = `translate(${geo.mid.x}px, ${geo.mid.y}px) translate(-50%, -50%)`;
  };

  const buildLink = (link) => {
    const g = mk("g", "pxd-link", edgeHost?.target());
    g.dataset.key = link.key;
    g.setAttribute("data-key", link.key);
    const hit = mk("path", "pxd-link__hit", g);
    const line = mk("path", "pxd-link__line", g);
    const head = mk("path", "pxd-link__head", g);
    const label = doc.createElement("div");
    label.className = "pxd-label pxd-label--link";
    label.dataset.key = link.key;
    label.setAttribute("data-key", link.key);
    labelHost?.append(label);
    const rec = { g, hit, line, head, label, geo: null };
    linkEls.set(link.key, rec);
    return rec;
  };

  const placeLink = (link, rec, rects, zoom, selected) => {
    const a = rects.get(link.from);
    const b = rects.get(link.to);
    rec.from = link.from;
    rec.to = link.to;
    const dim = dimmed(link);
    const dash = link.dash === "solid" || link.dash === "dashed" || link.dash === "dotted" ? ` pxd-link--${link.dash}` : "";
    setClass(rec.g, `pxd-link pxd-c-${link.color || "gray"}${dash}${selected ? " pxd-link--selected" : ""}${dim ? " pxd-edge--dim" : ""}`);
    rec.label.className = `pxd-label pxd-label--link pxd-c-${link.color || "gray"}${selected ? " pxd-label--selected" : ""}${dim ? " pxd-label--dim" : ""}`;
    rec.label.textContent = link.labels?.[0] || "mentions";
    if (!a || !b) { rec.g.setAttribute("display", "none"); rec.label.style.display = "none"; return; }
    rec.g.removeAttribute("display");
    rec.label.style.display = "";
    const geo = edgePath({ a, b, route: "curve" });
    rec.geo = geo;
    rec.hit.setAttribute("d", geo.d);
    rec.line.setAttribute("d", geo.d);
    rec.head.setAttribute("d", arrowHeadPath(geo.end, geo.endAngle, arrowSize(zoom, 1) * 0.8));
    rec.label.style.transform = `translate(${geo.mid.x}px, ${geo.mid.y}px) translate(-50%, -50%)`;
  };

  const removeEdge = (uid) => {
    parkDue.delete(uid);
    const rec = edgeEls.get(uid);
    if (!rec) return;
    rec.g.remove();
    rec.label.remove();
    for (const end of ["from", "to"]) dropInner(rec, end);
    edgeEls.delete(uid);
  };
  const removeLink = (key) => {
    const rec = linkEls.get(key);
    if (!rec) return;
    rec.g.remove();
    rec.label.remove();
    linkEls.delete(key);
  };

  // Full or partial render. `dirty` = Set of edge uids to repaint; null = all.
  let lastPass = null;
  // Endpoints the board has actually drawn (shell, parked shell, overview cover, or snapshot).
  // Absent means every end counts. An unpainted end holds the edge only while its box meets `view`
  // (the viewport plus the attach margin). An end outside that view never holds it.
  let drawnFn = null;
  const waiting = new Set();
  const boxMeets = (r, box) => r.x < box.x + box.w && r.x + r.w > box.x && r.y < box.y + box.h && r.y + r.h > box.y;
  const endHolds = (board, uid, home) => {
    if (typeof drawnFn !== "function") return false;
    const anchor = edgeAnchor(board, uid, home);
    if (drawnFn(anchor)) return false;
    if (!view) return true;
    const rect = lastPass?.rects?.get(anchor);
    if (!rect) return true;
    return boxMeets(rect, view);
  };
  const endsReady = (board, edge) => !endHolds(board, edge.from, edge.homeFrom) && !endHolds(board, edge.to, edge.homeTo);
  const hideEdge = (rec) => {
    rec.g.setAttribute("display", "none");
    rec.label.style.display = "none";
  };
  const showEdge = (board, edge, rects, zoom, coveredEdges, selection) => {
    let rec = edgeEls.get(edge.uid);
    const fresh = !rec;
    if (!rec) rec = buildEdge(edge);
    else if (rec.parked) unparkEdge(rec);
    rec.stale = false;
    paintEdge(board, edge, rec, { covered: coveredEdges.has(edge.uid), selected: selection.edge === edge.uid });
    placeEdge(board, edge, rec, rects, zoom);
    return fresh;
  };
  // skipLinks: a continuation frame of a sliced settle; the links were placed with the first slice.
  const render = ({ board, rects, links = [], coveredEdges = new Set(), selection = {}, zoom = 1, dirty = null, view: near = undefined, skipLinks = false, drawn = undefined }) => {
    zoomCache = zoom;
    if (near !== undefined) view = near;
    if (drawn !== undefined) drawnFn = drawn;
    lastPass = { board, rects, coveredEdges, selection };
    const virt = Boolean(view) && virtualEdges(board);
    for (const uid of [...waiting]) if (!board.edges.has(uid)) waiting.delete(uid);
    for (const uid of [...edgeEls.keys()]) if (!board.edges.has(uid)) { waiting.delete(uid); removeEdge(uid); }
    for (const edge of board.edges.values()) {
      let rec = edgeEls.get(edge.uid);
      if (!endsReady(board, edge)) {
        waiting.add(edge.uid);
        if (rec && !rec.parked) hideEdge(rec);
        continue;
      }
      // A far virtual edge is not kept waiting: reveal and cull bring it back when the camera does.
      // Holding every far edge would make flushWaiting walk the whole board on each shell.
      if (virt && selection.edge !== edge.uid && editingLabel?.uid !== edge.uid) {
        const attached = rec && !rec.parked;
        if (attached ? edgeFar(board, edge, rects) : !edgeNear(board, edge, rects)) {
          waiting.delete(edge.uid);
          if (attached) parkLater(edge.uid, rec);
          else if (rec) parkEdge(rec);
          continue;
        }
        parkDue.delete(edge.uid);
      }
      // A slice names the edges for this frame. An edge with no element, or one that was hidden
      // until its cards counted as drawn, stays waiting when this frame did not name it.
      // Showing every newly-ready edge here dumped a zoom into overview into one task.
      const fresh = !rec;
      const wasHidden = Boolean(rec && !rec.parked && rec.g.getAttribute("display") === "none");
      if (dirty && !dirty.has(edge.uid) && (fresh || wasHidden)) continue;
      waiting.delete(edge.uid);
      if (fresh || wasHidden || !dirty || dirty.has(edge.uid) || rec.stale) showEdge(board, edge, rects, zoom, coveredEdges, selection);
    }
    if (!skipLinks) {
      const keys = new Set(links.map((l) => l.key));
      for (const key of [...linkEls.keys()]) if (!keys.has(key)) removeLink(key);
      for (const link of links) {
        const rec = linkEls.get(link.key) || buildLink(link);
        placeLink(link, rec, rects, zoom, selection.link === link.key);
      }
    }
    labelsLayer?.classList.toggle("pxd-labels--hidden", zoom < LABEL_HIDE_ZOOM);
  };

  // C3 (UX4, speed flag zoomHeads): a settle at a new zoom step changes only what the zoom sizes: arrow and link heads,
  // the label cut-off, and the screen-pixel pieces of block-end edges. The path, classes and label stay as they are.
  // A full re-place repainted and re-routed every edge (PhD main board zoom-out: 2,100 edges, 250 a frame, ~9 frames
  // of 50-110 ms). Returns the uids that still need a whole re-place (inner marks, bends). A parked edge is placed whole
  // at the new zoom when it comes back (zoomCache).
  // near: the settled camera's attach rect. On a virtual board an edge far from it is only marked stale (the settle's cull
  // parks it, and reveal or cull places it whole when it comes back); a zoom-in to detail left ~2,000 such heads to write.
  const resizeHeads = (zoom, near = null) => {
    zoomCache = zoom;
    const again = [];
    const board = lastPass?.board;
    const far = near && board && virtualEdges(board) ? lastPass.rects : null;
    if (far) view = near;
    for (const [uid, rec] of edgeEls) {
      if (rec.parked || rec.stale || !rec.geo) continue;
      if (far) {
        const edge = board.edges.get(uid);
        if (edge && edgeFar(board, edge, far)) { rec.stale = true; continue; }
      }
      if (rec.inner || rec.bends || rec.childMarks) { again.push(uid); continue; }
      if (rec.dir === "none" || rec.g.getAttribute("display") === "none") continue;
      const size = arrowSize(zoom, rec.weight);
      rec.head.setAttribute("d", arrowHeadPath(rec.geo.end, rec.geo.endAngle, size));
      if (rec.dir === "two") rec.tail.setAttribute("d", arrowHeadPath(rec.geo.start, rec.geo.startAngle + Math.PI, size));
    }
    for (const rec of linkEls.values()) {
      if (!rec.geo || rec.g.getAttribute("display") === "none") continue;
      rec.head.setAttribute("d", arrowHeadPath(rec.geo.end, rec.geo.endAngle, arrowSize(zoom, 1) * 0.8));
    }
    labelsLayer?.classList.toggle("pxd-labels--hidden", zoom < LABEL_HIDE_ZOOM);
    return again;
  };

  // Shells that landed after the open. Only the edges that were waiting are placed.
  const flushWaiting = () => {
    if (!lastPass || !waiting.size) return 0;
    const { board, rects, coveredEdges, selection } = lastPass;
    let n = 0;
    for (const uid of [...waiting]) {
      const edge = board.edges.get(uid);
      if (!edge) { waiting.delete(uid); continue; }
      if (!endsReady(board, edge)) continue;
      if (view && virtualEdges(board) && !edgeNear(board, edge, rects)) continue;
      waiting.delete(uid);
      showEdge(board, edge, rects, zoomCache, coveredEdges, selection);
      n += 1;
    }
    return n;
  };

  // A gesture frame: build or attach edges coming into `rect`, at most `budget` per frame. Parking waits for render.
  const reveal = (rect, budget = 80) => {
    if (!rect || !lastPass) return 0;
    view = rect;
    const { board, rects, coveredEdges, selection } = lastPass;
    if (!virtualEdges(board)) return 0;
    let n = 0;
    for (const edge of board.edges.values()) {
      if (n >= budget) break;
      const rec = edgeEls.get(edge.uid);
      if (rec && !rec.parked) continue;
      if (!endsReady(board, edge)) { waiting.add(edge.uid); continue; }
      if (!edgeNear(board, edge, rects)) continue;
      const live = rec || buildEdge(edge);
      if (rec) unparkEdge(live);
      live.stale = false;
      paintEdge(board, edge, live, { covered: coveredEdges.has(edge.uid), selected: selection.edge === edge.uid });
      placeEdge(board, edge, live, rects, zoomCache);
      n += 1;
    }
    return n;
  };

  // A settled camera after a pointer or wheel-zoom gesture: park what left the view, put back what came near.
  // budget / ms (C1, a sliced settle): build or re-place at most that many near edges (a selected or edited edge does
  // not count) and return how many near edges are still waiting for a later frame. E2-2 (perf2): a sliced cull parks
  // at most PARK_SLICE far edges a frame too (a zoom-in settle parked ~2,000 in one task); a far edge left for the next
  // slice is off the view and counts as waiting.
  const PARK_SLICE = 400;
  const cull = (rect, { budget = Infinity, ms = Infinity } = {}) => {
    if (!rect || !lastPass) return 0;
    view = rect;
    const { board, rects, coveredEdges, selection } = lastPass;
    if (!virtualEdges(board)) return 0;
    const t0 = ms < Infinity ? now() : 0;
    let built = 0;
    let left = 0;
    let parks = budget < Infinity ? PARK_SLICE : Infinity;
    const park = (rec, uid) => {
      if (rec.parked) return;
      if (deferPark() === true) { parkLater(uid, rec); return; }
      if (parks <= 0) { left += 1; return; }
      parks -= 1;
      parkEdge(rec);
    };
    for (const edge of board.edges.values()) {
      const rec = edgeEls.get(edge.uid);
      if (!endsReady(board, edge)) {
        waiting.add(edge.uid);
        if (rec && !rec.parked) hideEdge(rec);
        continue;
      }
      // Map zoom does not treat a cover box as drawn, so a zoom into overview can make the
      // whole waiting set ready at once. Leave those for the sliced render. A far one is parked
      // so flushWaiting does not walk it on every shell.
      if (waiting.has(edge.uid)) {
        const pinnedWait = selection.edge === edge.uid || editingLabel?.uid === edge.uid;
        const waitNear = pinnedWait || (rec && !rec.parked ? !edgeFar(board, edge, rects) : edgeNear(board, edge, rects));
        if (!waitNear) {
          if (rec && !rec.parked && parks <= 0 && deferPark() !== true) { left += 1; continue; }
          waiting.delete(edge.uid);
          if (rec) park(rec, edge.uid);
        }
        continue;
      }
      waiting.delete(edge.uid);
      const pinned = selection.edge === edge.uid || editingLabel?.uid === edge.uid;
      const near = pinned || (rec && !rec.parked ? !edgeFar(board, edge, rects) : edgeNear(board, edge, rects));
      if (!near) {
        if (rec) park(rec, edge.uid);
        continue;
      }
      parkDue.delete(edge.uid);
      if (rec && !rec.parked && !rec.stale) continue;
      if (!pinned && (built >= budget || (t0 && built % 16 === 0 && built && now() - t0 > ms))) { left += 1; continue; }
      const live = rec || buildEdge(edge);
      if (rec?.parked) unparkEdge(live);
      live.stale = false;
      paintEdge(board, edge, live, { covered: coveredEdges.has(edge.uid), selected: selection.edge === edge.uid });
      placeEdge(board, edge, live, rects, zoomCache);
      if (!pinned) built += 1;
    }
    return left;
  };

  // Re-place only the given edges (drag preview): rects may be an override map.
  // E3-6: during a drag ride, an edge or link re-placed here (it touches the moving set) leaves the edges <svg> for the
  // crossing layer first, also when it was attached after the drag began.
  const toCross = (rec) => {
    if (!drag?.cross || !edgeHost?.has(rec.g) || drag.recs.has(rec)) return;
    if (!drag.cross.parentElement) drag.layer.parentElement?.insertBefore?.(drag.cross, drag.layer);
    drag.cross.append(rec.g);
    if (rec.uid != null && edgeEls.get(rec.uid) === rec) drag.crossing.add(rec);
    else if (!drag.links.includes(rec)) drag.links.push(rec);
  };
  const update = ({ board, edgeUids, rects, zoom = zoomCache, linkKeys = null, links = [] }) => {
    for (const uid of edgeUids) {
      const edge = board.edges.get(uid);
      const rec = edgeEls.get(uid);
      if (rec && !rec.parked) toCross(rec);
      if (edge && rec && !rec.parked) placeEdge(board, edge, rec, rects, zoom);
      else if (rec?.parked) rec.stale = true;
    }
    if (linkKeys) {
      for (const link of links) {
        if (!linkKeys.has(link.key)) continue;
        const rec = linkEls.get(link.key);
        if (rec) toCross(rec);
        if (rec) placeLink(link, rec, rects, zoom, rec.g.getAttribute("class")?.includes("--selected"));
      }
    }
  };

  // Card selection leaves every edge alone. Only an edge that turned on or off is rewritten.
  let pickedEdge = null;
  let pickedLink = null;
  let selectionReady = false;
  const markEdge = (uid, on) => {
    const rec = edgeEls.get(uid);
    if (!rec) return;
    const cur = String(rec.g.getAttribute("class") || "");
    const base = cur.replace(/\s*pxd-edge--selected/g, "");
    const next = on ? `${base} pxd-edge--selected` : base;
    if (cur !== next) setClass(rec.g, next);
    if (Boolean(rec.label.classList.contains("pxd-label--selected")) !== on) {
      rec.label.classList.toggle("pxd-label--selected", on);
    }
    const inner = String(rec.innerCls || "").replace(/ pxd-inner--selected/g, "") + (on ? " pxd-inner--selected" : "");
    if (rec.innerCls !== inner) {
      rec.innerCls = inner;
      paintInner(rec);
    }
    syncEnds(rec, on);
  };
  const markLink = (key, on) => {
    const rec = linkEls.get(key);
    if (!rec) return;
    const cur = String(rec.g.getAttribute("class") || "");
    const base = cur.replace(/\s*pxd-link--selected/g, "");
    const next = on ? `${base} pxd-link--selected` : base;
    if (cur !== next) setClass(rec.g, next);
    if (Boolean(rec.label.classList.contains("pxd-label--selected")) !== on) {
      rec.label.classList.toggle("pxd-label--selected", on);
    }
  };
  const setSelection = ({ edge = null, link = null } = {}) => {
    const prevEdge = selectionReady ? pickedEdge : null;
    const prevLink = selectionReady ? pickedLink : null;
    if (selectionReady && prevEdge === edge && prevLink === link) return;
    selectionReady = true;
    pickedEdge = edge;
    pickedLink = link;
    if (prevEdge !== edge) {
      if (prevEdge) markEdge(prevEdge, false);
      if (edge) markEdge(edge, true);
    }
    if (prevLink !== link) {
      if (prevLink) markLink(prevLink, false);
      if (link) markLink(link, true);
    }
  };

  const setTempWire = (spec, rects, zoom = zoomCache) => {
    if (!spec) {
      wire?.line.remove();
      wire?.head.remove();
      wire = null;
      return;
    }
    if (!wire) {
      wire = { line: mk("path", "pxd-wire", overlaySvg), head: mk("path", "pxd-wire__head", overlaySvg) };
    }
    const a0 = rects.get(spec.from);
    const fromPoint = spec.fromPoint;
    if (!a0 && !fromPoint) return;
    const a = a0 || { x: fromPoint.x, y: fromPoint.y, w: 0, h: 0 };
    const b = { x: spec.point.x, y: spec.point.y, w: 0, h: 0 };
    const geo = edgePath({ a, b, fromSide: spec.fromSide || "auto", toSide: "auto", route: "curve", fromPoint: fromPoint || undefined });
    wire.line.setAttribute("d", geo.d);
    wire.head.setAttribute("d", arrowHeadPath(geo.end, geo.endAngle, arrowSize(zoom, 1)));
  };

  const setGuides = (guides = []) => {
    while (guideEls.length > guides.length) guideEls.pop().remove();
    while (guideEls.length < guides.length) guideEls.push(mk("line", "pxd-guide", overlaySvg));
    guides.forEach((gd, i) => {
      const el = guideEls[i];
      el.setAttribute("x1", String(gd.x1));
      el.setAttribute("y1", String(gd.y1));
      el.setAttribute("x2", String(gd.x2));
      el.setAttribute("y2", String(gd.y2));
    });
  };

  const setMarquee = (rect, kind = "select") => {
    if (!rect) {
      marquee?.remove();
      marquee = null;
      return;
    }
    if (!marquee) marquee = mk("rect", "pxd-marquee", overlaySvg);
    setClass(marquee, `pxd-marquee${kind === "section" ? " pxd-marquee--section" : kind === "region" ? " pxd-marquee--region" : ""}`);
    marquee.setAttribute("x", String(rect.x));
    marquee.setAttribute("y", String(rect.y));
    marquee.setAttribute("width", String(rect.w));
    marquee.setAttribute("height", String(rect.h));
  };

  const setLasso = (points) => {
    if (!points || points.length < 2) {
      lasso?.remove();
      lasso = null;
      return;
    }
    if (!lasso) lasso = mk("polygon", "pxd-lasso", overlaySvg);
    lasso.setAttribute("points", points.map((p) => `${p.x},${p.y}`).join(" "));
  };

  const setRegionPen = (points) => {
    if (!points || points.length < 2) {
      regionPen?.remove();
      regionPen = null;
      return;
    }
    if (!regionPen) regionPen = mk("polyline", "pxd-region-pen", overlaySvg);
    regionPen.setAttribute("fill", "transparent");
    regionPen.setAttribute("points", points.map((p) => `${p.x},${p.y}`).join(" "));
  };

  // Alt+drag duplicate preview: dashed world-space rects in the overlay svg. null/[] clears.
  const setGhosts = (list) => {
    const rects = list || [];
    while (ghostEls.length > rects.length) ghostEls.pop().remove();
    while (ghostEls.length < rects.length) ghostEls.push(mk("rect", "pxd-ghost", overlaySvg));
    rects.forEach((r, i) => {
      const el = ghostEls[i];
      el.setAttribute("x", String(r.x));
      el.setAttribute("y", String(r.y));
      el.setAttribute("width", String(r.w));
      el.setAttribute("height", String(r.h));
    });
  };

  // Focus mode: connections and derived links not fully inside `set` are dimmed. null clears.
  // PERF5-P3: a search with no edge among its hits dims the edge and label layers with one attribute each. A class on
  // every edge and label was 4,200 class changes on the first key of a 2,100-edge board (flag searchLayerDim).
  const setLayerDim = (on) => {
    for (const node of [svg, labelsLayer]) {
      if (!node || typeof node.hasAttribute !== "function" || node.hasAttribute("data-pxd-search-dim") === on) continue;
      if (on) node.setAttribute("data-pxd-search-dim", "");
      else node.removeAttribute("data-pxd-search-dim");
    }
  };
  const layerDim = () => Boolean(searchEdges) && searchEdges.size === 0 && notedSpeedFlags().searchLayerDim !== false;
  const applySearchClasses = () => {
    const layer = layerDim();
    setLayerDim(layer);
    for (const [uid, rec] of edgeEls) {
      const on = Boolean(searchEdges?.has(uid));
      const dim = dimmed(rec) || (searchEdges && !layer ? !on : false);
      rec.g.classList.toggle("pxd-edge--hit", on);
      rec.g.classList.toggle("pxd-edge--dim", dim);
      rec.label.classList.toggle("pxd-label--dim", dim);
    }
  };
  const setSearch = (uids) => {
    searchEdges = uids instanceof Set ? uids : null;
    applySearchClasses();
  };
  const setFocus = (set) => {
    focusSet = set && set.size !== undefined ? set : null;
    for (const rec of [...edgeEls.values(), ...linkEls.values()]) {
      const dim = dimmed(rec) || (searchEdges && !layerDim() ? !searchEdges.has(rec.g?.dataset?.uid) : false);
      rec.g.classList.toggle("pxd-edge--dim", dim);
      rec.label.classList.toggle("pxd-label--dim", dim);
    }
  };

  // Inline label editing on the pill (contenteditable). Commit on Enter / blur, cancel on Esc.
  const editLabel = (uid) => {
    const rec = edgeEls.get(uid);
    if (!rec || editingLabel) return false;
    const el = rec.label;
    const previous = el.textContent || "";
    editingLabel = { uid, previous };
    el.classList.remove("pxd-label--empty");
    el.classList.add("pxd-label--editing");
    el.contentEditable = "true";
    el.setAttribute("contenteditable", "true");
    el.spellcheck = false;
    const finish = (commit) => {
      if (!editingLabel || editingLabel.uid !== uid) return;
      editingLabel = null;
      el.contentEditable = "false";
      el.removeAttribute("contenteditable");
      el.classList.remove("pxd-label--editing");
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("pointerdown", stop);
      const next = String(el.textContent || "").trim();
      if (commit && next !== previous) onLabelCommit?.(uid, next);
      else el.textContent = previous;
      if (!el.textContent && !el.classList.contains("pxd-label--why")) el.classList.add("pxd-label--empty");
    };
    const onKey = (event) => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); finish(true); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
      else event.stopPropagation();
    };
    const onBlur = () => finish(true);
    const stop = (event) => event.stopPropagation();
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur);
    el.addEventListener("pointerdown", stop);
    try { el.focus({ preventScroll: true }); } catch { el.focus?.(); }
    // Start with the whole text selected so typing replaces it (Heptabase/Roam rename behavior).
    try { const d = el.ownerDocument; const r = d.createRange(); r.selectNodeContents(el); const s = d.getSelection(); s.removeAllRanges(); s.addRange(r); } catch { /* no selection API */ }
    return true;
  };

  // BA-3: replace the row measurements. Returns the edge uids whose block-end geometry changed.
  const setMeasures = (next) => {
    const changed = new Set();
    for (const uid of measures.keys()) if (!next.has(uid)) changed.add(uid);
    for (const [uid, m] of next) if (JSON.stringify(measures.get(uid) ?? null) !== JSON.stringify(m)) changed.add(uid);
    measures.clear();
    for (const [uid, m] of next) measures.set(uid, m);
    return changed;
  };

  // RF-2: hovering a block arrow lights its rows (the board view does that through onHover); only block edges report.
  const hoverEdge = (event) => event.target?.closest?.(".pxd-edge");
  listen(svg, "pointerover", (event) => {
    const g = hoverEdge(event);
    const uid = g?.getAttribute?.("data-uid");
    const rec = uid ? edgeEls.get(uid) : null;
    if (!rec || !(rec.bends && Object.keys(rec.bends).length)) return;
    if (event.buttons) return;
    setHover(uid, true);
    onHover?.(uid, true);
  });
  listen(svg, "pointerout", (event) => {
    const g = hoverEdge(event);
    const uid = g?.getAttribute?.("data-uid");
    if (!uid || hoverUid !== uid) return;
    if (event.relatedTarget && g.contains?.(event.relatedTarget)) return;
    setHover(uid, false);
    onHover?.(uid, false);
  });

  const geometryOf = (uid) => edgeEls.get(uid)?.geo ?? null;
  const linkGeometryOf = (key) => linkEls.get(key)?.geo ?? null;
  const labelRect = (uid) => {
    const rec = edgeEls.get(uid);
    return rec ? rec.label.getBoundingClientRect() : null;
  };

  const dispose = () => {
    endDrag(null);
    for (const uid of [...edgeEls.keys()]) removeEdge(uid);
    for (const key of [...linkEls.keys()]) removeLink(key);
    setTempWire(null);
    setGuides([]);
    setMarquee(null);
    setLasso(null);
    setRegionPen(null);
    setGhosts(null);
    focusSet = null;
    searchEdges = null;
    listeners.splice(0).forEach((off) => off());
    editingLabel = null;
  };

  // One background slice of the deferred parks: the ones still far are parked, a near one is left to the next pass.
  // Returns true when none is left.
  const PARK_PART = 100;
  const parkSome = (deadline = null) => {
    if (!lastPass) { parkDue.clear(); return true; }
    const { board, rects, selection } = lastPass;
    let n = 0;
    for (const uid of [...parkDue]) {
      if (n >= PARK_PART || (n && deadline && deadline.timeRemaining() < 1)) break;
      parkDue.delete(uid);
      const rec = edgeEls.get(uid);
      const edge = board.edges.get(uid);
      if (!rec || rec.parked || !edge || selection.edge === uid || editingLabel?.uid === uid || drag?.recs.has(rec)) continue;
      if (!view || edgeFar(board, edge, rects)) { parkEdge(rec); n += 1; }
    }
    return parkDue.size === 0;
  };
  // The gesture underlay draws a hairline for every edge that is not in the DOM.
  const edgeShown = (uid) => { const rec = edgeEls.get(uid); return Boolean(rec && !rec.parked); };
  return {
    edgeShown,
    isVirtual: (board) => virtualEdges(board),
    setCanvasTier: (on) => { canvasTier = typeof on === "function" ? on : () => Boolean(on); },
    render,
    update,
    resizeHeads,
    setZoomVars,
    placedZoom: () => zoomCache,
    reveal,
    cull,
    // Every built edge group, in the DOM or parked (lenses paint parked edges too).
    groups: () => [...edgeEls.values()].map((rec) => rec.g),
    attachedCount: () => {
      let n = 0;
      for (const rec of edgeEls.values()) if (!rec.parked) n += 1;
      return n;
    },
    placements: () => placements,
    beginDrag,
    dragBy,
    endDrag,
    dragInner: () => drag?.inner ?? null,
    flushWaiting,
    waitingLeft: () => waiting.size,
    parkSome,
    parkDueCount: () => parkDue.size,
    setSelection,
    setHover,
    setTempWire,
    setGuides,
    setMarquee,
    setLasso,
    setRegionPen,
    setGhosts,
    setFocus,
    setSearch,
    setMeasures,
    editLabel,
    setSuggest: (lines) => paintSuggest(doc, svg, lines),
    setLaneHidden(uids) {
      laneHidden.clear();
      for (const uid of uids || []) laneHidden.add(uid);
    },
    isEditingLabel: () => Boolean(editingLabel),
    geometryOf,
    linkGeometryOf,
    labelRect,
    labelEl: (uid) => edgeEls.get(uid)?.label ?? null,
    portPoint: (rect, side) => sidePoint(rect, side),
    dispose,
    _els: edgeEls,
  };
}
