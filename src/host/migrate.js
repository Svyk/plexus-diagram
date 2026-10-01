import {
  BOARD_PATTERNS,
  CARD_FONT_MAX,
  CARD_FONT_MIN,
  DEFAULT_SIZES,
  MIN_SIZES,
  PALETTE,
  SIDES,
  edgeString,
  plainKeys,
  readPlexus,
  semanticRef,
  serializeEdge,
  serializeItemLayout,
  styleColor,
  withBoardMarker,
} from "../model/schema.js";

export const METADATA_PAGE = "plexus-diagram/metadata";

function sortedKids(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
  return kids
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i)
    .map(({ c }) => c);
}

const str = (n) => String(n?.[":block/string"] ?? "").trim();

function pair(text) {
  const p = String(text).split(",").map((s) => Number(s.trim()));
  return p.length >= 2 && p.slice(0, 2).every(Number.isFinite) ? { a: p[0], b: p[1], c: p[2] } : null;
}

function prop(line, name) {
  return line.startsWith(`${name}::`) ? line.slice(name.length + 2).trim() : null;
}

const ROUTES = { bezier: "curve", curve: "curve", straight: "straight", step: "elbow", smoothstep: "elbow", elbow: "elbow" };
const DIRS = { oneWay: "one", twoWay: "two", none: "none" };

export function readV06Entry(host, boardUid) {
  const page = host.pullPage(METADATA_PAGE);
  if (!page) return null;
  const root = sortedKids(page).find((c) => str(c) === "enhanced::");
  if (!root) return null;
  const entryNode = sortedKids(root).find((c) => str(c) === boardUid);
  if (!entryNode) return null;

  const out = { nodes: new Map(), sections: [], edges: [], viewport: null, entryUid: entryNode[":block/uid"], migrated: false };
  for (const child of sortedKids(entryNode)) {
    const line = str(child);
    const vp = prop(line, "viewport");
    if (vp !== null) {
      const p = pair(vp);
      if (p && Number.isFinite(p.c)) out.viewport = { x: p.a, y: p.b, zoom: p.c };
      continue;
    }
    if (line.startsWith("migrated::")) { out.migrated = true; continue; }
    if (line.startsWith("node ")) {
      const uid = line.slice(5).trim();
      const node = { x: undefined, y: undefined, w: undefined, h: undefined, color: undefined };
      for (const k of sortedKids(child)) {
        const l = str(k);
        const pos = prop(l, "pos");
        const size = prop(l, "size");
        const color = prop(l, "color");
        if (pos !== null) { const p = pair(pos); if (p) { node.x = p.a; node.y = p.b; } }
        if (size !== null) { const p = pair(size); if (p) { node.w = p.a; node.h = p.b; } }
        if (color !== null && PALETTE.includes(color)) node.color = color;
      }
      out.nodes.set(uid, node);
      continue;
    }
    if (line.startsWith("edge ")) {
      const m = /^(.+)->(.+)$/.exec(line.slice(5).trim());
      if (!m) continue;
      const edge = { from: m[1].trim(), to: m[2].trim(), route: "curve", label: "", fromSide: "auto", toSide: "auto", dir: "one", color: undefined };
      for (const k of sortedKids(child)) {
        const l = str(k);
        const kind = prop(l, "kind");
        const label = prop(l, "label");
        const from = prop(l, "from");
        const to = prop(l, "to");
        const dir = prop(l, "direction");
        const color = prop(l, "color");
        if (kind !== null) edge.route = ROUTES[kind] ?? "curve";
        if (label !== null) edge.label = label;
        if (from !== null && SIDES.includes(from)) edge.fromSide = from;
        if (to !== null && SIDES.includes(to)) edge.toSide = to;
        if (dir !== null && DIRS[dir]) edge.dir = DIRS[dir];
        if (color !== null && PALETTE.includes(color)) edge.color = color;
      }
      out.edges.push(edge);
      continue;
    }
    if (line.startsWith("section ")) {
      const sec = { id: line.slice(8).trim(), x: undefined, y: undefined, w: undefined, h: undefined, title: "", color: undefined };
      for (const k of sortedKids(child)) {
        const l = str(k);
        const pos = prop(l, "pos");
        const size = prop(l, "size");
        const title = prop(l, "title");
        const color = prop(l, "color");
        if (pos !== null) { const p = pair(pos); if (p) { sec.x = p.a; sec.y = p.b; } }
        if (size !== null) { const p = pair(size); if (p) { sec.w = p.a; sec.h = p.b; } }
        if (title !== null) sec.title = title;
        if (color !== null && PALETTE.includes(color)) sec.color = color;
      }
      out.sections.push(sec);
    }
  }
  return out;
}

