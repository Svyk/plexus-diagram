import { isDiagramString } from "./discovery.js";

export const DIAGRAM_PULL_PATTERN = `[:block/uid :block/string :block/props
  {:block/children [:block/uid :block/string :block/order]}
  {:diagram/nodes [:block/uid :diagram.node/data
    {:diagram.node/block [:block/uid :block/string]}
    {:diagram.node/parent-node [:db/id :block/uid]}]}
  {:diagram/edges [:block/uid :diagram.edge/data
    {:diagram.edge/source [:block/uid :db/id]}
    {:diagram.edge/target [:block/uid :db/id]}]}]`;

export function stripKeywords(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(stripKeywords);
  if (typeof value !== "object") return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    const normalizedKey = key.startsWith(":") ? key.slice(1) : key;
    out[normalizedKey] = stripKeywords(val);
  }
  return out;
}

export function childrenFingerprint(children) {
  return JSON.stringify(
    (children || [])
      .map((child) => [child.uid, child.string, child.order])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

export function treeFingerprint(tree) {
  const visit = (node) => [node.uid, node.string, (node.children || []).map(visit)];
  return JSON.stringify(visit(tree));
}

function normalizePull(node) {
  if (!node) return null;
  const children = (node[":block/children"] || node.children || [])
    .map(normalizePull)
    .filter(Boolean)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    uid: node[":block/uid"] ?? node.uid,
    string: node[":block/string"] ?? node.string ?? "",
    order: node[":block/order"] ?? node.order ?? 0,
    props: stripKeywords(node[":block/props"] ?? node.props ?? {}),
    children,
    diagramNodes: (node[":diagram/nodes"] || node.diagramNodes || []).map((n) => ({
      uid: n[":block/uid"] ?? n.uid,
      data: stripKeywords(n[":diagram.node/data"] ?? n.data ?? {}),
      contentBlock: normalizePull(n[":diagram.node/block"] ?? n.contentBlock),
      parentNode: n[":diagram.node/parent-node"] ?? n.parentNode ?? null,
    })),
    diagramEdges: (node[":diagram/edges"] || node.diagramEdges || []).map((e) => ({
      uid: e[":block/uid"] ?? e.uid,
      data: stripKeywords(e[":diagram.edge/data"] ?? e.data ?? {}),
      source: stripKeywords(e[":diagram.edge/source"] ?? e.source),
      target: stripKeywords(e[":diagram.edge/target"] ?? e.target),
    })),
  };
}

export function parsePullResult(raw) {
  return normalizePull(raw);
}

// Native React Flow nodes are often tiny (165x83 on the live Svy graph). Anything
// below these floors is not a readable card, so imports snap up to the defaults.
export const MIN_CARD_WIDTH = 240;
export const MIN_CARD_HEIGHT = 140;
export const DEFAULT_CARD_WIDTH = 280;
export const DEFAULT_CARD_HEIGHT = 160;

export function flooredCardSize(width, height, defaults = {}) {
  const defaultWidth = Number(defaults.width) || DEFAULT_CARD_WIDTH;
  const defaultHeight = Number(defaults.height) || DEFAULT_CARD_HEIGHT;
  const minWidth = Number(defaults.minWidth) || MIN_CARD_WIDTH;
  const minHeight = Number(defaults.minHeight) || MIN_CARD_HEIGHT;
  const w = Number(width);
  const h = Number(height);
  return {
    width: Number.isFinite(w) && w >= minWidth ? w : Math.max(defaultWidth, minWidth),
    height: Number.isFinite(h) && h >= minHeight ? h : Math.max(defaultHeight, minHeight),
  };
}

export function nodeList(nodes) {
  if (nodes instanceof Map) return [...nodes.values()];
  if (Array.isArray(nodes)) return nodes;
  return [];
}

export function contentBounds(nodes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodeList(nodes)) {
    if (!node?.pos || !node?.size) continue;
    minX = Math.min(minX, node.pos.x);
    minY = Math.min(minY, node.pos.y);
    maxX = Math.max(maxX, node.pos.x + node.size.width);
    maxY = Math.max(maxY, node.pos.y + node.size.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
}

/**
 * A viewport is unusable when it paints any card smaller than `minPainted` on either
 * screen axis, when its zoom is below `minZoom` (native React Flow fit-views hover
 * around 0.4), or when every card sits outside the visible view. Such viewports come
 * from the native diagram and must be replaced by a fit, never persisted as-is.
 */
export function viewportNeedsFit(viewport, nodes, viewSize = null, options = {}) {
  const minPainted = Number(options.minPainted) || 140;
  const minZoom = Number(options.minZoom) || 0.7;
  const zoom = Number(viewport?.zoom);
  if (!viewport || !Number.isFinite(zoom) || zoom <= 0) return true;
  if (!Number.isFinite(Number(viewport.x)) || !Number.isFinite(Number(viewport.y))) return true;
  if (zoom < minZoom) return true;
  const list = nodeList(nodes).filter((node) => node?.pos && node?.size);
  if (!list.length) return false;
  for (const node of list) {
    if (node.size.width * zoom < minPainted || node.size.height * zoom < minPainted) return true;
  }
  const viewW = Number(viewSize?.width) || 0;
  const viewH = Number(viewSize?.height) || 0;
  if (viewW > 0 && viewH > 0) {
    const visible = list.some((node) => {
      const left = node.pos.x * zoom + viewport.x;
      const top = node.pos.y * zoom + viewport.y;
      const right = left + node.size.width * zoom;
      const bottom = top + node.size.height * zoom;
      return right > 0 && bottom > 0 && left < viewW && top < viewH;
    });
    if (!visible) return true;
  }
  return false;
}

/**
 * Pure fit: centre all cards in the view. A single card is never blown up past
 * `maxFitZoom`, and an empty board resets to 1:1 at the origin.
 */
export function fitViewport(nodes, viewSize, options = {}) {
  const padding = Number.isFinite(Number(options.padding)) ? Number(options.padding) : 48;
  const zoomMin = Number(options.zoomMin) || 0.15;
  const zoomMax = Number(options.zoomMax) || 3;
  const maxFitZoom = Number(options.maxFitZoom) || 1.5;
  const viewW = Math.max(Number(viewSize?.width) || 0, 1);
  const viewH = Math.max(Number(viewSize?.height) || 0, 1);
  const bounds = contentBounds(nodes);
  if (!bounds) return { x: padding, y: padding, zoom: 1 };
  const fitZoom = Math.min(
    (viewW - padding * 2) / bounds.width,
    (viewH - padding * 2) / bounds.height,
    maxFitZoom,
  );
  const zoom = Math.min(zoomMax, Math.max(zoomMin, fitZoom));
  return {
    x: (viewW - bounds.width * zoom) / 2 - bounds.minX * zoom,
    y: (viewH - bounds.height * zoom) / 2 - bounds.minY * zoom,
    zoom,
  };
}

export function importNativeLayout(tree, metadataLayout, defaults = {}) {
  const cloneNode = (node) => ({
    ...node,
    pos: { ...node.pos },
    size: { ...node.size },
  });
  const nodes = new Map(
    metadataLayout?.nodes
      ? [...metadataLayout.nodes].map(([k, v]) => [k, cloneNode(v)])
      : [],
  );
  const edges = (metadataLayout?.edges || []).map((edge) => ({ ...edge }));
  const nodeUidToContent = new Map();
  for (const nativeNode of tree.diagramNodes || []) {
    const contentUid = nativeNode.contentBlock?.uid;
    if (!contentUid) continue;
    nodeUidToContent.set(nativeNode.uid, contentUid);
    if (nodes.has(contentUid)) continue;
    const data = nativeNode.data || {};
    const pos = data.position || data.positionAbsolute || { x: 0, y: 0 };
    const width = data.width ?? data.data?.width ?? data.style?.width;
    const height = data.height ?? data.data?.height ?? data.style?.height;
    nodes.set(contentUid, {
      pos: { x: pos.x ?? 0, y: pos.y ?? 0 },
      size: flooredCardSize(width, height, defaults),
      color: "",
    });
  }
  for (const [contentUid, node] of nodes) {
    if (!node) { nodes.delete(contentUid); continue; }
    if (!node.pos) node.pos = { x: 0, y: 0 };
    if (!node.size) node.size = flooredCardSize(null, null, defaults);
  }
  const existingEdgeKeys = new Set(edges.map((edge) => `${edge.source}->${edge.target}`));
  for (const nativeEdge of tree.diagramEdges || []) {
    const sourceUid = nativeEdge.source?.["block/uid"] ?? nativeEdge.source?.uid;
    const targetUid = nativeEdge.target?.["block/uid"] ?? nativeEdge.target?.uid;
    const srcContent = nodeUidToContent.get(sourceUid);
    const tgtContent = nodeUidToContent.get(targetUid);
    if (!srcContent || !tgtContent) continue;
    const key = `${srcContent}->${tgtContent}`;
    if (existingEdgeKeys.has(key)) continue;
    edges.push({ source: srcContent, target: tgtContent, kind: "bezier", label: "" });
    existingEdgeKeys.add(key);
  }
  return { nodes, edges };
}

export class DiagramModel {
  constructor({ diagramUid, tree, metadataLayout, defaults = {} }) {
    this.diagramUid = diagramUid;
    this.tree = tree;
    this.children = [...(tree.children || [])];
    this.childrenFingerprint = childrenFingerprint(this.children);
    this.baseFingerprint = treeFingerprint(tree);
    const imported = importNativeLayout(tree, metadataLayout, defaults);
    this.nodes = imported.nodes;
    this.edges = imported.edges;
    this.sections = new Map(metadataLayout?.sections ? [...metadataLayout.sections] : []);
    const metadataViewport = metadataLayout?.viewport;
    const nativeViewport = tree.props?.["rf-diagram"]?.viewport;
    if (metadataViewport) {
      this.viewport = { ...metadataViewport };
      this.viewportSource = "metadata";
    } else if (nativeViewport) {
      this.viewport = { ...nativeViewport };
      this.viewportSource = "native";
    } else {
      this.viewport = { x: 0, y: 0, zoom: 1 };
      this.viewportSource = "none";
    }
    this.selected = new Set();
    this.activeTool = "select";
  }

  // Native rf-diagram viewports are zoomed-out React Flow fit-views; treat them as
  // "needs fit" unless they already paint readable cards.
  needsFit(viewSize = null, options = {}) {
    return viewportNeedsFit(this.viewport, this.nodes, viewSize, options);
  }

  fitTo(viewSize, options = {}) {
    this.viewport = fitViewport(this.nodes, viewSize, options);
    this.viewportSource = "fit";
    return this.viewport;
  }

  getCard(contentUid) {
    return this.children.find((child) => child.uid === contentUid) || null;
  }

  ensureNode(contentUid, defaults = {}) {
    if (this.nodes.has(contentUid)) return this.nodes.get(contentUid);
    const size = defaults.size
      ? flooredCardSize(defaults.size.width, defaults.size.height, defaults)
      : flooredCardSize(defaults.width, defaults.height, defaults);
    const node = {
      pos: defaults.pos ? { ...defaults.pos } : { x: 0, y: 0 },
      size,
      color: "",
    };
    this.nodes.set(contentUid, node);
    return node;
  }

  setNodePosition(contentUid, pos) {
    const node = this.ensureNode(contentUid);
    node.pos = { ...pos };
  }

  setNodeSize(contentUid, size) {
    const node = this.ensureNode(contentUid);
    node.size = {
      width: Math.max(MIN_CARD_WIDTH, Number(size.width) || MIN_CARD_WIDTH),
      height: Math.max(MIN_CARD_HEIGHT, Number(size.height) || MIN_CARD_HEIGHT),
    };
  }

  addEdge(source, target, kind = "bezier", label = "", extra = {}) {
    const key = `${source}->${target}`;
    const existing = this.edges.find((edge) => `${edge.source}->${edge.target}` === key);
    if (existing) {
      if (existing.label == null) existing.label = "";
      return null;
    }
    const edge = {
      source,
      target,
      kind,
      label: label || "",
      from: extra.from || "auto",
      to: extra.to || "auto",
      direction: extra.direction || "",
      color: extra.color || "",
    };
    this.edges.push(edge);
    return edge;
  }

  removeEdge(source, target) {
    const key = `${source}->${target}`;
    this.edges = this.edges.filter((edge) => `${edge.source}->${edge.target}` !== key);
  }

  layoutSnapshot() {
    return {
      viewport: { ...this.viewport },
      nodes: new Map([...this.nodes].map(([uid, node]) => [uid, {
        pos: { ...node.pos },
        size: { ...node.size },
        color: node.color || "",
      }])),
      edges: this.edges.map((edge) => ({ ...edge })),
      sections: new Map([...this.sections].map(([id, section]) => [id, {
        ...section,
        pos: section.pos ? { ...section.pos } : section.pos,
        size: section.size ? { ...section.size } : section.size,
        color: section.color || "",
      }])),
    };
  }

  // A pull only refreshes content (children, strings). Positions, sizes, edges,
  // sections and the viewport held in memory are the truth while a view is alive:
  // a debounced persist may still be in flight, and re-importing stale metadata
  // here snapped dragged cards back and re-applied native zoomed-out viewports.
  applyPull(tree, metadataLayout, defaults = {}) {
    const next = new DiagramModel({ diagramUid: this.diagramUid, tree, metadataLayout, defaults });
    this.tree = next.tree;
    this.children = next.children;
    this.childrenFingerprint = next.childrenFingerprint;
    this.baseFingerprint = next.baseFingerprint;
    for (const [contentUid, node] of next.nodes) {
      if (!this.nodes.has(contentUid)) this.nodes.set(contentUid, node);
    }
    const known = new Map(this.edges.map((edge) => [`${edge.source}->${edge.target}`, edge]));
    for (const edge of next.edges) {
      const key = `${edge.source}->${edge.target}`;
      const existing = known.get(key);
      if (existing) {
        if (existing.label == null) existing.label = "";
        if (!existing.label && edge.label) existing.label = edge.label;
        continue;
      }
      const incoming = {
        source: edge.source,
        target: edge.target,
        kind: edge.kind || "bezier",
        label: edge.label || "",
        from: edge.from || "auto",
        to: edge.to || "auto",
        direction: edge.direction || "",
        color: edge.color || "",
      };
      this.edges.push(incoming);
      known.set(key, incoming);
    }
    for (const [id, section] of next.sections) {
      if (!this.sections.has(id)) this.sections.set(id, section);
    }
    for (const uid of [...this.selected]) {
      if (!this.getCard(uid)) this.selected.delete(uid);
    }
  }

  autoLayoutGrid(missingOnly = true, gridSize = 24, cardWidth = 280, cardHeight = 160) {
    const targets = this.children.filter((child) => !missingOnly || !this.nodes.has(child.uid));
    let col = 0;
    let row = 0;
    const cols = Math.max(1, Math.ceil(Math.sqrt(targets.length)));
    for (const child of targets) {
      this.ensureNode(child.uid, {
        pos: { x: col * (cardWidth + gridSize), y: row * (cardHeight + gridSize) },
        size: { width: cardWidth, height: cardHeight },
      });
      col += 1;
      if (col >= cols) { col = 0; row += 1; }
    }
  }

  snapSelectionToGrid(gridSize = 24) {
    for (const uid of this.selected) {
      const node = this.nodes.get(uid);
      if (!node?.pos) continue;
      node.pos.x = Math.round(node.pos.x / gridSize) * gridSize;
      node.pos.y = Math.round(node.pos.y / gridSize) * gridSize;
    }
  }

  isNestedDiagram(contentUid) {
    const card = this.getCard(contentUid);
    return card ? isDiagramString(card.string) : false;
  }
}
