import { inflate } from "./geometry.js";
import {
  BOARD_PATTERNS,
  BOARD_TONES,
  DEFAULT_SIZES,
  FIT_PAD,
  cardLook,
  classifyString,
  firstLine,
  hexColor,
  normalizeEdge,
  normalizeItemLayout,
  normalizeSectionDefaults,
  parseBoardTitle,
  parseEdgeLabel,
  readPlexus,
  semanticRef,
} from "./schema.js";
import { isQueryString } from "./query.js";
import { listFromNodes } from "./snapshots.js";

const AUTO_GAP = 40;
const AUTO_OFFSET = 48;
const AUTO_ROWS = 4;
const TITLE_BAND = 32;
const BORDER_BAND = 8;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function sortedChildren(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
  return kids
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i)
    .map(({ c }) => c);
}

function rectOf(o) { return { x: o.x, y: o.y, w: o.w, h: o.h }; }
function unionRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
function contains(r, p) {
  if (!r || !p) return false;
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
function containsRect(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}
function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function centerOf(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

function autoPlace(siblings) {
  const placed = siblings.filter((s) => s.hasLayout);
  const loose = siblings.filter((s) => !s.hasLayout);
  if (!loose.length) return;
  let startX = 0;
  let startY = 0;
  if (placed.length) {
    const u = placed.map(rectOf).reduce(unionRect);
    startX = u.x + u.w + AUTO_OFFSET;
    startY = u.y;
  }
  let colX = startX;
  let colW = 0;
  let y = startY;
  loose.forEach((item, i) => {
    const row = i % AUTO_ROWS;
    if (i > 0 && row === 0) { colX += colW + AUTO_GAP; colW = 0; y = startY; }
    item.x = colX;
    item.y = y;
    y += item.h + AUTO_GAP;
    colW = Math.max(colW, item.w);
  });
}

export function buildBoard(pulled, { defaults } = {}) {
  if (!pulled || typeof pulled !== "object") return null;
  const uid = pulled[":block/uid"];
  const string = pulled[":block/string"] ?? "";
  const plexus = readPlexus(pulled[":block/props"]);
  const sizes = { ...DEFAULT_SIZES, card: defaults?.card ?? DEFAULT_SIZES.card };

  const items = new Map();
  const edges = new Map();
  const roots = [];
  const preorder = [];
  let containerUid = null;
  let containerIndex = -1;

  const boardKids = sortedChildren(pulled);
  let snapshotsUid = null;
  boardKids.forEach((child, index) => {
    const marker = readPlexus(child[":block/props"])?.type;
    if (containerUid === null && marker === "edges") {
      containerUid = child[":block/uid"];
      containerIndex = index;
    }
    if (snapshotsUid === null && marker === "snapshots") snapshotsUid = child[":block/uid"];
  });

  const sectionDefaults = normalizeSectionDefaults(plexus?.defaults?.section);

  const walk = (children, parentUid, depth) => {
    const siblings = [];
    for (const child of children) {
      const cuid = child[":block/uid"];
      if (cuid === containerUid || cuid === snapshotsUid) continue;
      const cplexus = readPlexus(child[":block/props"]);
      const cstring = child[":block/string"] ?? "";
      const heading = child[":block/heading"] || 0;
      const kids = sortedChildren(child);
      const layout = normalizeItemLayout(cplexus);
      let type = layout.type;
      if (!cplexus && heading > 0 && kids.length) type = "section";
      const cls = classifyString(cstring);
      const kind = type === "section" ? "section" : type === "text" ? "text" : cls.kind;
      const size = sizes[type];
      const hasLayout = isNum(layout.x) && isNum(layout.y);
      let title;
      if (kind === "page") title = cls.title;
      else if (kind === "board") title = parseBoardTitle(cstring) || "Untitled board";
      else if (isQueryString(cstring)) title = "Query";
      else title = firstLine(cstring);
      let target;
      if (kind === "page") target = { kind: "page", title: cls.title };
      else if (kind === "block") target = { kind: "block", uid: cls.refUid };
      else target = { kind: "self", uid: cuid };
      const item = {
        uid: cuid,
        type,
        kind,
        string: cstring,
        heading,
        parentUid,
        order: child[":block/order"] ?? siblings.length,
        depth,
        x: hasLayout ? layout.x : 0,
        y: hasLayout ? layout.y : 0,
        w: layout.w ?? size.w,
        h: layout.h ?? size.h,
        hasLayout,
        color: layout.color,
        collapsed: layout.collapsed === true,
        fontSize: layout.fontSize,
        textColor: type === "section" ? undefined : layout.textColor,
        align: type === "section" ? undefined : layout.align,
        fill: type === "section" ? undefined : layout.fill,
        border: layout.border,
        titleSize: type === "section" ? layout.titleSize : undefined,
        titleColor: type === "section" ? layout.titleColor : undefined,
        titleFill: type === "section" ? layout.titleFill : undefined,
        areaFill: type === "section" ? layout.areaFill : undefined,
        sectionDefaults: type === "section" ? sectionDefaults : undefined,
        pinned: layout.pinned,
        kids: type === "card" && layout.kids === true,
        look: type === "card" ? cardLook(kind, layout.look) : (type === "text" || type === "section" ? layout.look : undefined),
        ...(type === "section" && layout.look === "lane" ? { axis: layout.axis || "horizontal" } : {}),
        ...(type === "text" && layout.shape ? { shape: layout.shape } : {}),
        open: type === "card" ? child[":block/open"] !== false : undefined,
        autofit: !(type === "section" && layout.fit === false),
        title,
        target,
        enhanced: kind === "board" && cplexus?.v === 2,
        members: [],
        content: type === "section" ? [] : kids,
      };
      items.set(cuid, item);
      preorder.push(cuid);
      siblings.push(item);
      if (type === "section") {
        item.members = walk(kids, cuid, depth + 1).map((m) => m.uid);
      }
    }
    autoPlace(siblings);
    return siblings;
  };

  for (const item of walk(boardKids, uid, 0)) roots.push(item.uid);

  const sections = preorder.filter((u) => items.get(u).type === "section");
  const rest = preorder.filter((u) => items.get(u).type !== "section");
  sections.sort((a, b) => items.get(a).depth - items.get(b).depth);
  const order = [...sections, ...rest];

  if (containerUid !== null) {
    const container = boardKids[containerIndex];
    for (const e of sortedChildren(container)) {
      const eplexus = readPlexus(e[":block/props"]);
      if (eplexus?.type !== "edge") continue;
      const euid = e[":block/uid"];
      const estring = e[":block/string"] ?? "";
      const n = normalizeEdge(eplexus);
      const a = items.get(n.from);
      const b = items.get(n.to);
      edges.set(euid, {
        uid: euid,
        string: estring,
        ...n,
        label: parseEdgeLabel(estring, n.fromBlock ? `((${n.fromBlock}))` : a ? semanticRef(a) : "", n.toBlock ? `((${n.toBlock}))` : b ? semanticRef(b) : ""),
        valid: Boolean(a && b),
      });
    }
  }

  return {
    uid,
    string,
    title: parseBoardTitle(string),
    plexus,
    enhanced: plexus?.v === 2,
    background: {
      pattern: BOARD_PATTERNS.includes(plexus?.bg) ? plexus.bg : null,
      tone: BOARD_TONES.includes(plexus?.bgColor) ? plexus.bgColor : (hexColor(plexus?.bgColor) || null),
    },
    defaults: { section: sectionDefaults },
    items,
    roots,
    order,
    containerUid,
    containerIndex,
    snapshotsUid,
    snapshots: listFromNodes(sortedChildren(snapshotsUid ? boardKids.find((child) => child[":block/uid"] === snapshotsUid) : null)),
    childCount: boardKids.length,
    edges,
  };
}

// Visual height of a collapsed section. Stored :plexus h is left alone.
export const COLLAPSED_SECTION_H = 8;

// The item a connection should attach to. A section-note sticks to its section. Anything inside a
// collapsed section sticks to the outermost collapsed section. A visible item sticks to itself.
export function anchorUid(board, uid) {
  const start = board?.items.get(uid);
  if (!start) return uid;
  let cur = uid;
  if (start.type === "text" && start.look === "section-note") {
    const parent = board.items.get(start.parentUid);
    if (parent?.type === "section") cur = parent.uid;
  }
  let collapsed = null;
  let walk = cur;
  while (walk && walk !== board.uid) {
    const item = board.items.get(walk);
    if (!item) break;
    if (item.type === "section" && item.collapsed) collapsed = item.uid;
    walk = item.parentUid;
  }
  return collapsed || cur;
}

// First direct text child whose look is section-note. That block is the section's description line.
export function sectionNoteUid(board, sectionUid) {
  const item = board?.items.get(sectionUid);
  if (!item || item.type !== "section") return null;
  for (const m of item.members || []) {
    const kid = board.items.get(m);
    if (kid?.type === "text" && kid.look === "section-note") return kid.uid;
  }
  return null;
}

// Rects the view paints and hit-tests. Hidden members and section notes are omitted. A collapsed
// section keeps its stored origin and width and uses COLLAPSED_SECTION_H. `stored` is not mutated.
export function displayRects(board, stored) {
  const base = stored ?? (board ? worldRects(board) : new Map());
  if (!board) return new Map(base);
  const out = new Map();
  for (const [uid, r] of base) {
    if (!r || anchorUid(board, uid) !== uid) continue;
    const item = board.items.get(uid);
    const next = item?.type === "section" && item.collapsed
      ? { x: r.x, y: r.y, w: r.w, h: COLLAPSED_SECTION_H }
      : { x: r.x, y: r.y, w: r.w, h: r.h };
    if (item?.type === "text" && item.shape) next.shape = item.shape;
    out.set(uid, next);
  }
  return out;
}

// Endpoints after collapse. Null when both ends land on the same visible item (no loop on the section).
export function routedEdge(board, edge, rects) {
  if (!board || !edge) return null;
  const from = anchorUid(board, edge.from);
  const to = anchorUid(board, edge.to);
  if (!from || !to || from === to) return null;
  const a = rects?.get(from);
  const b = rects?.get(to);
  if (!a || !b) return null;
  return { from, to, a, b };
}

export function worldRects(board) {
  const rects = new Map();
  for (const item of board.items.values()) {
    const p = item.parentUid === board.uid ? null : rects.get(item.parentUid);
    const rect = { x: item.x + (p?.x ?? 0), y: item.y + (p?.y ?? 0), w: item.w, h: item.h };
    if (item.type === "text" && item.shape) rect.shape = item.shape;
    rects.set(item.uid, rect);
  }
  return rects;
}

export function worldRect(board, uid, rects) {
  if (rects) return rects.get(uid) ?? null;
  const item = board.items.get(uid);
  if (!item) return null;
  let x = item.x;
  let y = item.y;
  let parent = board.items.get(item.parentUid);
  while (parent) {
    x += parent.x;
    y += parent.y;
    parent = board.items.get(parent.parentUid);
  }
  const rect = { x, y, w: item.w, h: item.h };
  if (item.type === "text" && item.shape) rect.shape = item.shape;
  return rect;
}

export function descendantsOf(board, uid) {
  const out = new Set();
  const stack = [...(board.items.get(uid)?.members ?? [])];
  while (stack.length) {
    const u = stack.pop();
    if (out.has(u)) continue;
    out.add(u);
    stack.push(...(board.items.get(u)?.members ?? []));
  }
  return out;
}

function hasAncestorIn(board, uid, set) {
  let p = board.items.get(uid)?.parentUid;
  while (p && p !== board.uid) {
    if (set.has(p)) return true;
    p = board.items.get(p)?.parentUid;
  }
  return false;
}

export function topLevelOf(board, uids) {
  const list = [...uids].filter((u) => board.items.has(u));
  const set = new Set(list);
  return list.filter((u) => !hasAncestorIn(board, u, set));
}

export function containerAt(board, point, { exclude = new Set(), rects } = {}) {
  const r = rects ?? worldRects(board);
  const ex = exclude instanceof Set ? exclude : new Set(exclude);
  let best = null;
  for (const uid of board.order) {
    const item = board.items.get(uid);
    if (item.type !== "section" || ex.has(uid) || hasAncestorIn(board, uid, ex)) continue;
    if (!contains(r.get(uid), point)) continue;
    if (!best || item.depth >= best.depth) best = item;
  }
  return best ? best.uid : board.uid;
}

export function toRelative(board, containerUid, worldPoint, rects) {
  if (containerUid === board.uid) return { x: worldPoint.x, y: worldPoint.y };
  const c = worldRect(board, containerUid, rects);
  return { x: worldPoint.x - c.x, y: worldPoint.y - c.y };
}

export function hitTest(board, point, rects, { sectionInterior = false, exclude = null } = {}) {
  for (let i = board.order.length - 1; i >= 0; i--) {
    const item = board.items.get(board.order[i]);
    if (item.type === "section" || exclude?.has(item.uid)) continue;
    if (contains(rects.get(item.uid), point)) return { uid: item.uid, part: "body" };
  }
  for (let i = board.order.length - 1; i >= 0; i--) {
    const item = board.items.get(board.order[i]);
    if (item.type !== "section" || exclude?.has(item.uid)) continue;
    const r = rects.get(item.uid);
    if (!contains(r, point)) continue;
    if (point.y - r.y <= TITLE_BAND) return { uid: item.uid, part: "title" };
    const edge = Math.min(point.x - r.x, r.x + r.w - point.x, point.y - r.y, r.y + r.h - point.y);
    if (edge <= BORDER_BAND) return { uid: item.uid, part: "border" };
    if (sectionInterior) return { uid: item.uid, part: "interior" };
  }
  return null;
}

export function boundsOf(rectList) {
  const list = [...rectList];
  return list.length ? list.reduce(unionRect) : null;
}

// Top-left of a card whose center sits on the content center. An empty board uses the origin.
export function cardAtCenter(bounds, size) {
  const w = size?.w || 0;
  const h = size?.h || 0;
  const cx = bounds ? bounds.x + bounds.w / 2 : 0;
  const cy = bounds ? bounds.y + bounds.h / 2 : 0;
  return { x: cx - w / 2, y: cy - h / 2 };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const PREVIEW_MIN = { w: DEFAULT_SIZES.card.w * 2, h: DEFAULT_SIZES.card.h * 2 };
const PREVIEW_TITLE = 40;

// Thumbnail of a nested board card: the child's items as fractions of a padded frame around their bounds.
// Built from the card's already pulled subtree, so it needs no extra read. `bounds` stays the unpadded
// absolute child bounds (moveIntoBoard uses it); `rects`/`edges` are relative to the drawn frame.
export function boardPreview(item, { max = 60, aspect = null, pad = 0.12 } = {}) {
  const empty = { count: 0, aspect: 1.6, rects: [], edges: [], bounds: null, empty: true };
  const child = buildBoard({
    ":block/uid": item?.uid,
    ":block/string": item?.string ?? "",
    ":block/children": item?.content ?? [],
  });
  if (!child) return empty;
  const world = worldRects(child);
  const bounds = boundsOf([...world.values()]);
  if (!bounds) return empty;
  const bw = bounds.w || 1;
  const bh = bounds.h || 1;
  let w = Math.max(bw, PREVIEW_MIN.w);
  let h = Math.max(bh, PREVIEW_MIN.h);
  const p = Math.max(FIT_PAD, pad * Math.max(bw, bh));
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  w += 2 * p;
  h += 2 * p;
  const target = isNum(aspect) && aspect > 0 ? aspect : clamp(w / h, 0.25, 4);
  if (w / h < target) w = h * target;
  else h = w / target;
  const fx = cx - w / 2;
  const fy = cy - h / 2;
  const rects = [];
  for (const uid of child.order) {
    if (rects.length >= max) break;
    const r = world.get(uid);
    const it = child.items.get(uid);
    let title;
    if (it.type === "section") title = it.title;
    else title = firstLine(it.string).slice(0, PREVIEW_TITLE) || (it.kind === "board" ? it.title.slice(0, PREVIEW_TITLE) : "");
    rects.push({
      x: (r.x - fx) / w, y: (r.y - fy) / h, w: r.w / w, h: r.h / h,
      type: it.type, kind: it.kind, color: it.color, title,
      ...(!title && it.kind === "block" && it.target?.uid ? { ref: it.target.uid } : {}),
    });
  }
  const edges = [];
  for (const e of child.edges.values()) {
    if (!e.valid) continue;
    const a = centerOf(world.get(e.from));
    const b = centerOf(world.get(e.to));
    edges.push({ x1: (a.x - fx) / w, y1: (a.y - fy) / h, x2: (b.x - fx) / w, y2: (b.y - fy) / h });
  }
  return { count: child.items.size, aspect: target, rects, edges, bounds, empty: false };
}

// Grow-only plan that keeps auto-fit sections around their members. `rects` are world rects (may hold live
// drag rects); touched uids walk up their section chain and each section grows to contain the padded child.
// A pinned section never grows (the walk stops at it).
export function sectionFitPlan(board, rects, touchedUids, {
  pad = FIT_PAD,
  skip = new Set(),
  parentOf = (u) => board.items.get(u)?.parentUid,
} = {}) {
  const work = new Map();
  const same = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01
    && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01;
  for (const touched of touchedUids) {
    let cur = touched;
    for (let guard = 0; guard < 256; guard++) {
      const pid = parentOf(cur);
      if (!pid || pid === board.uid) break;
      const sec = board.items.get(pid);
      if (!sec || sec.type !== "section" || sec.autofit === false || sec.pinned || skip.has(pid)) break;
      const secRect = work.get(pid) ?? rects.get(pid);
      const childRect = work.get(cur) ?? rects.get(cur);
      if (!secRect || !childRect) break;
      const need = unionRect(secRect, inflate(childRect, pad));
      if (same(need, secRect)) break;
      work.set(pid, need);
      cur = pid;
    }
  }
  const depthOf = (u) => {
    let d = 0;
    let cur = u;
    for (let i = 0; i < 256; i++) {
      const pid = parentOf(cur);
      if (!pid || pid === board.uid) break;
      d++;
      cur = pid;
    }
    return d;
  };
  return [...work.entries()]
    .map(([uid, rect]) => ({ uid, rect, depth: depthOf(uid) }))
    .sort((a, b) => b.depth - a.depth)
    .map(({ uid, rect }) => ({ uid, rect }));
}

// Top-level cards and sections, then the Connections block. Nested members stay inside their parent
// render, so the sidebar outline does not list them twice and does not write :block/open.
export function sidebarOutlineUids(board) {
  if (!board) return [];
  const uids = [...(board.roots || [])];
  if (board.containerUid) uids.push(board.containerUid);
  return uids;
}

// Desired sibling order so the outline reads like the board: top to bottom, then left to right.
// A section stays a parent. Its cards are ordered inside it, not lifted up next to it.
export function readingOrder(board, rects) {
  if (!board) return [];
  const key = (uid) => {
    const r = rects?.get?.(uid);
    const item = board.items.get(uid);
    return { y: r?.y ?? item?.y ?? 0, x: r?.x ?? item?.x ?? 0 };
  };
  const byPos = (uids) => [...(uids || [])].sort((a, b) => {
    const pa = key(a);
    const pb = key(b);
    return pa.y - pb.y || pa.x - pb.x || (a < b ? -1 : a > b ? 1 : 0);
  });
  const groups = [];
  const visit = (parent, uids) => {
    const sorted = byPos(uids);
    if (!sorted.length) return;
    groups.push({ parent, uids: sorted });
    for (const uid of sorted) {
      const item = board.items.get(uid);
      if (item?.type === "section") visit(uid, item.members);
    }
  };
  visit(board.uid, board.roots);
  return groups;
}

// Item uids in Roam outline order (depth first, siblings by block order): the Tab traversal order.
export function outlineOrder(board) {
  const byOrder = (uids) => uids
    .map((u, i) => ({ u, i, o: board.items.get(u)?.order ?? i }))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .map(({ u }) => u);
  const out = [];
  const visit = (uid) => {
    out.push(uid);
    for (const m of byOrder(board.items.get(uid).members)) visit(m);
  };
  for (const uid of byOrder(board.roots)) visit(uid);
  return out;
}

export function itemsInRect(board, rect, rects, { mode = "contain" } = {}) {
  const test = mode === "intersect" ? intersects : (r, a) => containsRect(r, a);
  const hits = [];
  for (const uid of board.order) {
    const r = rects.get(uid);
    if (r && test(rect, r)) hits.push(uid);
  }
  return topLevelOf(board, hits);
}

function onSegment(a, b, p) {
  const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > 1e-9) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  if (dot < -1e-9) return false;
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= len2 + 1e-9;
}

// Even-odd fill. A point on an edge counts as inside. Fewer than three vertices is never inside.
export function pointInPolygon(point, polygon) {
  const n = polygon?.length ?? 0;
  if (!point || n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (onSegment(polygon[j], polygon[i], point)) return true;
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = polygon[i].y;
    const yj = polygon[j].y;
    const xi = polygon[i].x;
    const xj = polygon[j].x;
    const intersect = (yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Item center inside the polygon, then the outermost selected ancestor, same rule as the rectangle marquee.
export function itemsInPolygon(board, polygon, rects) {
  if (!board || !Array.isArray(polygon) || polygon.length < 3) return [];
  const r = rects ?? worldRects(board);
  const hits = [];
  for (const uid of board.order) {
    const rect = r.get(uid);
    if (rect && pointInPolygon(centerOf(rect), polygon)) hits.push(uid);
  }
  return topLevelOf(board, hits);
}

// Every item of the same stored color. A missing color matches the other uncolored items. Edges are not items.
export function sameColorUids(board, uid) {
  const seed = board?.items.get(uid);
  if (!seed) return [];
  const color = seed.color || null;
  const out = [];
  for (const id of board.order) {
    const item = board.items.get(id);
    if ((item.color || null) === color) out.push(id);
  }
  return out;
}

// Undirected component over valid edges. The seed is included. Invalid edges and missing endpoints are skipped.
export function connectedUids(board, uid) {
  if (!board?.items.has(uid)) return [];
  const adj = new Map();
  const link = (a, b) => {
    if (!board.items.has(a) || !board.items.has(b) || a === b) return;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (const edge of board.edges.values()) {
    if (!edge.valid) continue;
    link(edge.from, edge.to);
  }
  const out = [];
  const seen = new Set([uid]);
  const queue = [uid];
  while (queue.length) {
    const current = queue.shift();
    out.push(current);
    for (const next of adj.get(current) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return out;
}

// Everything nested in a section, including cards inside inner sections. Direct members stay on item.members.
export function sectionAllUids(board, uid) {
  const item = board?.items.get(uid);
  if (!item || item.type !== "section") return [];
  const kids = descendantsOf(board, uid);
  return board.order.filter((id) => kids.has(id));
}

export function membershipPlan(board, movedUids, rects) {
  const moved = topLevelOf(board, movedUids);
  const exclude = new Set(moved);
  const plan = [];
  for (const uid of moved) {
    const item = board.items.get(uid);
    const r = rects.get(uid);
    const toParent = containerAt(board, centerOf(r), { exclude, rects });
    if (toParent === item.parentUid) continue;
    const rel = toRelative(board, toParent, { x: r.x, y: r.y }, rects);
    plan.push({ uid, fromParent: item.parentUid, toParent, x: rel.x, y: rel.y });
  }
  return plan;
}

export function sectionAdoptPlan(board, sectionUid, rects) {
  const section = board.items.get(sectionUid);
  if (!section) return [];
  const sr = rects.get(sectionUid);
  const parentUid = section.parentUid;
  const siblings = parentUid === board.uid ? board.roots : board.items.get(parentUid).members;
  const plan = [];
  for (const uid of siblings) {
    if (uid === sectionUid) continue;
    const r = rects.get(uid);
    if (!contains(sr, centerOf(r))) continue;
    const rel = toRelative(board, sectionUid, { x: r.x, y: r.y }, rects);
    plan.push({ uid, toParent: sectionUid, x: rel.x, y: rel.y });
  }
  for (const uid of section.members) {
    const r = rects.get(uid);
    if (contains(sr, centerOf(r))) continue;
    const rel = toRelative(board, parentUid, { x: r.x, y: r.y }, rects);
    plan.push({ uid, toParent: parentUid, x: rel.x, y: rel.y });
  }
  return plan;
}

export function edgesTouching(board, uidSet) {
  const full = new Set(uidSet);
  for (const u of uidSet) for (const d of descendantsOf(board, u)) full.add(d);
  const out = new Set();
  for (const e of board.edges.values()) if (full.has(e.from) || full.has(e.to)) out.add(e.uid);
  return out;
}

export function findEdge(board, from, to) {
  for (const e of board.edges.values()) if (e.from === from && e.to === to) return e;
  return null;
}

export function diffBoards(prev, next) {
  if (!prev || !next) {
    const dirty = new Set();
    if (next) {
      for (const u of next.items.keys()) dirty.add(u);
      for (const u of next.edges.keys()) dirty.add(u);
    }
    return { structural: true, dirty };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let structural = prev.containerUid !== next.containerUid
    || prev.items.size !== next.items.size
    || prev.edges.size !== next.edges.size
    || !same(prev.roots, next.roots)
    || !same(prev.order, next.order);
  const dirty = new Set();
  if (prev.string !== next.string || !same(prev.plexus, next.plexus)) dirty.add(next.uid);
  for (const [uid, item] of next.items) {
    const old = prev.items.get(uid);
    if (!old) { structural = true; dirty.add(uid); continue; }
    if (old.parentUid !== item.parentUid || !same(old.members, item.members)) structural = true;
    if (!same(old, item)) dirty.add(uid);
  }
  for (const [uid, edge] of next.edges) {
    const old = prev.edges.get(uid);
    if (!old) { structural = true; dirty.add(uid); continue; }
    if (!same(old, edge)) dirty.add(uid);
  }
  return { structural, dirty };
}