function parseData(raw) {
  if (typeof raw === "string") {
    try { return plainKeys(JSON.parse(raw)) ?? {}; } catch { return {}; }
  }
  return raw && typeof raw === "object" ? plainKeys(raw) : {};
}

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const asMap = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// Native keys read from :diagram.node/data, :diagram.edge/data, and :block/props :rf-diagram.
// Plexus never writes these. Alpha on #rrggbbaa is dropped; plexus stores #rrggbb.
export const NATIVE_STYLE = {
  block: {
    "block-font-size": "fontSize",
    "block-text-color": "textColor",
    "block-text-align": "align",
    "block-fill-color": "fill",
    "block-border-color": "border",
  },
  group: {
    "group-title-font-size": "titleSize",
    "group-title-text-color": "titleColor",
    "group-title-fill-color": "titleFill",
    "group-area-fill-color": "areaFill",
    "group-border-color": "border",
  },
  edge: {
    "edge-direction-type": "dir",
    "edge-decoration": "dash",
    "edge-type": "route",
    "edge-stroke-color": "color",
  },
  board: {
    "diagram-background-color": "bgColor",
    "diagram-background-texture": "bg",
  },
};

const NATIVE_DIR = { directed: "one", undirected: "none", bidirected: "two" };
const NATIVE_DASH = { solid: "solid", dashed: "dashed", animated: "animated" };
const NATIVE_ROUTE = {
  "floating-straight": "straight",
  straight: "straight",
  "floating-smooth-step": "elbow",
  smoothstep: "elbow",
  step: "elbow",
  "floating-bezier": "curve",
  bezier: "curve",
  default: "curve",
};
const NATIVE_ALIGN = { left: "left", center: "center", right: "right", justify: "justify" };
const CSS_NAMED = { black: "#000000", white: "#ffffff" };

export function nativeColor(value) {
  if (typeof value !== "string") return undefined;
  const s = value.trim().toLowerCase();
  if (CSS_NAMED[s]) return CSS_NAMED[s];
  if (PALETTE.includes(s)) return s;
  let hex = s;
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
  else if (/^#[0-9a-f]{8}$/.test(hex)) hex = hex.slice(0, 7);
  if (/^#[0-9a-f]{6}$/.test(hex)) return styleColor(hex);
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s);
  if (!rgb) return undefined;
  const ch = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
  return styleColor(`#${ch(rgb[1])}${ch(rgb[2])}${ch(rgb[3])}`);
}

function styleBags(data) {
  const top = asMap(data);
  const inner = asMap(top.data);
  return { top, inner, inferred: asMap(inner["inferred-defaults"]) };
}

function pickStyle(bags, defaults, key) {
  if (bags.inner[key] !== undefined) return bags.inner[key];
  if (bags.top[key] !== undefined) return bags.top[key];
  if (bags.inferred[key] !== undefined) return bags.inferred[key];
  if (defaults && defaults[key] !== undefined) return defaults[key];
  return undefined;
}

function mapNodeStyle(data, kind, defaults) {
  const bags = styleBags(data);
  const spec = kind === "group" ? NATIVE_STYLE.group : NATIVE_STYLE.block;
  const out = {};
  for (const [from, to] of Object.entries(spec)) {
    const raw = pickStyle(bags, defaults, from);
    if (raw === undefined) continue;
    if (to === "fontSize" || to === "titleSize") {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n)) continue;
      out[to] = Math.max(CARD_FONT_MIN, Math.min(CARD_FONT_MAX, n));
    } else if (to === "align") {
      if (NATIVE_ALIGN[raw]) out.align = NATIVE_ALIGN[raw];
    } else {
      const color = nativeColor(raw);
      if (color) out[to] = color;
    }
  }
  return out;
}

function mapEdgeStyle(data) {
  const bags = styleBags(data);
  const pick = (key) => (bags.inner[key] !== undefined ? bags.inner[key] : bags.top[key]);
  const out = { dir: "one", dash: "solid", route: "straight" };
  const dir = NATIVE_DIR[pick("edge-direction-type")];
  if (dir) out.dir = dir;
  const dash = NATIVE_DASH[pick("edge-decoration")];
  if (dash) out.dash = dash;
  else if (bags.top.animated === true || bags.inner.animated === true) out.dash = "animated";
  else if (bags.top.style?.strokeDasharray || bags.inner.style?.strokeDasharray) out.dash = "dashed";
  out.route = NATIVE_ROUTE[pick("edge-type")] ?? NATIVE_ROUTE[bags.top.type] ?? "straight";
  const color = nativeColor(pick("edge-stroke-color"))
    ?? nativeColor(bags.inner.style?.stroke)
    ?? nativeColor(bags.top.style?.stroke);
  if (color) out.color = color;
  return out;
}

