// Connections, derived links, temp wire, guides and marquee as SVG. Arrowheads are explicit
// filled triangle paths (no <marker>), colors come from `pxd-c-<palette>` classes on the
// group (never var() in presentation attributes), and only edges touching moving items are
// recomputed during a drag.

import { anchorUid, routedEdge } from "../model/board.js";
import { edgeMayTarget, regionEdgePoint } from "../model/endpoints.js";
import { arrowHeadPath, arrowSize, blockAnchor, blockInner, center, edgePath, screenPx, sidePoint } from "../model/geometry.js";
import { routeAround } from "../model/section6.js";
import { PALETTE, hexColor } from "../model/schema.js";
import { highlightPill } from "../model/pdf-chips.js";
import { whyTip } from "../model/why.js";
import { paintSuggest } from "./suggest-lines.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PAIR_OFFSET = 18;
const LABEL_HIDE_ZOOM = 0.3;

const setClass = (el, name) => {
  el.setAttribute("class", name);
  if (el.classList && !el.classList.contains(name.split(" ")[0])) el.className = name;
};

export function createEdgeLayer({ doc = globalThis.document, svg, labelsLayer, overlaySvg, onLabelCommit, blockText, onHover } = {}) {
  const edgeEls = new Map(); // uid → {g, hit, line, head, tail, dot, label}
  const laneHidden = new Set();
  const linkEls = new Map(); // key → {g, hit, line, head, label}
  let wire = null;
  let marquee = null;
  let lasso = null;
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

  const pairOffset = (board, edge) => {
    for (const other of board.edges.values()) {
      if (other.uid !== edge.uid && other.from === edge.to && other.to === edge.from) {
        return edge.uid < other.uid ? PAIR_OFFSET : -PAIR_OFFSET;
      }
    }
    return 0;
  };

  // A measured end. A region lands on the region edge (no inner notch). A folded pin stays on the card face.
  const endOn = (spec, rect, other) => {
    if (!spec || !rect || spec.face) return null;
    if (spec.region && spec.image) {
      const hit = regionEdgePoint(
        { x: rect.x + spec.image.x, y: rect.y + spec.image.y, w: spec.image.w, h: spec.image.h },
        spec.frac,
        center(other),
      );
      return hit ? { point: hit.point, side: hit.side, region: true } : null;
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
      const itemRect = rects.get(anchorUid(board, itemUid));
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
      const m = edge.fromBlock || edge.toBlock ? measures.get(edge.uid) : null;
      if (m?.from && edge.fromBlock && !fromEdge) {
        const hit = endOn(m.from, a, b);
        if (hit) {
          fromPoint = hit.point;
          fromSide = hit.side;
          fromClamp = hit.clamp ?? null;
          if (!hit.region) fromInnerSpec = hit.inner || null;
        }
      }
      if (m?.to && edge.toBlock && !toEdge) {
        const hit = endOn(m.to, b, a);
        if (hit) {
          toPoint = hit.point;
          toSide = hit.side;
          toClamp = hit.clamp ?? null;
          if (!hit.region) toInnerSpec = hit.inner || null;
        }
      }
      const geo = edgePath({ a, b, fromSide, toSide, route: edge.route, offset: pairOffset(board, edge), fromPoint, toPoint });
      geo.fromClamp = fromClamp;
      geo.toClamp = toClamp;
      geo.fromW = a.w;
      geo.toW = b.w;
      geo.fromBlockAnchored = Boolean(fromPoint) && !fromEdge && !m?.from?.region;
      geo.toBlockAnchored = Boolean(toPoint) && !toEdge && !m?.to?.region;
      geo.fromInner = fromInnerSpec ? blockInner(fromInnerSpec) : null;
      geo.toInner = toInnerSpec ? blockInner(toInnerSpec) : null;
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
    const m = edge.fromBlock || edge.toBlock ? measures.get(edge.uid) : null;
    if (m) {
      if (m.from && edge.fromBlock && routed.from === edge.from) {
        const hit = endOn(m.from, routed.a, routed.b);
        if (hit) {
          fromPoint = hit.point;
          fromSide = hit.side;
          fromClamp = hit.clamp ?? null;
          if (!hit.region) fromInnerSpec = hit.inner || null;
        }
      }
      if (m.to && edge.toBlock && routed.to === edge.to) {
        const hit = endOn(m.to, routed.b, routed.a);
        if (hit) {
          toPoint = hit.point;
          toSide = hit.side;
          toClamp = hit.clamp ?? null;
          if (!hit.region) toInnerSpec = hit.inner || null;
        }
      }
    }
    const geo = edgePath({ a: routed.a, b: routed.b, fromSide, toSide, route: edge.route, offset: pairOffset(board, edge), via, fromPoint, toPoint });
    if (m) { geo.fromClamp = fromClamp; geo.toClamp = toClamp; geo.fromW = routed.a.w; geo.toW = routed.b.w; geo.fromBlockAnchored = Boolean(fromPoint) && !m.from?.region; geo.toBlockAnchored = Boolean(toPoint) && !m.to?.region; geo.fromInner = fromInnerSpec ? blockInner(fromInnerSpec) : null; geo.toInner = toInnerSpec ? blockInner(toInnerSpec) : null; }
    return geo;
  };

  const buildEdge = (edge) => {
    const g = mk("g", "pxd-edge", svg);
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
    labelsLayer?.append(label);
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
      rec.ends[end] = c;
    }
    placeEnds(rec, rec.geo);
  };

  const dimmed = (e) => Boolean(focusSet) && !(focusSet.has(e.from) && focusSet.has(e.to));

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
    if (!edge.valid) cls.push("pxd-edge--invalid");
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
    rec.label.className = `pxd-label${named ? ` pxd-c-${edge.color}` : ""}${edge.label || edge.why ? "" : " pxd-label--empty"}${edge.why ? " pxd-label--why" : ""}${selected ? " pxd-label--selected" : ""}${dim ? " pxd-label--dim" : ""}`;
    rec.label.title = edge.why ? whyTip(edge.why) : "";
    if (wasClear) rec.label.classList.add("pxd-label--clear");
    rec.label.style.color = hex || "";
    if (editingLabel?.uid !== edge.uid) rec.label.textContent = edge.label || "";
    rec.dir = edge.dir;
    rec.weight = edge.weight;
    for (const end of ["from", "to"]) {
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
  const placeEdge = (board, edge, rec, rects, zoom) => {
    const geo = geometryFor(board, edge, rects);
    rec.geo = geo;
    if (!geo) {
      rec.g.setAttribute("display", "none");
      rec.label.style.display = "none";
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
    if (edge.fromBlock || edge.toBlock || rec.bends) {
      for (const end of ["from", "to"]) {
        const anchored = end === "from" ? geo.fromBlockAnchored : geo.toBlockAnchored;
        const uid = end === "from" ? edge.fromBlock : edge.toBlock;
        if (!uid || !anchored) { if (rec.bends?.[end]) rec.bends[end].g.setAttribute("display", "none"); continue; }
        const bend = bendOf(rec, end);
        bend.g.removeAttribute("display");
        placeBend(rec, end, end === "from" ? geo.start : geo.end, end === "from" ? geo.fromClamp : geo.toClamp, zoom, end === "from" ? geo.fromSide : geo.toSide, end === "from" ? geo.fromW : geo.toW);
      }
    }
    placeEnds(rec, geo);
    paintPagePills(board, edge, rec, geo);
    rec.label.style.transform = `translate(${geo.mid.x}px, ${geo.mid.y}px) translate(-50%, -50%)`;
  };

  const buildLink = (link) => {
    const g = mk("g", "pxd-link", svg);
    g.dataset.key = link.key;
    g.setAttribute("data-key", link.key);
    const hit = mk("path", "pxd-link__hit", g);
    const line = mk("path", "pxd-link__line", g);
    const head = mk("path", "pxd-link__head", g);
    const label = doc.createElement("div");
    label.className = "pxd-label pxd-label--link";
    label.dataset.key = link.key;
    label.setAttribute("data-key", link.key);
    labelsLayer?.append(label);
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
  const render = ({ board, rects, links = [], coveredEdges = new Set(), selection = {}, zoom = 1, dirty = null }) => {
    zoomCache = zoom;
    for (const uid of [...edgeEls.keys()]) if (!board.edges.has(uid)) removeEdge(uid);
    for (const edge of board.edges.values()) {
      let rec = edgeEls.get(edge.uid);
      const fresh = !rec;
      if (!rec) rec = buildEdge(edge);
      if (fresh || !dirty || dirty.has(edge.uid)) {
        paintEdge(board, edge, rec, { covered: coveredEdges.has(edge.uid), selected: selection.edge === edge.uid });
        placeEdge(board, edge, rec, rects, zoom);
      }
    }
    const keys = new Set(links.map((l) => l.key));
    for (const key of [...linkEls.keys()]) if (!keys.has(key)) removeLink(key);
    for (const link of links) {
      const rec = linkEls.get(link.key) || buildLink(link);
      placeLink(link, rec, rects, zoom, selection.link === link.key);
    }
    labelsLayer?.classList.toggle("pxd-labels--hidden", zoom < LABEL_HIDE_ZOOM);
  };

  // Re-place only the given edges (drag preview): rects may be an override map.
  const update = ({ board, edgeUids, rects, zoom = zoomCache, linkKeys = null, links = [] }) => {
    for (const uid of edgeUids) {
      const edge = board.edges.get(uid);
      const rec = edgeEls.get(uid);
      if (edge && rec) placeEdge(board, edge, rec, rects, zoom);
    }
    if (linkKeys) {
      for (const link of links) {
        if (!linkKeys.has(link.key)) continue;
        const rec = linkEls.get(link.key);
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
  const applySearchClasses = () => {
    for (const [uid, rec] of edgeEls) {
      const on = Boolean(searchEdges?.has(uid));
      const dim = dimmed(rec) || (searchEdges ? !on : false);
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
      const dim = dimmed(rec) || (searchEdges ? !searchEdges.has(rec.g?.dataset?.uid) : false);
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
    for (const uid of [...edgeEls.keys()]) removeEdge(uid);
    for (const key of [...linkEls.keys()]) removeLink(key);
    setTempWire(null);
    setGuides([]);
    setMarquee(null);
    setLasso(null);
    setGhosts(null);
    focusSet = null;
    searchEdges = null;
    listeners.splice(0).forEach((off) => off());
    editingLabel = null;
  };

  return {
    render,
    update,
    setSelection,
    setHover,
    setTempWire,
    setGuides,
    setMarquee,
    setLasso,
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
