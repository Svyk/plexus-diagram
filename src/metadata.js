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
        const edge = {
          source: match[1].trim(),
          target: match[2].trim(),
          kind: "bezier",
          label: "",
          from: "auto",
          to: "auto",
          direction: "",
          color: "",
        };
        for (const prop of child.children || []) {
          const propLine = prop.string.trim();
          if (propLine.startsWith("kind::")) edge.kind = propLine.slice("kind::".length).trim() || "bezier";
          if (propLine.startsWith("label::")) edge.label = propLine.slice("label::".length).trim();
          if (propLine.startsWith("from::")) edge.from = propLine.slice("from::".length).trim() || "auto";
          if (propLine.startsWith("to::")) edge.to = propLine.slice("to::".length).trim() || "auto";
          if (propLine.startsWith("direction::")) edge.direction = propLine.slice("direction::".length).trim();
          if (propLine.startsWith("color::")) edge.color = propLine.slice("color::".length).trim();
        }
        entry.edges.push(edge);
        continue;
      }
      if (line.startsWith("section ")) {
        const sectionId = line.slice("section ".length).trim();
        const section = { pos: null, size: null, title: "", color: "" };
        for (const prop of child.children || []) {
          const propLine = prop.string.trim();
          if (propLine.startsWith("pos::")) section.pos = parsePair(propLine.slice("pos::".length));
          if (propLine.startsWith("size::")) section.size = parseSize(propLine.slice("size::".length));
          if (propLine.startsWith("title::")) section.title = propLine.slice("title::".length).trim();
          if (propLine.startsWith("color::")) section.color = propLine.slice("color::".length).trim();
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
    if (edge.label) lines.push(`    label:: ${edge.label}`);
    if (edge.from && edge.from !== "auto") lines.push(`    from:: ${edge.from}`);
    if (edge.to && edge.to !== "auto") lines.push(`    to:: ${edge.to}`);
    if (edge.direction === "oneWay" || edge.direction === "twoWay" || edge.direction === "none") {
      lines.push(`    direction:: ${edge.direction}`);
    }
    if (edge.color) lines.push(`    color:: ${edge.color}`);
  }
  for (const [sectionId, section] of layout.sections || new Map()) {
    lines.push(`  section ${sectionId}`);
    if (section.pos) lines.push(`    pos:: ${section.pos.x},${section.pos.y}`);
    if (section.size) lines.push(`    size:: ${section.size.width},${section.size.height}`);
    if (section.title) lines.push(`    title:: ${section.title}`);
    if (section.color) lines.push(`    color:: ${section.color}`);
  }
  return lines.join("\n");
}

function indexPropChildren(children) {
  const props = {};
  for (const child of children || []) {
    const line = String(child.string || "").trim();
    const key = line.split("::")[0];
    if (key) props[key] = child;
  }
  return props;
}

function indexDiagramChildren(tree) {
  const indexed = {
    viewport: null,
    nodes: new Map(),
    edges: new Map(),
    sections: new Map(),
  };
  for (const child of tree?.children || []) {
    const line = String(child.string || "").trim();
    if (line.startsWith("viewport::")) indexed.viewport = child;
    else if (line.startsWith("node ")) indexed.nodes.set(line.slice("node ".length).trim(), child);
    else if (line.startsWith("edge ")) indexed.edges.set(line.slice("edge ".length).trim(), child);
    else if (line.startsWith("section ")) indexed.sections.set(line.slice("section ".length).trim(), child);
  }
  return indexed;
}

async function syncBlockString(uid, current, desired) {
  if (String(current || "").trim() === String(desired).trim()) return false;
  await updateBlock(uid, desired);
  return true;
}

async function syncPropChild(parentUid, existingChild, desiredString) {
  if (desiredString) {
    if (existingChild) await syncBlockString(existingChild.uid, existingChild.string, desiredString);
    else await createBlock(parentUid, desiredString);
  } else if (existingChild) {
    await deleteBlock(existingChild.uid);
  }
}

async function createDiagramChildren(blockUid, diagramUid, layout) {
  const serialized = serializeDiagramMetadata(diagramUid, layout);
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
}