function readDiagramStyle(pulled) {
  const props = plainKeys(pulled?.[":block/props"]);
  const rf = asMap(props?.["rf-diagram"]);
  const bag = { ...rf, ...asMap(rf["diagram-property-data"]) };
  const boardStyle = {};
  if (BOARD_PATTERNS.includes(bag["diagram-background-texture"])) boardStyle.bg = bag["diagram-background-texture"];
  const bg = nativeColor(bag["diagram-background-color"]);
  if (bg) boardStyle.bgColor = bg;
  const over = asMap(rf["overridden-data-defaults"]);
  return { boardStyle, blockDefaults: asMap(over.block), groupDefaults: asMap(over.group) };
}

export function readNative(host, boardUid) {
  const pulled = host.pullNative(boardUid);
  const rawNodes = Array.isArray(pulled?.[":diagram/nodes"]) ? pulled[":diagram/nodes"] : [];
  const rawEdges = Array.isArray(pulled?.[":diagram/edges"]) ? pulled[":diagram/edges"] : [];
  const { boardStyle, blockDefaults, groupDefaults } = readDiagramStyle(pulled);
  const keyById = new Map();
  const nodes = rawNodes.map((n) => {
    const id = n[":db/id"];
    const blockUid = n[":diagram.node/block"]?.[":block/uid"] ?? null;
    const key = blockUid ?? `n${id}`;
    keyById.set(id, key);
    const data = parseData(n[":diagram.node/data"]);
    const abs = data.positionAbsolute && finite(data.positionAbsolute.x) !== undefined ? data.positionAbsolute : null;
    const pos = abs ?? data.position ?? {};
    const type = data.type === "group" ? "group" : "node";
    return {
      key,
      blockUid,
      x: finite(pos.x) ?? 0,
      y: finite(pos.y) ?? 0,
      w: finite(data.width) ?? finite(data.measured?.width),
      h: finite(data.height) ?? finite(data.measured?.height),
      absolute: Boolean(abs),
      parentId: n[":diagram.node/parent-node"]?.[":db/id"],
      type,
      title: n[":diagram.node/block"]?.[":block/string"] ?? "",
      style: mapNodeStyle(data, type, type === "group" ? groupDefaults : blockDefaults),
    };
  });
  for (const n of nodes) {
    n.parentNode = n.parentId != null ? keyById.get(n.parentId) : undefined;
    delete n.parentId;
  }
  const edges = [];
  for (const e of rawEdges) {
    const from = keyById.get(e[":diagram.edge/source"]?.[":db/id"]);
    const to = keyById.get(e[":diagram.edge/target"]?.[":db/id"]);
    if (!from || !to) continue;
    const data = parseData(e[":diagram.edge/data"]);
    const style = mapEdgeStyle(data);
    edges.push({ from, to, label: typeof data.label === "string" ? data.label : (typeof data.data?.label === "string" ? data.data.label : ""), ...style });
  }
  return { nodes, edges, boardStyle };
}

const round1 = (n) => Math.round(n * 10) / 10;
const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const inside = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

function defaultGen() {
  let n = 0;
  return () => `imp${String(++n).padStart(6, "0")}`;
}

function refOf(board, uid, sectionUids) {
  const item = board.items.get(uid);
  if (item && !sectionUids.has(uid)) return semanticRef(item);
  return `((${uid}))`;
}

function edgePlan(board, sectionUids, from, to, label, extra = {}) {
  const dir = extra.dir ?? "one";
  return {
    from,
    to,
    label,
    string: edgeString({ srcRef: refOf(board, from, sectionUids), dstRef: refOf(board, to, sectionUids), dir, label }),
    props: serializeEdge({ from, to, dir, ...extra, type: undefined }),
  };
}

