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

export function importNativeLayout(tree, metadataLayout, defaults = {}) {
  const nodes = new Map(metadataLayout?.nodes ? [...metadataLayout.nodes] : []);
  const edges = [...(metadataLayout?.edges || [])];
  const nodeUidToContent = new Map();
  for (const nativeNode of tree.diagramNodes || []) {
    const contentUid = nativeNode.contentBlock?.uid;
    if (!contentUid) continue;
    nodeUidToContent.set(nativeNode.uid, contentUid);
    if (nodes.has(contentUid)) continue;
    const data = nativeNode.data || {};
    const pos = data.position || data.positionAbsolute || { x: 0, y: 0 };
    const width = data.width ?? data.data?.width ?? defaults.width ?? 280;
    const height = data.height ?? data.data?.height ?? defaults.height ?? 160;
    nodes.set(contentUid, {
      pos: { x: pos.x ?? 0, y: pos.y ?? 0 },
      size: { width, height },
      color: "",
    });
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
    edges.push({ source: srcContent, target: tgtContent, kind: "bezier" });
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
    this.viewport = metadataLayout?.viewport
      || tree.props?.["rf-diagram"]?.viewport
      || { x: 0, y: 0, zoom: 1 };
    this.selected = new Set();
    this.activeTool = "select";
  }

  getCard(contentUid) {
    return this.children.find((child) => child.uid === contentUid) || null;
  }

  ensureNode(contentUid, defaults = {}) {
    if (this.nodes.has(contentUid)) return this.nodes.get(contentUid);
    const node = {
      pos: defaults.pos || { x: 0, y: 0 },
      size: defaults.size || { width: defaults.width ?? 280, height: defaults.height ?? 160 },
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
    node.size = { ...size };
  }

  addEdge(source, target, kind = "bezier") {
    const key = `${source}->${target}`;
    if (this.edges.some((edge) => `${edge.source}->${edge.target}` === key)) return null;
    const edge = { source, target, kind };
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
      nodes: new Map([...this.nodes].map(([uid, node]) => [uid, { ...node, pos: { ...node.pos }, size: { ...node.size } }])),
      edges: this.edges.map((edge) => ({ ...edge })),
      sections: new Map([...this.sections].map(([id, section]) => [id, { ...section }])),
    };
  }

  applyPull(tree, metadataLayout, defaults = {}) {
    const next = new DiagramModel({ diagramUid: this.diagramUid, tree, metadataLayout, defaults });
    this.tree = next.tree;
    this.children = next.children;
    this.childrenFingerprint = next.childrenFingerprint;
    this.baseFingerprint = next.baseFingerprint;
    this.nodes = next.nodes;
    this.edges = next.edges;
    this.sections = next.sections;
    if (tree.props?.["rf-diagram"]?.viewport) this.viewport = { ...tree.props["rf-diagram"].viewport };
    else if (metadataLayout?.viewport) this.viewport = { ...metadataLayout.viewport };
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
