export const METADATA_PAGE = "plexus-diagram/metadata";
export const METADATA_SCHEMA_VERSION = 1;

function roam() {
  return globalThis.roamAlphaAPI;
}

export function getPageUid(title) {
  const api = roam();
  const q = api?.q || api?.data?.q;
  if (!q) return null;
  const safe = String(title).replace(/["\\]/g, "");
  const rows = q(`[:find ?uid :where [?p :node/title "${safe}"] [?p :block/uid ?uid]]`);
  return rows?.[0]?.[0] || null;
}

function generateUid() {
  const api = roam();
  if (typeof api?.util?.generateUID === "function") return api.util.generateUID();
  throw new Error("roamAlphaAPI.util.generateUID is required");
}

export async function createPage(title) {
  const existing = getPageUid(title);
  if (existing) return existing;
  const api = roam();
  const uid = generateUid();
  const payload = { page: { title, uid } };
  if (typeof api?.data?.page?.create === "function") await api.data.page.create(payload);
  else if (typeof api?.createPage === "function") await api.createPage(payload);
  else throw new Error("Cannot create metadata page");
  return getPageUid(title) || uid;
}

export async function createBlock(parentUid, string, order = "last") {
  const api = roam();
  const uid = generateUid();
  await api.data.block.create({
    location: { "parent-uid": parentUid, order },
    block: { uid, string },
  });
  return uid;
}

export async function updateBlock(uid, string) {
  await roam().data.block.update({ block: { uid, string } });
}

export async function deleteBlock(uid) {
  await roam().data.block.delete({ block: { uid } });
}

export function getTree(uid) {
  const api = roam();
  if (api?.pullPageTree) return api.pullPageTree({ page: { uid } });
  if (api?.data?.pull) {
    const tree = api.data.pull(
      "[:block/uid :block/string :block/order {:block/children ...}]",
      [":block/uid", uid],
    );
    return normalizeTree(tree);
  }
  return null;
}

function normalizeTree(node) {
  if (!node) return null;
  const children = (node.children || node[":block/children"] || [])
    .map(normalizeTree)
    .filter(Boolean)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    uid: node.uid ?? node[":block/uid"],
    string: node.string ?? node[":block/string"] ?? "",
    order: node.order ?? node[":block/order"] ?? 0,
    children,
  };
}

function parseViewport(text) {
  const parts = String(text).split(",").map((part) => Number(part.trim()));
  if (parts.length < 3) return null;
  return { x: parts[0], y: parts[1], zoom: parts[2] };
}

function parsePair(text) {
  const parts = String(text).split(",").map((part) => Number(part.trim()));
  if (parts.length < 2) return null;
  return { x: parts[0], y: parts[1] };
}

function parseSize(text) {
  const parts = String(text).split(",").map((part) => Number(part.trim()));
  if (parts.length < 2) return null;
  return { width: parts[0], height: parts[1] };
}

export function parseMetadataTree(tree) {
  const diagrams = new Map();
  if (!tree?.children) return { schemaVersion: METADATA_SCHEMA_VERSION, diagrams };
  const schemaBlock = tree.children.find((child) => child.string.startsWith("schema-version::"));
  const schemaVersion = schemaBlock
    ? Number(schemaBlock.string.replace("schema-version::", "").trim()) || METADATA_SCHEMA_VERSION
    : METADATA_SCHEMA_VERSION;
  const enhancedRoot = tree.children.find((child) => child.string.trim() === "enhanced::");
  if (!enhancedRoot) return { schemaVersion, diagrams };
  for (const diagramBlock of enhancedRoot.children || []) {
    const diagramUid = diagramBlock.string.trim();
    if (!diagramUid) continue;
    const entry = { viewport: null, nodes: new Map(), edges: [], sections: new Map() };
    for (const child of diagramBlock.children || []) {
      const line = child.string.trim();
      if (line.startsWith("viewport::")) {
        entry.viewport = parseViewport(line.slice("viewport::".length));
        continue;
      }
      if (line.startsWith("node ")) {
        const contentUid = line.slice("node ".length).trim();
        const node = { pos: null, size: null, color: "" };
        for (const prop of child.children || []) {
          const propLine = prop.string.trim();
          if (propLine.startsWith("pos::")) node.pos = parsePair(propLine.slice("pos::".length));
          if (propLine.startsWith("size::")) node.size = parseSize(propLine.slice("size::".length));
          if (propLine.startsWith("color::")) node.color = propLine.slice("color::".length).trim();
        }
        entry.nodes.set(contentUid, node);
        continue;
      }
      if (line.startsWith("edge ")) {
        const edgeKey = line.slice("edge ".length).trim();
        const match = edgeKey.match(/^(.+)->(.+)$/);
        if (!match) continue;
        const edge = { source: match[1].trim(), target: match[2].trim(), kind: "bezier" };
        for (const prop of child.children || []) {
          const propLine = prop.string.trim();
          if (propLine.startsWith("kind::")) edge.kind = propLine.slice("kind::".length).trim() || "bezier";
        }
        entry.edges.push(edge);
        continue;
      }
      if (line.startsWith("section ")) {
        const sectionId = line.slice("section ".length).trim();
        const section = { pos: null, size: null, title: "" };
        for (const prop of child.children || []) {
          const propLine = prop.string.trim();
          if (propLine.startsWith("pos::")) section.pos = parsePair(propLine.slice("pos::".length));
          if (propLine.startsWith("size::")) section.size = parseSize(propLine.slice("size::".length));
          if (propLine.startsWith("title::")) section.title = propLine.slice("title::".length).trim();
        }
        entry.sections.set(sectionId, section);
      }
    }
    diagrams.set(diagramUid, entry);
  }
  return { schemaVersion, diagrams };
}

export function serializeDiagramMetadata(diagramUid, layout) {
  const lines = [diagramUid];
  if (layout.viewport) {
    lines.push(`  viewport:: ${layout.viewport.x},${layout.viewport.y},${layout.viewport.zoom}`);
  }
  for (const [contentUid, node] of layout.nodes || new Map()) {
    lines.push(`  node ${contentUid}`);
    if (node.pos) lines.push(`    pos:: ${node.pos.x},${node.pos.y}`);
    if (node.size) lines.push(`    size:: ${node.size.width},${node.size.height}`);
    if (node.color) lines.push(`    color:: ${node.color}`);
  }
  for (const edge of layout.edges || []) {
    lines.push(`  edge ${edge.source}->${edge.target}`);
    if (edge.kind && edge.kind !== "bezier") lines.push(`    kind:: ${edge.kind}`);
  }
  for (const [sectionId, section] of layout.sections || new Map()) {
    lines.push(`  section ${sectionId}`);
    if (section.pos) lines.push(`    pos:: ${section.pos.x},${section.pos.y}`);
    if (section.size) lines.push(`    size:: ${section.size.width},${section.size.height}`);
    if (section.title) lines.push(`    title:: ${section.title}`);
  }
  return lines.join("\n");
}

export class MetadataStore {
  constructor() {
    this.pageUid = null;
    this.diagrams = new Map();
    this.diagramBlockUids = new Map();
  }

  async ensurePage() {
    if (!this.pageUid) this.pageUid = getPageUid(METADATA_PAGE) || await createPage(METADATA_PAGE);
    return this.pageUid;
  }

  reload() {
    this.diagrams.clear();
    this.diagramBlockUids.clear();
    if (!this.pageUid) this.pageUid = getPageUid(METADATA_PAGE);
    if (!this.pageUid) return;
    const tree = getTree(this.pageUid);
    const parsed = parseMetadataTree(tree);
    for (const [uid, layout] of parsed.diagrams) {
      this.diagrams.set(uid, layout);
      const enhancedRoot = tree?.children?.find((child) => child.string.trim() === "enhanced::");
      const block = enhancedRoot?.children?.find((child) => child.string.trim() === uid);
      if (block) this.diagramBlockUids.set(uid, block.uid);
    }
  }

  get(diagramUid) {
    return this.diagrams.get(diagramUid) || null;
  }

  has(diagramUid) {
    return this.diagrams.has(diagramUid);
  }

  enhancedUids() {
    return [...this.diagrams.keys()];
  }

  async set(diagramUid, layout) {
    const pageUid = await this.ensurePage();
    let tree = getTree(pageUid);
    if (!tree) throw new Error("Metadata page missing");
    let schemaUid = tree.children?.find((child) => child.string.startsWith("schema-version::"))?.uid;
    if (!schemaUid) schemaUid = await createBlock(pageUid, `schema-version:: ${METADATA_SCHEMA_VERSION}`);
    let enhancedUid = tree.children?.find((child) => child.string.trim() === "enhanced::")?.uid;
    if (!enhancedUid) enhancedUid = await createBlock(pageUid, "enhanced::");
    const serialized = serializeDiagramMetadata(diagramUid, layout);
    const existingBlockUid = this.diagramBlockUids.get(diagramUid);
    const blockUid = existingBlockUid || await createBlock(enhancedUid, diagramUid);
    if (existingBlockUid) {
      await updateBlock(blockUid, diagramUid);
      const existing = getTree(blockUid);
      for (const child of existing?.children || []) await deleteBlock(child.uid);
    }
    const childLines = serialized.split("\n").slice(1);
    let parentUid = blockUid;
    let indent = 0;
    for (const line of childLines) {
      const level = (line.match(/^ */)?.[0].length || 0) / 2;
      const content = line.trim();
      if (!content) continue;
      while (indent > level) { parentUid = blockUid; indent -= 1; }
      const uid = await createBlock(parentUid, content);
      if (content.startsWith("node ") || content.startsWith("edge ") || content.startsWith("section ") || content.startsWith("viewport::")) {
        parentUid = uid;
        indent = level + 1;
      }
    }
    this.diagrams.set(diagramUid, layout);
    this.diagramBlockUids.set(diagramUid, blockUid);
  }

  async remove(diagramUid) {
    const blockUid = this.diagramBlockUids.get(diagramUid);
    if (blockUid) await deleteBlock(blockUid);
    this.diagrams.delete(diagramUid);
    this.diagramBlockUids.delete(diagramUid);
  }
}