function planV06(board, source, gen) {
  const plan = { itemLayouts: [], sections: [], memberLayouts: [], edges: [], viewport: source.viewport ?? null, markMigratedUid: source.entryUid ?? null };
  const secs = source.sections.map((s) => {
    const uid = gen();
    const w = s.w ?? DEFAULT_SIZES.section.w;
    const h = s.h ?? DEFAULT_SIZES.section.h;
    const abs = { x: s.x ?? 0, y: s.y ?? 0, w, h };
    return {
      uid,
      abs,
      entry: { uid, title: s.title || "Section", layout: { type: "section", x: abs.x, y: abs.y, w, h, color: s.color }, members: [], parent: null },
    };
  });
  plan.sections = secs.map((s) => s.entry);
  const sectionUids = new Set(plan.sections.map((s) => s.uid));

  for (const [uid, node] of source.nodes) {
    const item = board.items.get(uid);
    if (!item || item.type === "section") continue;
    const abs = {
      x: node.x ?? item.x,
      y: node.y ?? item.y,
      w: node.w ?? item.w,
      h: node.h ?? item.h,
    };
    const c = centerOf(abs);
    let best = null;
    for (const s of secs) {
      if (!inside(s.abs, c)) continue;
      if (!best || s.abs.w * s.abs.h < best.abs.w * best.abs.h) best = s;
    }
    const layout = { type: item.type, w: abs.w, h: abs.h, color: node.color };
    if (best) {
      best.entry.members.push(uid);
      plan.memberLayouts.push({ uid, layout: { ...layout, x: round1(abs.x - best.abs.x), y: round1(abs.y - best.abs.y) } });
    } else {
      plan.itemLayouts.push({ uid, layout: { ...layout, x: abs.x, y: abs.y } });
    }
  }

  for (const e of source.edges) {
    if (!board.items.has(e.from) || !board.items.has(e.to) || e.from === e.to) continue;
    plan.edges.push(edgePlan(board, sectionUids, e.from, e.to, e.label ?? "", {
      fromSide: e.fromSide, toSide: e.toSide, dir: e.dir, route: e.route, color: e.color,
    }));
  }
  return plan;
}

function planNative(board, source, gen) {
  const plan = { itemLayouts: [], sections: [], memberLayouts: [], edges: [], viewport: null, markMigratedUid: null };
  const nodes = source.nodes;
  const byKey = new Map(nodes.map((n) => [n.key, n]));

  const widths = nodes.filter((n) => n.type !== "group").map((n) => n.w).filter((w) => w > 0).sort((a, b) => a - b);
  const typical = widths.length ? widths[Math.floor(widths.length / 2)] : 165;
  const scale = Math.max(1, 240 / typical);

  const absCache = new Map();
  const absOf = (n, seen = new Set()) => {
    if (absCache.has(n.key)) return absCache.get(n.key);
    let p = { x: n.x, y: n.y };
    if (!n.absolute && n.parentNode && !seen.has(n.key)) {
      const parent = byKey.get(n.parentNode);
      if (parent) {
        seen.add(n.key);
        const pa = absOf(parent, seen);
        p = { x: pa.x + n.x, y: pa.y + n.y };
      }
    }
    absCache.set(n.key, p);
    return p;
  };

  const sectionOf = new Map(); // node key -> {uid, abs (scaled), entry}
  const groups = nodes.filter((n) => n.type === "group");
  for (const g of groups) {
    const existing = g.blockUid && board.items.has(g.blockUid);
    const uid = existing ? g.blockUid : gen();
    const a = absOf(g);
    const abs = {
      x: a.x * scale,
      y: a.y * scale,
      w: (g.w ?? DEFAULT_SIZES.section.w / scale) * scale,
      h: (g.h ?? DEFAULT_SIZES.section.h / scale) * scale,
    };
    sectionOf.set(g.key, {
      uid,
      abs,
      entry: { uid, title: g.title || board.items.get(uid)?.title || "Section", layout: null, members: [], parent: null, existing: Boolean(existing) },
    });
  }
  for (const g of groups) {
    const s = sectionOf.get(g.key);
    const parent = g.parentNode ? sectionOf.get(g.parentNode) : null;
    const base = parent ? { x: parent.abs.x, y: parent.abs.y } : { x: 0, y: 0 };
    s.entry.parent = parent ? parent.uid : null;
    s.entry.layout = {
      type: "section",
      x: round1(s.abs.x - base.x),
      y: round1(s.abs.y - base.y),
      w: round1(s.abs.w),
      h: round1(s.abs.h),
      ...(g.style || {}),
    };
    plan.sections.push(s.entry);
  }
  const sectionUids = new Set(plan.sections.map((s) => s.uid));

  const uidOfKey = new Map();
  for (const g of groups) uidOfKey.set(g.key, sectionOf.get(g.key).uid);

  for (const n of nodes) {
    if (n.type === "group") continue;
    const item = n.blockUid ? board.items.get(n.blockUid) : null;
    if (!item || item.type === "section") continue;
    uidOfKey.set(n.key, item.uid);
    const a = absOf(n);
    const abs = { x: a.x * scale, y: a.y * scale };
    const layout = {
      type: item.type,
      w: Math.max(MIN_SIZES.card.w, Math.round((n.w ?? item.w / scale) * scale)),
      h: Math.max(MIN_SIZES.card.h, Math.round((n.h ?? item.h / scale) * scale)),
      ...(n.style || {}),
    };
    const sec = n.parentNode ? sectionOf.get(n.parentNode) : null;
    if (sec) {
      sec.entry.members.push(item.uid);
      plan.memberLayouts.push({ uid: item.uid, layout: { ...layout, x: round1(abs.x - sec.abs.x), y: round1(abs.y - sec.abs.y) } });
    } else {
      plan.itemLayouts.push({ uid: item.uid, layout: { ...layout, x: round1(abs.x), y: round1(abs.y) } });
    }
  }

  for (const e of source.edges) {
    const from = uidOfKey.get(e.from);
    const to = uidOfKey.get(e.to);
    if (!from || !to || from === to) continue;
    plan.edges.push(edgePlan(board, sectionUids, from, to, e.label ?? "", {
      dir: e.dir, route: e.route, dash: e.dash, color: e.color,
    }));
  }
  if (source.boardStyle && Object.keys(source.boardStyle).length) plan.boardStyle = source.boardStyle;
  return plan;
}

