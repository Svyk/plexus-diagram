// Connections, derived links, temp wire, guides and marquee as SVG. Arrowheads are explicit
// filled triangle paths (no <marker>), colors come from `pxd-c-<palette>` classes on the
// group (never var() in presentation attributes), and only edges touching moving items are
// recomputed during a drag.

import { routedEdge } from "../model/board.js";
import { arrowHeadPath, arrowSize, blockAnchor, center, edgePath, sidePoint } from "../model/geometry.js";
import { routeAround } from "../model/section6.js";
import { PALETTE, hexColor } from "../model/schema.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PAIR_OFFSET = 18;
const LABEL_HIDE_ZOOM = 0.3;

const setClass = (el, name) => {
  el.setAttribute("class", name);
  if (el.classList && !el.classList.contains(name.split(" ")[0])) el.className = name;
};

export function createEdgeLayer({ doc = globalThis.document, svg, labelsLayer, overlaySvg, onLabelCommit, blockText } = {}) {
  const edgeEls = new Map(); // uid → {g, hit, line, head, tail, dot, label}
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

  const geometryFor = (board, edge, rects) => {
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
    const m = edge.fromBlock || edge.toBlock ? measures.get(edge.uid) : null;
    if (m) {
      if (m.from && edge.fromBlock && routed.from === edge.from) {
        const an = blockAnchor({ rect: routed.a, ...m.from, other: center(routed.b) });
        fromPoint = an.point;
        fromSide = an.side;
        fromClamp = an.clamped;
      }
      if (m.to && edge.toBlock && routed.to === edge.to) {
        const an = blockAnchor({ rect: routed.b, ...m.to, other: center(routed.a) });
        toPoint = an.point;
        toSide = an.side;
        toClamp = an.clamped;
      }
    }
    const geo = edgePath({ a: routed.a, b: routed.b, fromSide, toSide, route: edge.route, offset: pairOffset(board, edge), via, fromPoint, toPoint });
    if (m) { geo.fromClamp = fromClamp; geo.toClamp = toClamp; geo.fromBlockAnchored = Boolean(fromPoint); geo.toBlockAnchored = Boolean(toPoint); }
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
    const rec = { g, hit, line, head, tail, dot, label, geo: null };
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
    mk("circle", "pxd-edge__bend-dot", g).setAttribute("r", "5");
    mk("path", "pxd-edge__bend-chevron", g);
    g.setAttribute("data-tip", "edge.bend");
    rec.bends = { ...(rec.bends || {}), [end]: { g, clamp: null } };
    return rec.bends[end];
  };
  const dropBend = (rec, end) => {
    const bend = rec.bends?.[end];
    if (!bend) return;
    bend.g.remove();
    delete rec.bends[end];
  };
  const placeBend = (rec, end, point, clamp, zoom) => {
    const bend = bendOf(rec, end);
    const scale = Math.min(3, Math.max(1, 1 / (zoom || 1)));
    bend.g.setAttribute("transform", `translate(${point.x} ${point.y}) scale(${scale})`);
    if (bend.clamp !== clamp) {
      bend.clamp = clamp;
      bend.g.setAttribute("class", `pxd-edge__bend${clamp ? " pxd-edge__bend--clamped" : ""}`);
      bend.g.setAttribute("data-clamp", clamp || "");
      bend.g.setAttribute("data-tip-state", clamp ? "clamped" : "inline");
      bend.g.querySelector?.(".pxd-edge__bend-chevron")?.setAttribute("d", clamp === "bottom" ? "M-3 -1.5L0 1.5L3 -1.5" : "M-3 1.5L0 -1.5L3 1.5");
    }
  };
  const bendTitle = (rec, end, uid) => {
    const bend = rec.bends?.[end];
    if (!bend) return;
    let text = "";
    try { text = String(blockText?.(uid) ?? "").trim().slice(0, 120); } catch { text = ""; }
    bend.g.setAttribute("data-tip-extra", text || "Block");
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
    setClass(rec.g, cls.join(" "));
    if (hex) rec.g.style.setProperty("--pxd-line", hex);
    else rec.g.style.removeProperty("--pxd-line");
    const wasClear = Boolean(rec.ends) && rec.label.classList.contains("pxd-label--clear");
    rec.label.className = `pxd-label${named ? ` pxd-c-${edge.color}` : ""}${edge.label ? "" : " pxd-label--empty"}${selected ? " pxd-label--selected" : ""}${dim ? " pxd-label--dim" : ""}`;
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

  const placeEdge = (board, edge, rec, rects, zoom) => {
    const geo = geometryFor(board, edge, rects);
    rec.geo = geo;
    if (!geo) {
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
    if (edge.fromBlock || edge.toBlock || rec.bends) {
      for (const end of ["from", "to"]) {
        const anchored = end === "from" ? geo.fromBlockAnchored : geo.toBlockAnchored;
        const uid = end === "from" ? edge.fromBlock : edge.toBlock;
        if (!uid || !anchored) { if (rec.bends?.[end]) rec.bends[end].g.setAttribute("display", "none"); continue; }
        const bend = bendOf(rec, end);
        bend.g.removeAttribute("display");
        placeBend(rec, end, end === "from" ? geo.start : geo.end, end === "from" ? geo.fromClamp : geo.toClamp, zoom);
      }
    }
    placeEnds(rec, geo);
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

  const setSelection = ({ edge = null, link = null } = {}) => {
    for (const [uid, rec] of edgeEls) {
      const on = uid === edge;
      const cls = String(rec.g.getAttribute("class") || "").replace(/\s*pxd-edge--selected/g, "");
      setClass(rec.g, on ? `${cls} pxd-edge--selected` : cls);
      rec.label.classList.toggle("pxd-label--selected", on);
      syncEnds(rec, on);
    }
    for (const [key, rec] of linkEls) {
      const on = key === link;
      const cls = String(rec.g.getAttribute("class") || "").replace(/\s*pxd-link--selected/g, "");
      setClass(rec.g, on ? `${cls} pxd-link--selected` : cls);
      rec.label.classList.toggle("pxd-label--selected", on);
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
    const a = rects.get(spec.from);
    if (!a) return;
    const b = { x: spec.point.x, y: spec.point.y, w: 0, h: 0 };
    const geo = edgePath({ a, b, fromSide: spec.fromSide || "auto", toSide: "auto", route: "curve" });
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
    setClass(marquee, `pxd-marquee${kind === "section" ? " pxd-marquee--section" : ""}`);
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
      if (!el.textContent) el.classList.add("pxd-label--empty");
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
    setTempWire,
    setGuides,
    setMarquee,
    setLasso,
    setGhosts,
    setFocus,
    setSearch,
    setMeasures,
    editLabel,
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