async function patchDiagramBlock(blockUid, diagramUid, layout) {
  const tree = getTree(blockUid);
  if (tree && String(tree.string || "").trim() !== String(diagramUid).trim()) {
    await updateBlock(blockUid, diagramUid);
  }
  const indexed = indexDiagramChildren(tree);
  const viewportString = layout.viewport
    ? `viewport:: ${layout.viewport.x},${layout.viewport.y},${layout.viewport.zoom}`
    : null;
  await syncPropChild(blockUid, indexed.viewport, viewportString);

  const wantedNodes = new Set();
  for (const [contentUid, node] of layout.nodes || []) {
    wantedNodes.add(contentUid);
    const rowString = `node ${contentUid}`;
    const existing = indexed.nodes.get(contentUid);
    const rowUid = existing ? existing.uid : await createBlock(blockUid, rowString);
    if (existing) await syncBlockString(rowUid, existing.string, rowString);
    const props = indexPropChildren(existing?.children);
    await syncPropChild(rowUid, props.pos, node.pos ? `pos:: ${node.pos.x},${node.pos.y}` : null);
    await syncPropChild(rowUid, props.size, node.size ? `size:: ${node.size.width},${node.size.height}` : null);
    await syncPropChild(rowUid, props.color, node.color ? `color:: ${node.color}` : null);
  }
  for (const [id, row] of indexed.nodes) {
    if (!wantedNodes.has(id)) await deleteBlock(row.uid);
  }

  const wantedEdges = new Set();
  for (const edge of layout.edges || []) {
    const key = `${edge.source}->${edge.target}`;
    wantedEdges.add(key);
    const rowString = `edge ${key}`;
    const existing = indexed.edges.get(key);
    const rowUid = existing ? existing.uid : await createBlock(blockUid, rowString);
    if (existing) await syncBlockString(rowUid, existing.string, rowString);
    const props = indexPropChildren(existing?.children);
    const kindString = edge.kind && edge.kind !== "bezier" ? `kind:: ${edge.kind}` : null;
    const labelString = edge.label ? `label:: ${edge.label}` : null;
    const fromString = edge.from && edge.from !== "auto" ? `from:: ${edge.from}` : null;
    const toString = edge.to && edge.to !== "auto" ? `to:: ${edge.to}` : null;
    const directionString = edge.direction === "oneWay" || edge.direction === "twoWay" || edge.direction === "none"
      ? `direction:: ${edge.direction}`
      : null;
    const colorString = edge.color ? `color:: ${edge.color}` : null;
    await syncPropChild(rowUid, props.kind, kindString);
    await syncPropChild(rowUid, props.label, labelString);
    await syncPropChild(rowUid, props.from, fromString);
    await syncPropChild(rowUid, props.to, toString);
    await syncPropChild(rowUid, props.direction, directionString);
    await syncPropChild(rowUid, props.color, colorString);
  }
  for (const [key, row] of indexed.edges) {
    if (!wantedEdges.has(key)) await deleteBlock(row.uid);
  }

  const wantedSections = new Set();
  for (const [sectionId, section] of layout.sections || []) {
    wantedSections.add(sectionId);
    const rowString = `section ${sectionId}`;
    const existing = indexed.sections.get(sectionId);
    const rowUid = existing ? existing.uid : await createBlock(blockUid, rowString);
    if (existing) await syncBlockString(rowUid, existing.string, rowString);
    const props = indexPropChildren(existing?.children);
    await syncPropChild(rowUid, props.pos, section.pos ? `pos:: ${section.pos.x},${section.pos.y}` : null);
    await syncPropChild(rowUid, props.size, section.size ? `size:: ${section.size.width},${section.size.height}` : null);
    await syncPropChild(rowUid, props.title, section.title ? `title:: ${section.title}` : null);
    await syncPropChild(rowUid, props.color, section.color ? `color:: ${section.color}` : null);
  }
  for (const [id, row] of indexed.sections) {
    if (!wantedSections.has(id)) await deleteBlock(row.uid);
  }
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

  hasPersisted(diagramUid) {
    return this.diagramBlockUids.has(diagramUid);
  }

  enhancedUids() {
    return [...this.diagrams.keys()];
  }

  layoutMatchesStored(diagramUid, layout) {
    const stored = this.diagrams.get(diagramUid);
    if (!stored) return false;
    return serializeDiagramMetadata(diagramUid, layout)
      === serializeDiagramMetadata(diagramUid, stored);
  }

  async set(diagramUid, layout) {
    if (this.layoutMatchesStored(diagramUid, layout)) return false;
    const pageUid = await this.ensurePage();
    let tree = getTree(pageUid);
    if (!tree) throw new Error("Metadata page missing");
    let schemaUid = tree.children?.find((child) => child.string.startsWith("schema-version::"))?.uid;
    if (!schemaUid) schemaUid = await createBlock(pageUid, `schema-version:: ${METADATA_SCHEMA_VERSION}`);
    let enhancedUid = tree.children?.find((child) => child.string.trim() === "enhanced::")?.uid;
    if (!enhancedUid) enhancedUid = await createBlock(pageUid, "enhanced::");
    const existingBlockUid = this.diagramBlockUids.get(diagramUid);
    const blockUid = existingBlockUid || await createBlock(enhancedUid, diagramUid);
    if (existingBlockUid) {
      await patchDiagramBlock(blockUid, diagramUid, layout);
    } else {
      await createDiagramChildren(blockUid, diagramUid, layout);
    }
    this.diagrams.set(diagramUid, layout);
    this.diagramBlockUids.set(diagramUid, blockUid);
    return true;
  }

  async setViewport(diagramUid, viewport) {
    const entry = this.diagrams.get(diagramUid);
    if (entry?.viewport
      && entry.viewport.x === viewport.x
      && entry.viewport.y === viewport.y
      && entry.viewport.zoom === viewport.zoom) {
      return false;
    }
    const pageUid = await this.ensurePage();
    let tree = getTree(pageUid);
    if (!tree) throw new Error("Metadata page missing");
    let schemaUid = tree.children?.find((child) => child.string.startsWith("schema-version::"))?.uid;
    if (!schemaUid) schemaUid = await createBlock(pageUid, `schema-version:: ${METADATA_SCHEMA_VERSION}`);
    let enhancedUid = tree.children?.find((child) => child.string.trim() === "enhanced::")?.uid;
    if (!enhancedUid) enhancedUid = await createBlock(pageUid, "enhanced::");
    let blockUid = this.diagramBlockUids.get(diagramUid);
    if (!blockUid) {
      blockUid = await createBlock(enhancedUid, diagramUid);
      this.diagramBlockUids.set(diagramUid, blockUid);
    }
    const viewportString = `viewport:: ${viewport.x},${viewport.y},${viewport.zoom}`;
    const blockTree = getTree(blockUid);
    const viewportChild = blockTree?.children?.find((child) => child.string.trim().startsWith("viewport::"));
    if (viewportChild) {
      if (viewportChild.string.trim() === viewportString) {
        if (!entry) {
          this.diagrams.set(diagramUid, { viewport: { ...viewport }, nodes: new Map(), edges: [], sections: new Map() });
        } else {
          entry.viewport = { ...viewport };
        }
        return false;
      }
      await updateBlock(viewportChild.uid, viewportString);
    } else {
      await createBlock(blockUid, viewportString);
    }
    const next = entry || { viewport: null, nodes: new Map(), edges: [], sections: new Map() };
    next.viewport = { ...viewport };
    this.diagrams.set(diagramUid, next);
    return true;
  }

  async remove(diagramUid) {
    const blockUid = this.diagramBlockUids.get(diagramUid);
    if (blockUid) await deleteBlock(blockUid);
    this.diagrams.delete(diagramUid);
    this.diagramBlockUids.delete(diagramUid);
  }
}