export function planImport(board, source, { gen = defaultGen() } = {}) {
  if (!source) return { itemLayouts: [], sections: [], memberLayouts: [], edges: [], viewport: null, markMigratedUid: null };
  return source.nodes instanceof Map ? planV06(board, source, gen) : planNative(board, source, gen);
}

export async function executeImport(plan, host, board) {
  const counts = { sections: 0, members: 0, items: 0, edges: 0 };
  const layoutProps = (layout) => serializeItemLayout(layout);
  // Layout writes replace the whole :plexus key, so carry an existing board marker (v, bg) across.
  const keepMarker = (uid, layout) => {
    const cur = readPlexus(host.pullProps?.(uid));
    return layoutProps(cur ? { ...layout, v: cur.v, bg: cur.bg } : layout);
  };

  // Sections first (all created at board root, nested ones moved afterwards).
  for (const s of plan.sections) {
    if (s.existing) await host.updateProps(s.uid, keepMarker(s.uid, { ...s.layout, type: "section" }));
    else {
      await host.createBlock({
        parentUid: board.uid,
        order: "last",
        uid: s.uid,
        string: s.title,
        props: { plexus: layoutProps({ ...s.layout, type: "section" }) },
      });
    }
    counts.sections++;
  }
  for (const s of plan.sections) {
    if (s.parent) await host.moveBlock(s.uid, s.parent, "last");
  }
  const memberLayouts = new Map(plan.memberLayouts.map((m) => [m.uid, m.layout]));
  for (const s of plan.sections) {
    for (const uid of s.members) {
      await host.moveBlock(uid, s.uid, "last");
      const layout = memberLayouts.get(uid);
      if (layout) await host.updateProps(uid, keepMarker(uid, layout));
      counts.members++;
    }
  }
  for (const { uid, layout } of plan.itemLayouts) {
    await host.updateProps(uid, keepMarker(uid, layout));
    counts.items++;
  }

  if (plan.edges.length) {
    let containerUid = board.containerUid;
    if (!containerUid) {
      containerUid = await host.createBlock({
        parentUid: board.uid,
        order: "last",
        string: "Connections",
        props: { plexus: { type: "edges" } },
        open: false,
      });
    }
    for (const e of plan.edges) {
      await host.createBlock({ parentUid: containerUid, order: "last", string: e.string, props: { plexus: e.props } });
      counts.edges++;
    }
  }

  if (plan.markMigratedUid) {
    await host.createBlock({ parentUid: plan.markMigratedUid, order: "last", string: "migrated:: 2" });
  }
  if (plan.viewport) {
    host.viewports?.set(board.uid, plan.viewport);
    host.viewports?.flushAll?.();
  }
  const markerBase = { ...(board.plexus || {}) };
  if (plan.boardStyle && Object.keys(plan.boardStyle).length) Object.assign(markerBase, plan.boardStyle);
  await host.updateProps(board.uid, withBoardMarker(markerBase, true));
  return counts;
}