export const SCRATCH_MARKER = "pxd:scratch";

let scratchRuntime = null;

export function peekScratch() {
  return scratchRuntime;
}

async function sweepExtraScratchChildren(parentUid, keepUid) {
  const tree = getTree(parentUid);
  for (const child of tree?.children || []) {
    if (child.uid === keepUid) continue;
    await deleteBlock(child.uid).catch(() => {});
  }
}

export async function acquireScratch() {
  try {
    if (scratchRuntime?.uid) {
      await sweepExtraScratchChildren(scratchRuntime.parentUid, scratchRuntime.uid);
      return scratchRuntime;
    }
    const pageUid = getPageUid(METADATA_PAGE) || await createPage(METADATA_PAGE);
    const tree = getTree(pageUid);
    const marker = (tree?.children || []).find((child) => child.string === SCRATCH_MARKER);
    let parentUid;
    if (marker) {
      parentUid = marker.uid;
      const children = marker.children || [];
      if (!children.length) {
        const uid = await createBlock(parentUid, " ");
        scratchRuntime = { parentUid, uid };
      } else {
        const keep = children[0];
        scratchRuntime = { parentUid, uid: keep.uid };
        await sweepExtraScratchChildren(parentUid, keep.uid);
      }
    } else {
      parentUid = await createBlock(pageUid, SCRATCH_MARKER);
      const uid = await createBlock(parentUid, " ");
      scratchRuntime = { parentUid, uid };
    }
    return scratchRuntime;
  } catch {
    return null;
  }
}

export async function blankScratch() {
  const scratch = scratchRuntime;
  if (!scratch?.uid) return;
  try {
    await updateBlock(scratch.uid, "");
  } catch {
    try {
      await updateBlock(scratch.uid, " ");
    } catch { /* leave it */ }
  }
}

export async function releaseScratch() {
  const scratch = scratchRuntime;
  scratchRuntime = null;
  if (!scratch?.parentUid) return;
  try {
    const tree = getTree(scratch.parentUid);
    for (const child of tree?.children || []) {
      await deleteBlock(child.uid).catch(() => {});
    }
  } catch { /* unload still clears the cache */ }
}
