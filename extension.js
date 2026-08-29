/* Plexus Diagram v0.3.2 | MIT | generated; edit src/ */

// src/lifecycle.js
function isPromiseLike(value) {
  return value != null && typeof value.then === "function";
}
async function callSafely(disposer) {
  const result = disposer();
  if (isPromiseLike(result)) await result;
}
function createLifecycle() {
  let disposed = false;
  const disposers = [];
  const add = (disposer) => {
    if (typeof disposer !== "function") throw new TypeError("A disposer must be a function");
    if (disposed) {
      void callSafely(disposer).catch((error) => console.error("[plexus-diagram] Late cleanup failed", error));
      return disposer;
    }
    disposers.push(disposer);
    return disposer;
  };
  return {
    get disposed() {
      return disposed;
    },
    add,
    async command(commandApi, config) {
      if (!commandApi?.addCommand || !commandApi?.removeCommand) {
        throw new TypeError("A command API with addCommand/removeCommand is required");
      }
      await commandApi.addCommand(config);
      add(() => commandApi.removeCommand({ label: config.label }));
    },
    event(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      add(() => target.removeEventListener(type, listener, options));
      return listener;
    },
    interval(callback, delay, ...args) {
      const id = globalThis.setInterval(callback, delay, ...args);
      add(() => globalThis.clearInterval(id));
      return id;
    },
    timeout(callback, delay, ...args) {
      const id = globalThis.setTimeout(callback, delay, ...args);
      add(() => globalThis.clearTimeout(id));
      return id;
    },
    observer(observer, target, options) {
      observer.observe(target, options);
      add(() => observer.disconnect());
      return observer;
    },
    node(node, parent = globalThis.document?.body) {
      if (!parent) throw new Error("A parent node is required outside the browser");
      parent.append(node);
      add(() => node.remove());
      return node;
    },
    pullWatch(dataApi, pattern, entity, callback) {
      if (!dataApi?.addPullWatch || !dataApi?.removePullWatch) {
        throw new TypeError("A Roam data API with addPullWatch/removePullWatch is required");
      }
      dataApi.addPullWatch(pattern, entity, callback);
      add(() => dataApi.removePullWatch(pattern, entity, callback));
      return callback;
    },
    async settingsPanel(extensionAPI, config) {
      await extensionAPI.settings.panel.create(config);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      const errors = [];
      for (const disposer of disposers.splice(0).reverse()) {
        try {
          await callSafely(disposer);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "One or more extension cleanups failed");
    }
  };
}

// src/discovery.js
var DIAGRAM_MARKER = /\{\{\s*(\[\[)?diagram/i;
var MAX_GUARD_UIDS = 2e3;
var ENHANCED_UID_CACHE_PREFIX = "plexus-diagram:enhanced-uids:";
var PREPAINT_STYLE_ID = "plexus-diagram-prepaint-guard";
var PENDING_CLASS = "pxd-native-pending";
var NATIVE_HIDDEN_CLASS = "pxd-native-hidden";
function isDiagramString(value) {
  return DIAGRAM_MARKER.test(String(value ?? ""));
}
function cssAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function graphCacheKey(locationHash = globalThis.location?.hash || "") {
  const match = String(locationHash).match(/#\/app\/([^/]+)/);
  return match ? `${ENHANCED_UID_CACHE_PREFIX}${match[1]}` : `${ENHANCED_UID_CACHE_PREFIX}unknown`;
}
function diagramUidFromLocation(hash = globalThis.location?.hash || "") {
  const match = String(hash).match(/#\/app\/[^/]+\/page\/([^/?#]+)/);
  return match ? match[1] : null;
}
function routeLeftZoomedDiagram(diagramUid, hash = globalThis.location?.hash || "") {
  if (!diagramUid) return true;
  return diagramUidFromLocation(hash) !== diagramUid;
}
function readEnhancedUidCache(storage = globalThis.localStorage, key = graphCacheKey()) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return /* @__PURE__ */ new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return /* @__PURE__ */ new Set();
    return new Set(parsed.map(String).filter(Boolean).sort());
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function writeEnhancedUidCache(uids, storage = globalThis.localStorage, key = graphCacheKey()) {
  const sorted = [...new Set([...uids].map(String).filter(Boolean))].sort();
  storage?.setItem?.(key, JSON.stringify(sorted));
  return sorted;
}
function enhancedUidGuardCss(uids) {
  const selectors = [];
  const unique = [...new Set([...uids].map(String).filter(Boolean))].sort();
  if (unique.length > MAX_GUARD_UIDS) {
    console.warn(`[plexus-diagram] Skipping the pre-paint guard: ${unique.length} cached diagram uids exceeds the ${MAX_GUARD_UIDS} cap`);
    return "";
  }
  for (const uid of unique) {
    const escaped = cssAttributeValue(uid);
    for (const host of [
      `[id$="${escaped}"]`,
      `[data-uid="${escaped}"]`,
      `.rm-block-ref[data-uid="${escaped}"]`
    ]) {
      selectors.push(
        `${host} .rm-diagram:not(.${NATIVE_HIDDEN_CLASS})`,
        `${host} .rm-diagram-title-panel`,
        `${host} .react-flow`
      );
    }
  }
  const hideRule = selectors.length ? `${selectors.join(",\n")} { display: none !important; }` : "";
  const pendingRule = unique.length ? `.rm-diagram.${PENDING_CLASS}:not(.${NATIVE_HIDDEN_CLASS}) { visibility: hidden !important; pointer-events: none !important; }` : "";
  return [hideRule, pendingRule].filter(Boolean).join("\n");
}
function findDiagramUidFromEl(element) {
  if (!element) return null;
  const ref = element.closest?.(".rm-block-ref[data-uid]");
  if (ref?.dataset?.uid) return ref.dataset.uid;
  const blockInput = element.closest?.('[id^="block-input-"]');
  if (blockInput?.id) {
    const dated = blockInput.id.match(/block-input-.+-body-outline-\d{2}-\d{2}-\d{4}-(.+)$/);
    if (dated) return dated[1];
    const zoomed = blockInput.id.match(/block-input-.+-body-outline-(.+)$/);
    if (zoomed && !/^\d{2}-\d{2}-\d{4}(-|$)/.test(zoomed[1])) return zoomed[1];
  }
  if (element.closest?.(".rm-zoom-block-wrapper")) {
    const pageUid = diagramUidFromLocation();
    if (pageUid) return pageUid;
  }
  const host = element.closest?.("[data-uid]");
  if (host?.dataset?.uid) return host.dataset.uid;
  return null;
}
function diagramElForUid(uid, root = globalThis.document) {
  if (!uid || !root?.querySelector) return null;
  const escaped = (globalThis.CSS?.escape || String)(String(uid));
  return root.querySelector(`[id$="${escaped}"] .rm-diagram`) || root.querySelector(`[data-uid="${escaped}"] .rm-diagram`) || root.querySelector(`.rm-block-ref[data-uid="${escaped}"] .rm-diagram`);
}
function waitForDiagramEl(uid, { timeout = 2500, root = globalThis.document } = {}) {
  const immediate = diagramElForUid(uid, root) || root?.querySelector?.(".rm-diagram");
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (node) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      clearInterval(interval);
      clearTimeout(timer);
      resolve(node || null);
    };
    const tick = () => {
      const node = diagramElForUid(uid, root) || root?.querySelector?.(".rm-diagram");
      if (node) finish(node);
    };
    const Mutation = globalThis.MutationObserver;
    const observer = typeof Mutation === "function" && root?.body ? new Mutation((records) => {
      for (const record of records) {
        for (const added of record.addedNodes || []) {
          if (added.nodeType !== 1) continue;
          if (added.matches?.(".rm-diagram") || added.querySelector?.(".rm-diagram")) {
            tick();
            return;
          }
        }
      }
    }) : null;
    observer?.observe(root.body, { childList: true, subtree: true });
    const interval = setInterval(tick, 50);
    const timer = setTimeout(() => finish(null), timeout);
  });
}
function diagramsWithin(root) {
  if (!root) return [];
  const values = [];
  if (root.matches?.(".rm-diagram")) values.push(root);
  for (const diagram of root.querySelectorAll?.(".rm-diagram") || []) {
    if (!values.includes(diagram)) values.push(diagram);
  }
  return values;
}

// src/metadata.js
var METADATA_PAGE = "plexus-diagram/metadata";
var METADATA_SCHEMA_VERSION = 1;
function roam() {
  return globalThis.roamAlphaAPI;
}
function getPageUid(title) {
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
async function createPage(title) {
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
async function createBlock(parentUid, string, order = "last") {
  const api = roam();
  const uid = generateUid();
  await api.data.block.create({
    location: { "parent-uid": parentUid, order },
    block: { uid, string }
  });
  return uid;
}
async function updateBlock(uid, string) {
  await roam().data.block.update({ block: { uid, string } });
}
async function deleteBlock(uid) {
  await roam().data.block.delete({ block: { uid } });
}
function getTree(uid) {
  const api = roam();
  if (api?.pullPageTree) return api.pullPageTree({ page: { uid } });
  if (api?.data?.pull) {
    const tree = api.data.pull(
      "[:block/uid :block/string :block/order {:block/children ...}]",
      [":block/uid", uid]
    );
    return normalizeTree(tree);
  }
  return null;
}
function normalizeTree(node) {
  if (!node) return null;
  const children = (node.children || node[":block/children"] || []).map(normalizeTree).filter(Boolean).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    uid: node.uid ?? node[":block/uid"],
    string: node.string ?? node[":block/string"] ?? "",
    order: node.order ?? node[":block/order"] ?? 0,
    children
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
function parseMetadataTree(tree) {
  const diagrams = /* @__PURE__ */ new Map();
  if (!tree?.children) return { schemaVersion: METADATA_SCHEMA_VERSION, diagrams };
  const schemaBlock = tree.children.find((child) => child.string.startsWith("schema-version::"));
  const schemaVersion = schemaBlock ? Number(schemaBlock.string.replace("schema-version::", "").trim()) || METADATA_SCHEMA_VERSION : METADATA_SCHEMA_VERSION;
  const enhancedRoot = tree.children.find((child) => child.string.trim() === "enhanced::");
  if (!enhancedRoot) return { schemaVersion, diagrams };
  for (const diagramBlock of enhancedRoot.children || []) {
    const diagramUid = diagramBlock.string.trim();
    if (!diagramUid) continue;
    const entry = { viewport: null, nodes: /* @__PURE__ */ new Map(), edges: [], sections: /* @__PURE__ */ new Map() };
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
function serializeDiagramMetadata(diagramUid, layout) {
  const lines = [diagramUid];
  if (layout.viewport) {
    lines.push(`  viewport:: ${layout.viewport.x},${layout.viewport.y},${layout.viewport.zoom}`);
  }
  for (const [contentUid, node] of layout.nodes || /* @__PURE__ */ new Map()) {
    lines.push(`  node ${contentUid}`);
    if (node.pos) lines.push(`    pos:: ${node.pos.x},${node.pos.y}`);
    if (node.size) lines.push(`    size:: ${node.size.width},${node.size.height}`);
    if (node.color) lines.push(`    color:: ${node.color}`);
  }
  for (const edge of layout.edges || []) {
    lines.push(`  edge ${edge.source}->${edge.target}`);
    if (edge.kind && edge.kind !== "bezier") lines.push(`    kind:: ${edge.kind}`);
  }
  for (const [sectionId, section] of layout.sections || /* @__PURE__ */ new Map()) {
    lines.push(`  section ${sectionId}`);
    if (section.pos) lines.push(`    pos:: ${section.pos.x},${section.pos.y}`);
    if (section.size) lines.push(`    size:: ${section.size.width},${section.size.height}`);
    if (section.title) lines.push(`    title:: ${section.title}`);
  }
  return lines.join("\n");
}
var MetadataStore = class {
  constructor() {
    this.pageUid = null;
    this.diagrams = /* @__PURE__ */ new Map();
    this.diagramBlockUids = /* @__PURE__ */ new Map();
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
    return serializeDiagramMetadata(diagramUid, layout) === serializeDiagramMetadata(diagramUid, stored);
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
      while (indent > level) {
        parentUid = blockUid;
        indent -= 1;
      }
      const uid = await createBlock(parentUid, content);
      if (content.startsWith("node ") || content.startsWith("edge ") || content.startsWith("section ") || content.startsWith("viewport::")) {
        parentUid = uid;
        indent = level + 1;
      }
    }
    this.diagrams.set(diagramUid, layout);
    this.diagramBlockUids.set(diagramUid, blockUid);
    return true;
  }
  async setViewport(diagramUid, viewport) {
    const entry = this.diagrams.get(diagramUid);
    if (entry?.viewport && entry.viewport.x === viewport.x && entry.viewport.y === viewport.y && entry.viewport.zoom === viewport.zoom) {
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
          this.diagrams.set(diagramUid, { viewport: { ...viewport }, nodes: /* @__PURE__ */ new Map(), edges: [], sections: /* @__PURE__ */ new Map() });
        } else {
          entry.viewport = { ...viewport };
        }
        return false;
      }
      await updateBlock(viewportChild.uid, viewportString);
    } else {
      await createBlock(blockUid, viewportString);
    }
    const next = entry || { viewport: null, nodes: /* @__PURE__ */ new Map(), edges: [], sections: /* @__PURE__ */ new Map() };
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
};

// src/library.js
function createLibrarySidebar({ lifecycle, settings, session, onPlacePage, mountRoot, onClose }) {
  const parent = mountRoot || document.body;
  parent.querySelector(".pxd-library-drawer")?.remove();
  const drawer = document.createElement("div");
  drawer.className = "pxd-library-drawer";
  const header = document.createElement("div");
  header.className = "pxd-library-drawer__header";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "pxd-library-drawer__search";
  search.placeholder = "Search pages…";
  search.setAttribute("aria-label", "Search library pages");
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "pxd-library-drawer__close";
  closeBtn.textContent = "Close";
  closeBtn.setAttribute("aria-label", "Close library");
  header.append(search, closeBtn);
  const list = document.createElement("div");
  list.className = "pxd-library";
  drawer.append(header, list);
  lifecycle.node(drawer, parent);
  let titles = [];
  const close = () => {
    drawer.remove();
    onClose?.();
  };
  closeBtn.addEventListener("click", close);
  const renderList = () => {
    list.innerHTML = "";
    const query = search.value.trim().toLowerCase();
    const filtered = titles.filter((title) => title && String(title).trim()).filter((title) => !query || String(title).toLowerCase().includes(query)).slice(0, 30);
    for (const title of filtered) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "pxd-library__item";
      row.textContent = title;
      row.addEventListener("click", () => onPlacePage(title));
      list.append(row);
    }
  };
  const loadTitles = async () => {
    const includeDailies = settings.get("library-include-dailies");
    const query = "[:find ?title ?uid :where [?p :node/title ?title] [?p :block/uid ?uid]]";
    let rows = [];
    try {
      rows = globalThis.roamAlphaAPI?.data?.q?.(query) || [];
    } catch {
      rows = [];
    }
    const dailyPattern = /^\d{2}-\d{2}-\d{4}$/;
    titles = rows.filter(([, pageUid]) => includeDailies || !dailyPattern.test(String(pageUid ?? ""))).map(([title]) => title).filter((title) => title && String(title).trim());
    renderList();
  };
  search.addEventListener("input", renderList);
  void loadTitles();
  return {
    refresh: loadTitles,
    isOpen: () => drawer.isConnected,
    close,
    dispose() {
      drawer.remove();
    }
  };
}

// src/settings.js
var SETTING_IDS = Object.freeze({
  enabled: "enabled",
  autoEnhance: "auto-enhance",
  showVersionBadge: "show-version-badge",
  restoreNativeOnUnload: "restore-native-on-unload",
  defaultHeight: "default-height",
  snapToGrid: "snap-to-grid",
  gridSize: "grid-size",
  showGrid: "show-grid",
  gridStyle: "grid-style",
  minimap: "minimap",
  panOnSpace: "pan-on-space",
  zoomMin: "zoom-min",
  zoomMax: "zoom-max",
  wheelZoom: "wheel-zoom",
  defaultCardWidth: "default-card-width",
  defaultCardHeight: "default-card-height",
  cardRadius: "card-radius",
  showCardTitle: "show-card-title",
  nativeBlockEditor: "native-block-editor",
  compactCards: "compact-cards",
  cardShadow: "card-shadow",
  renderChildrenDepth: "render-children-depth",
  connectorStyle: "connector-style",
  arrowheads: "arrowheads",
  edgeWidth: "edge-width",
  showEdgeLabels: "show-edge-labels",
  edgeAnimated: "edge-animated",
  showSections: "show-sections",
  sectionLabel: "section-label",
  showLibraryOnOpen: "show-library-on-open",
  libraryIncludeDailies: "library-include-dailies",
  followRoamTheme: "follow-roam-theme",
  viewportCulling: "viewport-culling",
  disableOnMobile: "disable-on-mobile",
  enableShortcuts: "enable-shortcuts",
  fullscreenOnZoom: "fullscreen-on-zoom"
});
var DEFAULTS = Object.freeze({
  [SETTING_IDS.enabled]: true,
  [SETTING_IDS.autoEnhance]: false,
  [SETTING_IDS.showVersionBadge]: true,
  [SETTING_IDS.restoreNativeOnUnload]: false,
  [SETTING_IDS.defaultHeight]: "560",
  [SETTING_IDS.snapToGrid]: true,
  [SETTING_IDS.gridSize]: "24",
  [SETTING_IDS.showGrid]: true,
  [SETTING_IDS.gridStyle]: "dots",
  [SETTING_IDS.minimap]: true,
  [SETTING_IDS.panOnSpace]: true,
  [SETTING_IDS.zoomMin]: "0.15",
  [SETTING_IDS.zoomMax]: "3",
  [SETTING_IDS.wheelZoom]: true,
  [SETTING_IDS.defaultCardWidth]: "280",
  [SETTING_IDS.defaultCardHeight]: "160",
  [SETTING_IDS.cardRadius]: "8",
  [SETTING_IDS.showCardTitle]: false,
  [SETTING_IDS.nativeBlockEditor]: true,
  [SETTING_IDS.compactCards]: false,
  [SETTING_IDS.cardShadow]: true,
  [SETTING_IDS.renderChildrenDepth]: "1",
  [SETTING_IDS.connectorStyle]: "bezier",
  [SETTING_IDS.arrowheads]: "end",
  [SETTING_IDS.edgeWidth]: "2",
  [SETTING_IDS.showEdgeLabels]: false,
  [SETTING_IDS.edgeAnimated]: false,
  [SETTING_IDS.showSections]: true,
  [SETTING_IDS.sectionLabel]: true,
  [SETTING_IDS.showLibraryOnOpen]: false,
  [SETTING_IDS.libraryIncludeDailies]: false,
  [SETTING_IDS.followRoamTheme]: true,
  [SETTING_IDS.viewportCulling]: true,
  [SETTING_IDS.disableOnMobile]: false,
  [SETTING_IDS.enableShortcuts]: true,
  [SETTING_IDS.fullscreenOnZoom]: true
});
function settingsDefaults() {
  return { ...DEFAULTS };
}
function createSettingsReader(extensionAPI) {
  return {
    get(id) {
      const value = extensionAPI.settings.get(id);
      return value == null ? DEFAULTS[id] : value;
    }
  };
}
async function initializeSettings(extensionAPI) {
  if (extensionAPI.settings.canSet === false) return;
  for (const [id, value] of Object.entries(DEFAULTS)) {
    if (extensionAPI.settings.get(id) == null) {
      await extensionAPI.settings.set(id, value);
    }
  }
}
function switchRow(id, name, description) {
  return {
    id,
    name,
    description,
    action: { type: "switch" }
  };
}
function inputRow(id, name, description) {
  return {
    id,
    name,
    description,
    action: { type: "input" }
  };
}
function selectRow(id, name, description, items) {
  return {
    id,
    name,
    description,
    action: { type: "select", items }
  };
}
function createSettingsPanel() {
  return {
    tabTitle: "Plexus Diagram",
    settings: [
      switchRow(SETTING_IDS.enabled, "Enabled", "Master overlay toggle."),
      switchRow(SETTING_IDS.autoEnhance, "Auto enhance", "Enhance diagram blocks automatically when discovered."),
      switchRow(SETTING_IDS.showVersionBadge, "Show version badge", "Show the extension version in the toolbar."),
      switchRow(SETTING_IDS.restoreNativeOnUnload, "Restore native on unload", "Restore native diagrams when the extension unloads."),
      inputRow(SETTING_IDS.defaultHeight, "Default height", "Canvas host height in pixels."),
      switchRow(SETTING_IDS.snapToGrid, "Snap to grid", "Snap card positions to the grid."),
      inputRow(SETTING_IDS.gridSize, "Grid size", "Grid spacing in pixels."),
      switchRow(SETTING_IDS.showGrid, "Show grid", "Show the background grid."),
      selectRow(SETTING_IDS.gridStyle, "Grid style", "Background grid style.", [
        ["Dots", "dots"],
        ["Lines", "lines"],
        ["None", "none"]
      ]),
      switchRow(SETTING_IDS.minimap, "Minimap", "Show the minimap."),
      switchRow(SETTING_IDS.panOnSpace, "Pan on space", "Hold space and drag to pan."),
      inputRow(SETTING_IDS.zoomMin, "Zoom min", "Minimum zoom level."),
      inputRow(SETTING_IDS.zoomMax, "Zoom max", "Maximum zoom level."),
      switchRow(SETTING_IDS.wheelZoom, "Wheel zoom", "Zoom with the mouse wheel."),
      inputRow(SETTING_IDS.defaultCardWidth, "Default card width", "Default width for new cards."),
      inputRow(SETTING_IDS.defaultCardHeight, "Default card height", "Default height for new cards."),
      inputRow(SETTING_IDS.cardRadius, "Card radius", "Card corner radius in pixels."),
      switchRow(SETTING_IDS.showCardTitle, "Show card title", "Show a title bar on cards."),
      switchRow(SETTING_IDS.nativeBlockEditor, "Native block editor", "Double-click a card to edit it in place with Roam's block editor. Off opens the block in the sidebar."),
      switchRow(SETTING_IDS.compactCards, "Compact cards", "Use compact card chrome."),
      switchRow(SETTING_IDS.cardShadow, "Card shadow", "Draw a subtle card shadow."),
      selectRow(SETTING_IDS.renderChildrenDepth, "Render children depth", "How many child levels to render.", [
        ["0", "0"],
        ["1", "1"],
        ["2", "2"],
        ["All", "all"]
      ]),
      selectRow(SETTING_IDS.connectorStyle, "Connector style", "Default edge style.", [
        ["Bezier", "bezier"],
        ["Straight", "straight"],
        ["Elbow", "elbow"]
      ]),
      selectRow(SETTING_IDS.arrowheads, "Arrowheads", "Arrowhead placement.", [
        ["End", "end"],
        ["Both", "both"],
        ["None", "none"]
      ]),
      inputRow(SETTING_IDS.edgeWidth, "Edge width", "Connector stroke width."),
      switchRow(SETTING_IDS.showEdgeLabels, "Show edge labels", "Show labels on connectors."),
      switchRow(SETTING_IDS.edgeAnimated, "Edge animated", "Animate connectors."),
      switchRow(SETTING_IDS.showSections, "Show sections", "Render section frames."),
      switchRow(SETTING_IDS.sectionLabel, "Section label", "Show section titles."),
      switchRow(SETTING_IDS.showLibraryOnOpen, "Show library on open", "Open the library when enhancing."),
      switchRow(SETTING_IDS.libraryIncludeDailies, "Library include dailies", "Include daily pages in the library."),
      switchRow(SETTING_IDS.followRoamTheme, "Follow Roam theme", "Follow Roam light/dark theme."),
      switchRow(SETTING_IDS.viewportCulling, "Viewport culling", "Skip rendering off-screen cards."),
      switchRow(SETTING_IDS.disableOnMobile, "Disable on mobile", "Skip mounting on mobile clients."),
      switchRow(SETTING_IDS.enableShortcuts, "Enable shortcuts", "Enable keyboard shortcuts."),
      switchRow(SETTING_IDS.fullscreenOnZoom, "Fullscreen on zoom", "Open enhanced diagrams full screen when zoomed into the diagram block. Esc exits.")
    ]
  };
}

// src/edges.js
function edgeEndpoints(sourceRect, targetRect, side = "auto") {
  const scx = sourceRect.x + sourceRect.width / 2;
  const scy = sourceRect.y + sourceRect.height / 2;
  const tcx = targetRect.x + targetRect.width / 2;
  const tcy = targetRect.y + targetRect.height / 2;
  const dx = tcx - scx;
  const dy = tcy - scy;
  let sx = scx;
  let sy = scy;
  let tx = tcx;
  let ty = tcy;
  if (side === "auto" || side === "sides") {
    if (Math.abs(dx) > Math.abs(dy)) {
      sx = dx > 0 ? sourceRect.x + sourceRect.width : sourceRect.x;
      tx = dx > 0 ? targetRect.x : targetRect.x + targetRect.width;
      sy = scy;
      ty = tcy;
    } else {
      sy = dy > 0 ? sourceRect.y + sourceRect.height : sourceRect.y;
      ty = dy > 0 ? targetRect.y : targetRect.y + targetRect.height;
      sx = scx;
      tx = tcx;
    }
  }
  return { sx, sy, tx, ty };
}
function straightPath(sx, sy, tx, ty) {
  return `M ${sx} ${sy} L ${tx} ${ty}`;
}
function bezierPath(sx, sy, tx, ty) {
  const dx = Math.abs(tx - sx);
  const dy = Math.abs(ty - sy);
  const offset = Math.max(40, Math.min(dx, dy) * 0.5);
  if (Math.abs(tx - sx) > Math.abs(ty - sy)) {
    const c1x = sx + (tx > sx ? offset : -offset);
    const c2x = tx + (tx > sx ? -offset : offset);
    return `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`;
  }
  const c1y = sy + (ty > sy ? offset : -offset);
  const c2y = ty + (ty > sy ? -offset : offset);
  return `M ${sx} ${sy} C ${sx} ${c1y}, ${tx} ${c2y}, ${tx} ${ty}`;
}
function elbowPath(sx, sy, tx, ty) {
  const midX = (sx + tx) / 2;
  return `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tx} ${ty}`;
}
function buildEdgePath(style, sourceRect, targetRect) {
  const { sx, sy, tx, ty } = edgeEndpoints(sourceRect, targetRect);
  if (style === "straight") return straightPath(sx, sy, tx, ty);
  if (style === "elbow") return elbowPath(sx, sy, tx, ty);
  return bezierPath(sx, sy, tx, ty);
}
function arrowheadPoints(arrowheads) {
  if (arrowheads === "none") return { start: false, end: false };
  if (arrowheads === "both") return { start: true, end: true };
  return { start: false, end: true };
}

// src/model.js
var DIAGRAM_PULL_PATTERN = `[:block/uid :block/string :block/props
  {:block/children [:block/uid :block/string :block/order]}
  {:diagram/nodes [:block/uid :diagram.node/data
    {:diagram.node/block [:block/uid :block/string]}
    {:diagram.node/parent-node [:db/id :block/uid]}]}
  {:diagram/edges [:block/uid :diagram.edge/data
    {:diagram.edge/source [:block/uid :db/id]}
    {:diagram.edge/target [:block/uid :db/id]}]}]`;
function stripKeywords(value) {
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
function childrenFingerprint(children) {
  return JSON.stringify(
    (children || []).map((child) => [child.uid, child.string, child.order]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );
}
function treeFingerprint(tree) {
  const visit = (node) => [node.uid, node.string, (node.children || []).map(visit)];
  return JSON.stringify(visit(tree));
}
function normalizePull(node) {
  if (!node) return null;
  const children = (node[":block/children"] || node.children || []).map(normalizePull).filter(Boolean).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
      parentNode: n[":diagram.node/parent-node"] ?? n.parentNode ?? null
    })),
    diagramEdges: (node[":diagram/edges"] || node.diagramEdges || []).map((e) => ({
      uid: e[":block/uid"] ?? e.uid,
      data: stripKeywords(e[":diagram.edge/data"] ?? e.data ?? {}),
      source: stripKeywords(e[":diagram.edge/source"] ?? e.source),
      target: stripKeywords(e[":diagram.edge/target"] ?? e.target)
    }))
  };
}
function parsePullResult(raw) {
  return normalizePull(raw);
}
var MIN_CARD_WIDTH = 240;
var MIN_CARD_HEIGHT = 140;
var DEFAULT_CARD_WIDTH = 280;
var DEFAULT_CARD_HEIGHT = 160;
function flooredCardSize(width, height, defaults = {}) {
  const defaultWidth = Number(defaults.width) || DEFAULT_CARD_WIDTH;
  const defaultHeight = Number(defaults.height) || DEFAULT_CARD_HEIGHT;
  const minWidth = Number(defaults.minWidth) || MIN_CARD_WIDTH;
  const minHeight = Number(defaults.minHeight) || MIN_CARD_HEIGHT;
  const w = Number(width);
  const h = Number(height);
  return {
    width: Number.isFinite(w) && w >= minWidth ? w : Math.max(defaultWidth, minWidth),
    height: Number.isFinite(h) && h >= minHeight ? h : Math.max(defaultHeight, minHeight)
  };
}
function nodeList(nodes) {
  if (nodes instanceof Map) return [...nodes.values()];
  if (Array.isArray(nodes)) return nodes;
  return [];
}
function contentBounds(nodes) {
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
function viewportNeedsFit(viewport, nodes, viewSize = null, options = {}) {
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
function fitViewport(nodes, viewSize, options = {}) {
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
    maxFitZoom
  );
  const zoom = Math.min(zoomMax, Math.max(zoomMin, fitZoom));
  return {
    x: (viewW - bounds.width * zoom) / 2 - bounds.minX * zoom,
    y: (viewH - bounds.height * zoom) / 2 - bounds.minY * zoom,
    zoom
  };
}
function importNativeLayout(tree, metadataLayout, defaults = {}) {
  const nodes = new Map(metadataLayout?.nodes ? [...metadataLayout.nodes] : []);
  const edges = [...metadataLayout?.edges || []];
  const nodeUidToContent = /* @__PURE__ */ new Map();
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
      color: ""
    });
  }
  for (const [contentUid, node] of nodes) {
    if (!node) {
      nodes.delete(contentUid);
      continue;
    }
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
    edges.push({ source: srcContent, target: tgtContent, kind: "bezier" });
    existingEdgeKeys.add(key);
  }
  return { nodes, edges };
}
var DiagramModel = class _DiagramModel {
  constructor({ diagramUid, tree, metadataLayout, defaults = {} }) {
    this.diagramUid = diagramUid;
    this.tree = tree;
    this.children = [...tree.children || []];
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
    this.selected = /* @__PURE__ */ new Set();
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
    const size = defaults.size ? flooredCardSize(defaults.size.width, defaults.size.height, defaults) : flooredCardSize(defaults.width, defaults.height, defaults);
    const node = {
      pos: defaults.pos ? { ...defaults.pos } : { x: 0, y: 0 },
      size,
      color: ""
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
      height: Math.max(MIN_CARD_HEIGHT, Number(size.height) || MIN_CARD_HEIGHT)
    };
  }
  addEdge(source, target, kind = "bezier") {
    const key = `${source}->${target}`;
    if (this.edges.some((edge2) => `${edge2.source}->${edge2.target}` === key)) return null;
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
      sections: new Map([...this.sections].map(([id, section]) => [id, { ...section }]))
    };
  }
  // A pull only refreshes content (children, strings). Positions, sizes, edges,
  // sections and the viewport held in memory are the truth while a view is alive:
  // a debounced persist may still be in flight, and re-importing stale metadata
  // here snapped dragged cards back and re-applied native zoomed-out viewports.
  applyPull(tree, metadataLayout, defaults = {}) {
    const next = new _DiagramModel({ diagramUid: this.diagramUid, tree, metadataLayout, defaults });
    this.tree = next.tree;
    this.children = next.children;
    this.childrenFingerprint = next.childrenFingerprint;
    this.baseFingerprint = next.baseFingerprint;
    for (const [contentUid, node] of next.nodes) {
      if (!this.nodes.has(contentUid)) this.nodes.set(contentUid, node);
    }
    const known = new Set(this.edges.map((edge) => `${edge.source}->${edge.target}`));
    for (const edge of next.edges) {
      const key = `${edge.source}->${edge.target}`;
      if (known.has(key)) continue;
      this.edges.push(edge);
      known.add(key);
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
        size: { width: cardWidth, height: cardHeight }
      });
      col += 1;
      if (col >= cols) {
        col = 0;
        row += 1;
      }
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
};

// src/canvas.js
var SVG_NS = "http://www.w3.org/2000/svg";
var DRAG_THRESHOLD_PX = 4;
var PERSIST_DEBOUNCE_MS = 150;
var EDIT_GRACE_MS = 1e3;
var HINT_TEXT = "Drag empty space to pan · double-click to add a card · Fullscreen for a real board";
function shouldCommitPulledString(previous, pulled) {
  if (typeof pulled !== "string") return false;
  if (pulled === previous) return false;
  if (pulled.trim() === "" && String(previous || "").trim() !== "") return false;
  return true;
}
function topbarOffset(root = globalThis.document) {
  const topbar = root?.querySelector?.(".rm-topbar");
  if (!topbar?.getBoundingClientRect) return 0;
  const bottom = topbar.getBoundingClientRect().bottom;
  return Number.isFinite(bottom) ? Math.max(0, Math.round(bottom)) : 0;
}
function raf(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    const id2 = globalThis.requestAnimationFrame(callback);
    return () => globalThis.cancelAnimationFrame?.(id2);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}
function roamUi() {
  return globalThis.roamAlphaAPI?.ui;
}
function isTextEntryTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('.rm-block__input, [contenteditable="true"], .pxd-library-drawer'));
}
function createCanvasRoot({ session, settings, version, onPersist }) {
  const root = document.createElement("div");
  root.className = "pxd-root";
  const grid = document.createElement("div");
  grid.className = "pxd-grid";
  const world = document.createElement("div");
  world.className = "pxd-world";
  const edgesSvg = document.createElementNS(SVG_NS, "svg");
  edgesSvg.classList.add("pxd-edges");
  const cardsLayer = document.createElement("div");
  cardsLayer.className = "pxd-cards";
  const sectionsLayer = document.createElement("div");
  sectionsLayer.className = "pxd-sections";
  const toolbar = document.createElement("div");
  toolbar.className = "pxd-toolbar";
  const hint = document.createElement("div");
  hint.className = "pxd-hint";
  hint.textContent = HINT_TEXT;
  const minimap = settings.get("minimap") ? document.createElement("div") : null;
  if (minimap) minimap.className = "pxd-minimap";
  world.append(sectionsLayer, edgesSvg, cardsLayer);
  root.append(grid, world, toolbar, hint);
  if (minimap) root.append(minimap);
  const model = () => session.model;
  const num = (id, fallback) => {
    const value = Number(settings.get(id));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const zoomBounds = () => ({ zoomMin: num("zoom-min", 0.15), zoomMax: num("zoom-max", 3) });
  const defaultCardSize = () => ({
    width: Math.max(MIN_CARD_WIDTH, num("default-card-width", 280)),
    height: Math.max(MIN_CARD_HEIGHT, num("default-card-height", 160))
  });
  const getGridSize = () => num("grid-size", 24);
  const snap = (value) => {
    if (!settings.get("snap-to-grid")) return value;
    const size = getGridSize();
    return Math.round(value / size) * size;
  };
  const rootRect = () => root.getBoundingClientRect();
  const viewSize = () => {
    const rect = rootRect();
    return { width: rect.width, height: rect.height };
  };
  const screenToWorld = (clientX, clientY, snapped = true) => {
    const rect = rootRect();
    const { x, y, zoom } = model().viewport;
    const wx = (clientX - rect.left - x) / (zoom || 1);
    const wy = (clientY - rect.top - y) / (zoom || 1);
    return snapped ? { x: snap(wx), y: snap(wy) } : { x: wx, y: wy };
  };
  const mountEl = () => root.closest?.(".pxd-mount") || null;
  const isFullscreen = () => Boolean(mountEl()?.classList?.contains?.("pxd-mount--fullscreen"));
  let disposed = false;
  let viewportDirty = false;
  let layoutDirty = false;
  let viewportTimer = null;
  let layoutTimer = null;
  const flushViewport = async () => {
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = null;
    if (!viewportDirty) return;
    try {
      await onPersist?.({ persistViewport: true });
      viewportDirty = false;
    } catch (error) {
      throw error;
    }
  };
  const flushLayout = async () => {
    if (layoutTimer) clearTimeout(layoutTimer);
    layoutTimer = null;
    if (!layoutDirty) return;
    try {
      await onPersist?.({ persistLayout: true });
      layoutDirty = false;
    } catch (error) {
      throw error;
    }
  };
  const schedulePersistViewport = () => {
    if (disposed || !viewportDirty) return;
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = setTimeout(flushViewport, PERSIST_DEBOUNCE_MS);
  };
  const schedulePersistLayout = () => {
    if (disposed || !layoutDirty) return;
    if (layoutTimer) clearTimeout(layoutTimer);
    layoutTimer = setTimeout(flushLayout, PERSIST_DEBOUNCE_MS);
  };
  const markViewportDirty = () => {
    viewportDirty = true;
    schedulePersistViewport();
  };
  const markLayoutDirty = () => {
    layoutDirty = true;
    schedulePersistLayout();
  };
  const zoomLabel = document.createElement("button");
  zoomLabel.type = "button";
  zoomLabel.className = "pxd-toolbar__zoom-level";
  zoomLabel.title = "Reset zoom to 100%";
  const renderGrid = () => {
    const show = settings.get("show-grid");
    const style = settings.get("grid-style") || "dots";
    grid.className = "pxd-grid";
    grid.classList.toggle("pxd-grid--hidden", !show || style === "none");
    grid.classList.toggle("pxd-grid--dots", style === "dots");
    grid.classList.toggle("pxd-grid--lines", style === "lines");
  };
  let minimapScheduled = null;
  const updateMinimap = () => {
    if (!minimap) return;
    const rect = rootRect();
    const { x, y, zoom } = model().viewport;
    const z = zoom || 1;
    const view = { minX: -x / z, minY: -y / z, maxX: (rect.width - x) / z, maxY: (rect.height - y) / z };
    const content = contentBounds(model().nodes) || view;
    const minX = Math.min(content.minX, view.minX);
    const minY = Math.min(content.minY, view.minY);
    const maxX = Math.max(content.maxX, view.maxX);
    const maxY = Math.max(content.maxY, view.maxY);
    const mw = 140;
    const mh = 90;
    const scale = Math.min(mw / Math.max(maxX - minX, 1), mh / Math.max(maxY - minY, 1));
    const offsetX = (mw - (maxX - minX) * scale) / 2;
    const offsetY = (mh - (maxY - minY) * scale) / 2;
    minimap.innerHTML = "";
    for (const child of model().children) {
      const node = model().nodes.get(child.uid);
      if (!node) continue;
      const dot = document.createElement("div");
      dot.className = "pxd-minimap__card";
      if (model().selected.has(child.uid)) dot.classList.add("pxd-minimap__card--selected");
      dot.style.left = `${offsetX + (node.pos.x - minX) * scale}px`;
      dot.style.top = `${offsetY + (node.pos.y - minY) * scale}px`;
      dot.style.width = `${Math.max(2, node.size.width * scale)}px`;
      dot.style.height = `${Math.max(2, node.size.height * scale)}px`;
      minimap.append(dot);
    }
    const frame = document.createElement("div");
    frame.className = "pxd-minimap__view";
    frame.style.left = `${offsetX + (view.minX - minX) * scale}px`;
    frame.style.top = `${offsetY + (view.minY - minY) * scale}px`;
    frame.style.width = `${Math.max(2, (view.maxX - view.minX) * scale)}px`;
    frame.style.height = `${Math.max(2, (view.maxY - view.minY) * scale)}px`;
    minimap.append(frame);
  };
  const scheduleMinimap = () => {
    if (!minimap || minimapScheduled) return;
    minimapScheduled = raf(() => {
      minimapScheduled = null;
      updateMinimap();
    });
  };
  const applyTransform = () => {
    const { x, y, zoom } = model().viewport;
    world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    const gridPx = getGridSize() * (zoom || 1);
    grid.style.setProperty("--pxd-grid-size", `${gridPx}px`);
    grid.style.backgroundPosition = `${x}px ${y}px`;
    zoomLabel.textContent = `${Math.round((zoom || 1) * 100)}%`;
    scheduleMinimap();
  };
  const clampZoom = (zoom) => {
    const { zoomMin, zoomMax } = zoomBounds();
    return Math.min(zoomMax, Math.max(zoomMin, zoom));
  };
  const zoomAt = (nextZoomRaw, screenX, screenY) => {
    const viewport = model().viewport;
    const oldZoom = viewport.zoom || 1;
    const nextZoom = clampZoom(nextZoomRaw);
    if (nextZoom === oldZoom) return;
    const worldX = (screenX - viewport.x) / oldZoom;
    const worldY = (screenY - viewport.y) / oldZoom;
    viewport.zoom = nextZoom;
    viewport.x = screenX - worldX * nextZoom;
    viewport.y = screenY - worldY * nextZoom;
    applyTransform();
  };
  const zoomAroundCenter = (factor) => {
    const rect = rootRect();
    const oldZoom = model().viewport.zoom || 1;
    zoomAt(oldZoom * factor, rect.width / 2, rect.height / 2);
    if ((model().viewport.zoom || 1) !== oldZoom) markViewportDirty();
  };
  const fitToView = () => {
    const { zoomMin, zoomMax } = zoomBounds();
    const next = fitViewport(model().nodes, viewSize(), { zoomMin, zoomMax });
    model().viewport = next;
    model().viewportSource = "fit";
    applyTransform();
    return next;
  };
  let cancelInitialFit = null;
  let initialFitDone = false;
  const keepCenterAcross = (mutate) => {
    const before = rootRect();
    const viewport = model().viewport;
    const zoom = viewport.zoom || 1;
    const centerWorld = {
      x: (before.width / 2 - viewport.x) / zoom,
      y: (before.height / 2 - viewport.y) / zoom
    };
    const fitPending = !initialFitDone;
    mutate();
    const settle = () => {
      if (disposed || fitPending) return;
      const after = rootRect();
      if (!after.width || !after.height) return;
      viewport.x = after.width / 2 - centerWorld.x * zoom;
      viewport.y = after.height / 2 - centerWorld.y * zoom;
      applyTransform();
    };
    raf(settle);
  };
  const scheduleInitialFit = (attempt = 0) => {
    if (initialFitDone || disposed) return;
    cancelInitialFit = raf(() => {
      cancelInitialFit = null;
      if (disposed) return;
      const size = viewSize();
      if ((!size.width || !size.height) && attempt < 30) {
        scheduleInitialFit(attempt + 1);
        return;
      }
      initialFitDone = true;
      if (!size.width || !size.height) return;
      if (viewportNeedsFit(model().viewport, model().nodes, size)) {
        fitToView();
      } else {
        applyTransform();
      }
    });
  };
  const tools = [
    ["select", "Select", "Select, drag, and pan (V)"],
    ["card", "Card", "Click the board to add a card"],
    ["connect", "Connect", "Drag from one card to another"],
    ["section", "Section", "Click the board to add a section frame"],
    ["nested", "Nested", "Click the board to add a nested diagram card"],
    ["library", "Library", "Place existing pages as cards"]
  ];
  const toolButtons = /* @__PURE__ */ new Map();
  const setActiveTool = (tool) => {
    model().activeTool = tool;
    for (const [name, button] of toolButtons) {
      button.classList.toggle("pxd-toolbar__btn--active", name === tool);
    }
    root.dataset.tool = tool;
    syncHint();
  };
  const makeButton = (label, title, className = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pxd-toolbar__btn${className ? ` ${className}` : ""}`;
    button.textContent = label;
    button.title = title;
    return button;
  };
  const toolGroup = document.createElement("div");
  toolGroup.className = "pxd-toolbar__group";
  for (const [tool, label, title] of tools) {
    const button = makeButton(label, title);
    button.dataset.tool = tool;
    button.addEventListener("click", () => {
      if (tool === "library") {
        onPersist?.({ toggleLibrary: true });
        return;
      }
      setActiveTool(tool);
    });
    toolButtons.set(tool, button);
    toolGroup.append(button);
  }
  toolbar.append(toolGroup);
  const viewGroup = document.createElement("div");
  viewGroup.className = "pxd-toolbar__group";
  const zoomOutBtn = makeButton("Zoom-", "Zoom out", "pxd-toolbar__btn--zoom");
  zoomOutBtn.addEventListener("click", () => zoomAroundCenter(1 / 1.2));
  const zoomInBtn = makeButton("Zoom+", "Zoom in", "pxd-toolbar__btn--zoom");
  zoomInBtn.addEventListener("click", () => zoomAroundCenter(1.2));
  zoomLabel.addEventListener("click", () => {
    const rect = rootRect();
    zoomAt(1, rect.width / 2, rect.height / 2);
    markViewportDirty();
  });
  const fitBtn = makeButton("Fit", "Fit all cards in view", "pxd-toolbar__btn--zoom");
  fitBtn.addEventListener("click", () => {
    fitToView();
    markViewportDirty();
  });
  const fullBtn = makeButton("Fullscreen", "Maximize like native Roam diagrams. Esc exits.", "pxd-toolbar__btn--zoom");
  fullBtn.addEventListener("click", () => setFullscreen(!isFullscreen()));
  viewGroup.append(zoomOutBtn, zoomLabel, zoomInBtn, fitBtn, fullBtn);
  toolbar.append(viewGroup);
  if (settings.get("show-version-badge")) {
    const badge = document.createElement("span");
    badge.className = "pxd-version";
    badge.textContent = `v${version}`;
    toolbar.append(badge);
  }
  const applyFullscreenChrome = (mount, on) => {
    mount.classList.toggle("pxd-mount--fullscreen", Boolean(on));
    document.body?.classList?.toggle("pxd-has-fullscreen", Boolean(on));
    if (on) {
      const top = topbarOffset();
      mount.style.top = `${top}px`;
      mount.style.left = "0px";
      mount.style.right = "0px";
      mount.style.bottom = "0px";
      mount.style.width = "auto";
      mount.style.height = "auto";
      mount.style.minHeight = "0";
    } else {
      mount.style.top = "";
      mount.style.left = "";
      mount.style.right = "";
      mount.style.bottom = "";
    }
  };
  const setFullscreen = (on) => {
    const mount = mountEl();
    if (!mount) return;
    const current = isFullscreen();
    fullBtn.textContent = on ? "Exit full screen" : "Fullscreen";
    fullBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (current === Boolean(on)) {
      if (on) applyFullscreenChrome(mount, true);
      return;
    }
    keepCenterAcross(() => applyFullscreenChrome(mount, Boolean(on)));
  };
  let hintDismissed = false;
  const syncHint = () => {
    const show = !hintDismissed && model().activeTool === "select" && (model().children?.length || 0) <= 1 && !editingUid;
    hint.classList.toggle("pxd-hint--visible", show);
  };
  const dismissHint = () => {
    if (hintDismissed) return;
    hintDismissed = true;
    syncHint();
  };
  const renderSections = () => {
    sectionsLayer.innerHTML = "";
    if (!settings.get("show-sections")) return;
    for (const [id, section] of model().sections) {
      const el = document.createElement("div");
      el.className = "pxd-section";
      el.style.left = `${section.pos?.x ?? 0}px`;
      el.style.top = `${section.pos?.y ?? 0}px`;
      el.style.width = `${section.size?.width ?? 320}px`;
      el.style.height = `${section.size?.height ?? 240}px`;
      if (settings.get("section-label") && section.title) {
        const label = document.createElement("div");
        label.className = "pxd-section__label";
        label.textContent = section.title;
        el.append(label);
      }
      el.dataset.sectionId = id;
      sectionsLayer.append(el);
    }
  };
  const edgePaths = /* @__PURE__ */ new Map();
  let tempEdge = null;
  const cardRect = (contentUid) => {
    const node = model().nodes.get(contentUid);
    if (!node) return null;
    return { x: node.pos.x, y: node.pos.y, width: node.size.width, height: node.size.height };
  };
  const edgeKey = (edge) => `${edge.source}->${edge.target}`;
  const ensureDefs = () => {
    if (edgesSvg.querySelector?.("defs")) return;
    const defs = document.createElementNS(SVG_NS, "defs");
    defs.innerHTML = `
        <marker id="pxd-arrow-end" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--pxd-edge)" />
        </marker>
        <marker id="pxd-arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M8,0 L0,4 L8,8 Z" fill="var(--pxd-edge)" />
        </marker>`;
    edgesSvg.prepend(defs);
  };
  const updateEdgePath = (edge, path) => {
    const source = cardRect(edge.source);
    const target = cardRect(edge.target);
    if (!source || !target) return false;
    const style = settings.get("connector-style") || "bezier";
    path.setAttribute("d", buildEdgePath(edge.kind || style, source, target));
    return true;
  };
  const renderEdges = () => {
    edgesSvg.innerHTML = "";
    edgePaths.clear();
    ensureDefs();
    const width = num("edge-width", 2);
    const animated = settings.get("edge-animated");
    const arrowheads = arrowheadPoints(settings.get("arrowheads") || "end");
    for (const edge of model().edges) {
      const path = document.createElementNS(SVG_NS, "path");
      if (!updateEdgePath(edge, path)) continue;
      path.classList.add("pxd-edge");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--pxd-edge)");
      path.setAttribute("stroke-width", String(width));
      path.setAttribute("stroke-linecap", "round");
      if (animated) path.classList.add("pxd-edge--animated");
      if (arrowheads.end) path.setAttribute("marker-end", "url(#pxd-arrow-end)");
      if (arrowheads.start) path.setAttribute("marker-start", "url(#pxd-arrow-start)");
      edgesSvg.append(path);
      edgePaths.set(edgeKey(edge), { edge, path });
    }
  };
  const updateEdgesFor = (uids) => {
    for (const { edge, path } of edgePaths.values()) {
      if (uids.has(edge.source) || uids.has(edge.target)) updateEdgePath(edge, path);
    }
  };
  const setTempEdge = (from, worldPoint) => {
    const source = cardRect(from);
    if (!source) return;
    if (!tempEdge) {
      tempEdge = document.createElementNS(SVG_NS, "path");
      tempEdge.classList.add("pxd-edge", "pxd-edge--temp");
      tempEdge.setAttribute("fill", "none");
      tempEdge.setAttribute("stroke", "var(--pxd-edge)");
      tempEdge.setAttribute("stroke-width", String(num("edge-width", 2)));
      edgesSvg.append(tempEdge);
    }
    const target = { x: worldPoint.x, y: worldPoint.y, width: 1, height: 1 };
    tempEdge.setAttribute("d", buildEdgePath(settings.get("connector-style") || "bezier", source, target));
  };
  const clearTempEdge = () => {
    tempEdge?.remove?.();
    tempEdge = null;
  };
  const cardEls = /* @__PURE__ */ new Map();
  let editingUid = null;
  let editOpenedAt = 0;
  const cardTitleText = (child) => child.string.replace(/\{\{.*?\}\}/, "").trim() || child.string.slice(0, 48);
  const renderStringInto = (el, string) => {
    const components = roamUi()?.components;
    if (string && components?.renderString) {
      try {
        components.renderString({ string, el });
        return;
      } catch {
      }
    }
    el.textContent = string;
  };
  const unmountRoam = (el) => {
    try {
      roamUi()?.components?.unmountNode?.({ el });
    } catch {
    }
  };
  const paintCardBody = (card, child) => {
    const body = card._pxdBody;
    if (!body) return;
    unmountRoam(body);
    body.innerHTML = "";
    card.classList.remove("pxd-card--empty");
    if (model().isNestedDiagram(child.uid)) {
      const label = document.createElement("div");
      label.className = "pxd-card__nested-label";
      label.textContent = cardTitleText(child) || "Nested diagram";
      const sub = document.createElement("div");
      sub.className = "pxd-card__placeholder";
      sub.textContent = "Double-click to open";
      body.append(label, sub);
    } else if (!child.string.trim()) {
      card.classList.add("pxd-card--empty");
      const placeholder = document.createElement("div");
      placeholder.className = "pxd-card__placeholder";
      placeholder.textContent = "Empty card · double-click to write";
      body.append(placeholder);
    } else {
      renderStringInto(body, child.string);
    }
    card._pxdString = child.string;
  };
  const focusRoamBlock = (body, uid, attempt = 0) => {
    const input = body.querySelector?.(".pxd-card__editor .rm-block__input, .pxd-card__editor textarea");
    if (!input) {
      if (attempt < 8 && editingUid === uid) setTimeout(() => focusRoamBlock(body, uid, attempt + 1), 80);
      return;
    }
    body.querySelector(".pxd-card__edit-fallback")?.remove?.();
    input.focus?.();
    input.click?.();
  };
  const exitEdit = (persistString = true) => {
    const uid = editingUid;
    if (!uid) return;
    editingUid = null;
    editOpenedAt = 0;
    const card = cardEls.get(uid);
    root.classList.remove("pxd-root--editing");
    if (!card) return;
    card.classList.remove("pxd-card--editing");
    let child = model().getCard(uid);
    if (persistString) {
      try {
        const pulled = globalThis.roamAlphaAPI?.data?.pull?.("[:block/string]", [":block/uid", uid]);
        const fresh = pulled?.[":block/string"] ?? pulled?.string;
        if (shouldCommitPulledString(child?.string, fresh)) {
          child = { ...child || { uid }, string: fresh };
          const live = model().getCard(uid);
          if (live) live.string = fresh;
        }
      } catch {
      }
    }
    if (child) paintCardBody(card, child);
    syncHint();
  };
  const enterEdit = (uid) => {
    const card = cardEls.get(uid);
    const child = model().getCard(uid);
    if (!card || !child || model().isNestedDiagram(uid)) return;
    if (editingUid === uid) return;
    if (editingUid) exitEdit();
    const components = roamUi()?.components;
    if (!settings.get("native-block-editor") || !components?.renderBlock) {
      onPersist?.({ openBlock: uid });
      return;
    }
    editingUid = uid;
    editOpenedAt = Date.now();
    model().selected = /* @__PURE__ */ new Set([uid]);
    syncSelection();
    card.classList.add("pxd-card--editing");
    root.classList.add("pxd-root--editing");
    const body = card._pxdBody;
    unmountRoam(body);
    const fallback = document.createElement("div");
    fallback.className = "pxd-card__edit-fallback";
    fallback.textContent = child.string;
    const editor = document.createElement("div");
    editor.className = "pxd-card__editor";
    body.innerHTML = "";
    body.append(fallback, editor);
    try {
      components.renderBlock({ uid, el: editor });
    } catch {
      exitEdit(false);
      return;
    }
    setTimeout(() => {
      if (editingUid === uid) focusRoamBlock(body, uid);
    }, 60);
    syncHint();
  };
  const syncSelection = () => {
    for (const [uid, card] of cardEls) {
      card.classList.toggle("pxd-card--selected", model().selected.has(uid));
    }
    scheduleMinimap();
  };
  const positionCard = (card, node) => {
    card.style.left = `${node.pos.x}px`;
    card.style.top = `${node.pos.y}px`;
    card.style.width = `${node.size.width}px`;
    card.style.height = `${node.size.height}px`;
  };
  const buildCard = (child) => {
    const card = document.createElement("div");
    card.className = "pxd-card";
    card.dataset.uid = child.uid;
    const title = document.createElement("div");
    title.className = "pxd-card__title";
    const body = document.createElement("div");
    body.className = "pxd-card__body";
    card._pxdTitle = title;
    card._pxdBody = body;
    card.append(title, body);
    for (const side of ["top", "right", "bottom", "left"]) {
      const handle = document.createElement("div");
      handle.className = `pxd-handle pxd-handle--${side}`;
      handle.dataset.side = side;
      handle.title = "Drag to connect";
      card.append(handle);
    }
    const resize = document.createElement("div");
    resize.className = "pxd-card__resize";
    resize.title = "Drag to resize";
    card.append(resize);
    return card;
  };
  const renderCards = () => {
    const defaults = defaultCardSize();
    const radius = num("card-radius", 8);
    const seen = /* @__PURE__ */ new Set();
    for (const child of model().children) {
      seen.add(child.uid);
      const node = model().ensureNode(child.uid, defaults);
      let card = cardEls.get(child.uid);
      if (!card) {
        card = buildCard(child);
        cardEls.set(child.uid, card);
        card._pxdString = null;
      }
      card.classList.toggle("pxd-card--compact", Boolean(settings.get("compact-cards")));
      card.classList.toggle("pxd-card--shadow", Boolean(settings.get("card-shadow")));
      card.classList.toggle("pxd-card--nested", model().isNestedDiagram(child.uid));
      card.classList.toggle("pxd-card--selected", model().selected.has(child.uid));
      card.style.borderRadius = `${radius}px`;
      positionCard(card, node);
      const titleText = cardTitleText(child);
      const showTitle = settings.get("show-card-title") && titleText !== child.string.trim();
      card.classList.toggle("pxd-card--titled", Boolean(showTitle));
      card._pxdTitle.textContent = showTitle ? titleText : "";
      if (editingUid !== child.uid && card._pxdString !== child.string) paintCardBody(card, child);
      if (card.parentElement !== cardsLayer) cardsLayer.append(card);
    }
    for (const [uid, card] of cardEls) {
      if (seen.has(uid)) continue;
      if (editingUid === uid) exitEdit(false);
      unmountRoam(card._pxdBody);
      card.remove();
      cardEls.delete(uid);
    }
  };
  const render = () => {
    root.dataset.renderChildrenDepth = String(settings.get("render-children-depth") ?? "1");
    renderGrid();
    applyTransform();
    renderSections();
    renderCards();
    renderEdges();
    syncHint();
    scheduleMinimap();
  };
  let gesture = null;
  let spaceDown = false;
  let lastToolAddAt = 0;
  const beginGesture = (next) => {
    gesture = next;
    root.classList.add("pxd-root--gesturing");
    if (next.kind === "pan") root.classList.add("pxd-root--panning");
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
  };
  const endGesture = () => {
    if (!gesture) return;
    gesture = null;
    root.classList.remove("pxd-root--gesturing", "pxd-root--panning", "pxd-root--dragging");
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
    clearTempEdge();
  };
  const cardFromPoint = (clientX, clientY) => {
    const el = document.elementFromPoint?.(clientX, clientY);
    const card = el?.closest?.(".pxd-card");
    return card && card.parentElement === cardsLayer ? card.dataset.uid : null;
  };
  const selectCard = (uid, additive) => {
    const selected = model().selected;
    if (additive) {
      if (selected.has(uid)) selected.delete(uid);
      else selected.add(uid);
    } else if (!selected.has(uid)) {
      selected.clear();
      selected.add(uid);
    }
    syncSelection();
  };
  const onPointerDown = (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target;
    if (target?.closest?.(".pxd-toolbar") || target?.closest?.(".pxd-library-drawer") || target?.closest?.(".pxd-minimap")) return;
    dismissHint();
    const cardEl = target?.closest?.(".pxd-card");
    const uid = cardEl?.dataset?.uid || null;
    const tool = model().activeTool || "select";
    const panRequested = event.button === 1 || spaceDown && settings.get("pan-on-space");
    if (editingUid && editingUid !== uid) exitEdit();
    if (editingUid && editingUid === uid) return;
    if (uid && !panRequested) {
      const start = { x: event.clientX, y: event.clientY };
      if (target.closest(".pxd-card__resize")) {
        const node = model().nodes.get(uid);
        beginGesture({ kind: "resize", uid, start, size: { ...node.size }, moved: false });
        event.preventDefault();
        return;
      }
      if (target.closest(".pxd-handle") || tool === "connect") {
        beginGesture({ kind: "connect", uid, start, moved: false });
        event.preventDefault();
        return;
      }
      if (tool !== "select") return;
      selectCard(uid, event.shiftKey);
      const origins = /* @__PURE__ */ new Map();
      for (const selectedUid of model().selected) {
        const node = model().nodes.get(selectedUid);
        if (node) origins.set(selectedUid, { ...node.pos });
      }
      beginGesture({ kind: "drag", uid, start, origins, moved: false });
      return;
    }
    if (panRequested || tool === "select") {
      beginGesture({
        kind: "pan",
        start: { x: event.clientX, y: event.clientY },
        viewport: { ...model().viewport },
        moved: false
      });
      event.preventDefault();
    }
  };
  const onPointerMove = (event) => {
    if (!gesture) return;
    const dx = event.clientX - gesture.start.x;
    const dy = event.clientY - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    gesture.moved = true;
    const zoom = model().viewport.zoom || 1;
    if (gesture.kind === "pan") {
      const viewport = model().viewport;
      viewport.x = gesture.viewport.x + dx;
      viewport.y = gesture.viewport.y + dy;
      applyTransform();
      return;
    }
    if (gesture.kind === "drag") {
      root.classList.add("pxd-root--dragging");
      const moved = /* @__PURE__ */ new Set();
      for (const [uid, origin] of gesture.origins) {
        const card = cardEls.get(uid);
        if (!card) continue;
        const pos = { x: snap(origin.x + dx / zoom), y: snap(origin.y + dy / zoom) };
        model().setNodePosition(uid, pos);
        positionCard(card, model().nodes.get(uid));
        moved.add(uid);
      }
      updateEdgesFor(moved);
      scheduleMinimap();
      return;
    }
    if (gesture.kind === "resize") {
      const card = cardEls.get(gesture.uid);
      if (!card) return;
      model().setNodeSize(gesture.uid, {
        width: snap(gesture.size.width + dx / zoom),
        height: snap(gesture.size.height + dy / zoom)
      });
      positionCard(card, model().nodes.get(gesture.uid));
      updateEdgesFor(/* @__PURE__ */ new Set([gesture.uid]));
      scheduleMinimap();
      return;
    }
    if (gesture.kind === "connect") {
      setTempEdge(gesture.uid, screenToWorld(event.clientX, event.clientY, false));
    }
  };
  const onPointerUp = async (event) => {
    const active = gesture;
    if (!active) return;
    endGesture();
    if (active.kind === "pan") {
      if (active.moved) markViewportDirty();
      else if (model().activeTool === "select" && !event.shiftKey && model().selected.size) {
        model().selected.clear();
        syncSelection();
      }
      return;
    }
    if (active.kind === "drag" || active.kind === "resize") {
      if (active.moved) markLayoutDirty();
      return;
    }
    if (active.kind === "connect") {
      const targetUid = cardFromPoint(event.clientX, event.clientY);
      if (!active.moved || !targetUid || targetUid === active.uid) {
        if (!active.moved) selectCard(active.uid, event.shiftKey);
        return;
      }
      const added = model().addEdge(active.uid, targetUid, settings.get("connector-style") || "bezier");
      if (added) {
        renderEdges();
        layoutDirty = true;
        await flushLayout();
      }
    }
  };
  const onDoubleClick = (event) => {
    const target = event.target;
    if (target?.closest?.(".pxd-toolbar") || target?.closest?.(".pxd-library-drawer") || target?.closest?.(".pxd-minimap")) return;
    const cardEl = target?.closest?.(".pxd-card");
    const uid = cardEl?.dataset?.uid;
    if (uid) {
      if (editingUid === uid) return;
      event.preventDefault();
      if (model().isNestedDiagram(uid)) onPersist?.({ openNested: uid });
      else enterEdit(uid);
      return;
    }
    event.preventDefault();
    dismissHint();
    if (Date.now() - lastToolAddAt < 600) return;
    const point = screenToWorld(event.clientX, event.clientY);
    const size = defaultCardSize();
    setActiveTool("select");
    void onPersist?.({ addCard: { x: snap(point.x - size.width / 2), y: snap(point.y - size.height / 2) } });
  };
  const onClick = (event) => {
    const target = event.target;
    if (target?.closest?.(".pxd-card") || target?.closest?.(".pxd-toolbar")) return;
    if (target?.closest?.(".pxd-library-drawer") || target?.closest?.(".pxd-minimap")) return;
    if (event.detail > 1) return;
    const tool = model().activeTool;
    if (tool === "card" || tool === "nested" || tool === "section") {
      const point = screenToWorld(event.clientX, event.clientY);
      lastToolAddAt = Date.now();
      if (tool === "section") void onPersist?.({ addSection: point });
      else void onPersist?.({ addCard: point, string: tool === "nested" ? "{{[[diagram]]}}" : "" });
      if (tool !== "section") setActiveTool("select");
    }
  };
  const onWheel = (event) => {
    if (editingUid && event.target?.closest?.(".pxd-card--editing")) return;
    const pinch = event.ctrlKey || event.metaKey;
    const zoomWheel = settings.get("wheel-zoom");
    event.preventDefault();
    const rect = rootRect();
    if (pinch || zoomWheel) {
      const oldZoom = model().viewport.zoom || 1;
      const factor = Math.exp(-event.deltaY * (pinch ? 0.01 : 2e-3));
      zoomAt(oldZoom * factor, event.clientX - rect.left, event.clientY - rect.top);
      if ((model().viewport.zoom || 1) !== oldZoom) markViewportDirty();
    } else {
      const viewport = model().viewport;
      viewport.x -= event.deltaX;
      viewport.y -= event.deltaY;
      applyTransform();
      markViewportDirty();
    }
  };
  const onFocusOut = (event) => {
    if (!editingUid) return;
    if (Date.now() - editOpenedAt < EDIT_GRACE_MS) return;
    const card = cardEls.get(editingUid);
    if (!card) return;
    const next = event.relatedTarget;
    if (next && (card.contains?.(next) || next.closest?.(".bp3-portal, .rm-autocomplete__wrapper"))) return;
    setTimeout(() => {
      if (!editingUid) return;
      if (Date.now() - editOpenedAt < EDIT_GRACE_MS) return;
      const activeEl = document.activeElement;
      if (activeEl && (card.contains?.(activeEl) || activeEl.closest?.(".bp3-portal, .rm-autocomplete__wrapper"))) return;
      exitEdit();
    }, 0);
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      if (editingUid) {
        if (event.target?.closest?.(".pxd-card--editing")) return;
        exitEdit();
        return;
      }
      if (isFullscreen()) {
        event.preventDefault();
        event.stopPropagation();
        setFullscreen(false);
      }
      return;
    }
    if (event.code === "Space" && settings.get("pan-on-space") && !isTextEntryTarget(event.target)) {
      spaceDown = true;
      root.classList.add("pxd-root--space");
    }
  };
  const onKeyUp = (event) => {
    if (event.code === "Space") {
      spaceDown = false;
      root.classList.remove("pxd-root--space");
    }
  };
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("dblclick", onDoubleClick);
  root.addEventListener("click", onClick);
  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("focusout", onFocusOut);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  setActiveTool(model().activeTool || "select");
  render();
  scheduleInitialFit();
  return {
    root,
    render,
    applyTransform,
    fitToView,
    editCard: enterEdit,
    setLibraryOpen(open) {
      toolButtons.get("library")?.classList.toggle("pxd-toolbar__btn--active", Boolean(open));
    },
    setFullscreen,
    dispose() {
      disposed = true;
      cancelInitialFit?.();
      minimapScheduled?.();
      if (editingUid) exitEdit(false);
      endGesture();
      if (viewportTimer) {
        clearTimeout(viewportTimer);
        viewportTimer = null;
      }
      if (layoutTimer) {
        clearTimeout(layoutTimer);
        layoutTimer = null;
      }
      for (const card of cardEls.values()) unmountRoam(card._pxdBody);
      cardEls.clear();
      setFullscreen(false);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      root.remove();
    }
  };
}
function viewportCenterPosition(root, session, settings) {
  const rect = root.getBoundingClientRect();
  const zoom = session.model.viewport.zoom || 1;
  const snap = (value) => {
    if (!settings?.get?.("snap-to-grid")) return value;
    const size = Number(settings.get("grid-size")) || 24;
    return Math.round(value / size) * size;
  };
  return {
    x: snap((rect.width / 2 - session.model.viewport.x) / zoom),
    y: snap((rect.height / 2 - session.model.viewport.y) / zoom)
  };
}

// src/adapter.js
function roam2() {
  return globalThis.roamAlphaAPI;
}
var MutationQueue = class {
  constructor() {
    this.tail = Promise.resolve();
  }
  run(task) {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => {
    });
    return next;
  }
};
var DiagramAdapter = class {
  constructor(diagramUid, pullPattern) {
    this.diagramUid = diagramUid;
    this.pullPattern = pullPattern;
    this.queue = new MutationQueue();
    this.baseTree = null;
    this.childrenFingerprint = null;
    this.expectedStructuralFingerprint = null;
    this.watchHandler = null;
  }
  pull() {
    const api = roam2();
    const raw = api.data.pull(this.pullPattern, [":block/uid", this.diagramUid]);
    return parsePullResult(raw);
  }
  adoptBaseTree(tree) {
    this.baseTree = tree;
    this.childrenFingerprint = childrenFingerprint(tree.children);
  }
  recordExpectedFingerprint(tree) {
    this.expectedStructuralFingerprint = childrenFingerprint(tree.children);
  }
  consumeExpectedFingerprint(tree) {
    const fp = childrenFingerprint(tree.children);
    if (this.expectedStructuralFingerprint && fp === this.expectedStructuralFingerprint) {
      this.expectedStructuralFingerprint = null;
      return true;
    }
    return false;
  }
  watchExternal(callback) {
    const entity = `[:block/uid "${this.diagramUid}"]`;
    const handler = (before, after) => {
      const next = parsePullResult(after);
      const prev = parsePullResult(before);
      if (!next) return;
      const structural = !prev || childrenFingerprint(prev.children) !== childrenFingerprint(next.children);
      if (structural && this.consumeExpectedFingerprint(next)) return;
      callback(next, { structural });
    };
    roam2().data.addPullWatch(this.pullPattern, entity, handler);
    this.watchHandler = handler;
    return () => roam2().data.removePullWatch(this.pullPattern, entity, handler);
  }
  async createChild(string, order = "last") {
    return this.queue.run(async () => {
      const api = roam2();
      const current = this.pull();
      const beforeFp = childrenFingerprint(current.children);
      const uid = api.util.generateUID();
      await api.data.block.create({
        location: { "parent-uid": this.diagramUid, order },
        block: { uid, string }
      });
      const after = this.pull();
      this.recordExpectedFingerprint(after);
      this.adoptBaseTree(after);
      if (childrenFingerprint(after.children) === beforeFp) {
        throw new Error("Child create did not change diagram children");
      }
      return uid;
    });
  }
  async updateViewport(viewport) {
    return this.queue.run(async () => {
      const api = roam2();
      const props = { ":rf-diagram": { viewport } };
      if (typeof api.updateBlock === "function") {
        await api.updateBlock({ block: { uid: this.diagramUid, props } });
        return;
      }
      await api.data.block.update({
        block: { uid: this.diagramUid, props }
      });
    });
  }
  async deleteChild(contentUid) {
    return this.queue.run(async () => {
      const current = this.pull();
      const beforeFp = childrenFingerprint(current.children);
      await roam2().data.block.delete({ block: { uid: contentUid } });
      const after = this.pull();
      this.recordExpectedFingerprint(after);
      this.adoptBaseTree(after);
      if (childrenFingerprint(after.children) === beforeFp) {
        throw new Error("Child delete did not change diagram children");
      }
    });
  }
  verifyChildrenBeforeWrite() {
    const current = this.pull();
    const fp = childrenFingerprint(current.children);
    if (this.childrenFingerprint && fp !== this.childrenFingerprint) {
      return { ok: false, tree: current };
    }
    return { ok: true, tree: current };
  }
};

// src/session.js
var NativeDiagramSession = class {
  constructor({ diagramUid, metadataStore, settings, onChange }) {
    this.diagramUid = diagramUid;
    this.metadataStore = metadataStore;
    this.settings = settings;
    this.onChange = onChange;
    this.adapter = new DiagramAdapter(diagramUid, DIAGRAM_PULL_PATTERN);
    this.model = null;
    this.views = /* @__PURE__ */ new Set();
    this.unwatch = null;
    this.persistQueue = new MutationQueue();
  }
  load() {
    const tree = this.adapter.pull();
    const metadataLayout = this.metadataStore.get(this.diagramUid);
    this.model = new DiagramModel({
      diagramUid: this.diagramUid,
      tree,
      metadataLayout,
      defaults: {
        width: Number(this.settings.get("default-card-width")) || 280,
        height: Number(this.settings.get("default-card-height")) || 160
      }
    });
    this.adapter.adoptBaseTree(tree);
    return this.model;
  }
  startWatch() {
    if (this.unwatch) return;
    this.unwatch = this.adapter.watchExternal((tree, info) => {
      const metadataLayout = this.metadataStore.get(this.diagramUid);
      this.model.applyPull(tree, metadataLayout, {
        width: Number(this.settings.get("default-card-width")) || 280,
        height: Number(this.settings.get("default-card-height")) || 160
      });
      this.adapter.adoptBaseTree(tree);
      this.notifyViews(info);
    });
  }
  stopWatch() {
    if (this.unwatch) this.unwatch();
    this.unwatch = null;
  }
  addView(view) {
    this.views.add(view);
  }
  removeView(view) {
    this.views.delete(view);
  }
  notifyViews(info = {}) {
    for (const view of this.views) view.refresh?.(info);
    this.onChange?.(this, info);
  }
  async persistLayout() {
    return this.persistQueue.run(async () => {
      const layout = this.model.layoutSnapshot();
      await this.metadataStore.set(this.diagramUid, layout);
    });
  }
  async persistViewport() {
    return this.persistQueue.run(async () => {
      await this.metadataStore.setViewport(this.diagramUid, { ...this.model.viewport });
    });
  }
  async seedNativeViewport() {
    return this.persistQueue.run(async () => {
      await this.adapter.updateViewport({ ...this.model.viewport });
    });
  }
  async addCard(string, position) {
    const contentUid = await this.adapter.createChild(string);
    this.model.ensureNode(contentUid, {
      pos: position,
      width: Number(this.settings.get("default-card-width")) || 280,
      height: Number(this.settings.get("default-card-height")) || 160
    });
    const tree = this.adapter.pull();
    this.model.applyPull(tree, this.metadataStore.get(this.diagramUid), {});
    this.adapter.adoptBaseTree(tree);
    await this.persistLayout();
    this.notifyViews({ type: "structural" });
    return contentUid;
  }
  async addSection(position) {
    const id = `s${Date.now().toString(36)}`;
    this.model.sections.set(id, {
      pos: { ...position },
      size: { width: 320, height: 240 },
      title: ""
    });
    await this.persistLayout();
    this.notifyViews({ type: "section" });
    return id;
  }
  async connectSelected(kind) {
    const selected = [...this.model.selected];
    if (selected.length !== 2) return false;
    this.model.addEdge(selected[0], selected[1], kind);
    await this.persistLayout();
    this.notifyViews({ type: "edge" });
    return true;
  }
  dispose() {
    this.stopWatch();
    for (const view of [...this.views]) view.dispose?.();
    this.views.clear();
  }
};
function pruneDetachedViews(session) {
  for (const view of [...session.views]) {
    const root = view.wrapper || view.canvas?.root || null;
    if (root && root.isConnected === false) {
      try {
        view.dispose?.();
      } catch (error) {
        console.warn("[plexus-diagram] Detached view cleanup failed", error);
      }
      session.removeView(view);
    }
  }
}
var sessions = /* @__PURE__ */ new Map();
function getOrCreateSession(diagramUid, factory) {
  const existing = sessions.get(diagramUid);
  if (existing) {
    pruneDetachedViews(existing);
    return existing;
  }
  const session = factory();
  sessions.set(diagramUid, session);
  return session;
}
function disposeSession(diagramUid) {
  const session = sessions.get(diagramUid);
  if (session) session.dispose();
  sessions.delete(diagramUid);
}
function getSession(diagramUid) {
  return sessions.get(diagramUid) || null;
}
function allSessions() {
  return sessions;
}

// src/view.js
function isZoomedDiagramPage(nativeElement, diagramUid, hash) {
  if (nativeElement?.closest?.(".rm-zoom-block-wrapper")) return true;
  const pageUid = diagramUidFromLocation(hash);
  return Boolean(diagramUid && pageUid && pageUid === diagramUid);
}
function mountDiagramView({ nativeElement, session, settings, version, lifecycle, onAction }) {
  const host = nativeElement.parentElement || nativeElement;
  const defaultHeight = Number(settings.get("default-height")) || 560;
  const nativeRect = nativeElement.getBoundingClientRect();
  const zoomed = nativeElement.closest(".rm-zoom-block-wrapper") || nativeElement.closest(".roam-article");
  const articleRect = zoomed?.getBoundingClientRect();
  const wrapperHeight = zoomed ? Math.max((articleRect?.height || window.innerHeight) - 24, defaultHeight) : Math.max(nativeRect.height || 0, defaultHeight);
  nativeElement.classList.add(NATIVE_HIDDEN_CLASS);
  nativeElement.classList.remove(PENDING_CLASS);
  const wrapper = document.createElement("div");
  wrapper.className = "pxd-mount";
  if (zoomed) wrapper.classList.add("pxd-mount--zoomed");
  if (session?.diagramUid) wrapper.dataset.diagramUid = String(session.diagramUid);
  wrapper.style.width = "100%";
  wrapper.style.height = `${wrapperHeight}px`;
  wrapper.style.minHeight = `${wrapperHeight}px`;
  wrapper.style.position = "relative";
  const canvas = createCanvasRoot({
    session,
    settings,
    version,
    onPersist: async (action) => {
      if (action.persistLayout) await session.persistLayout();
      if (action.persistViewport) await session.persistViewport();
      if (action.toggleLibrary) onAction?.({ type: "library" });
      if (action.openNested) onAction?.({ type: "nested", uid: action.openNested });
      if (action.openBlock) onAction?.({ type: "open-block", uid: action.openBlock });
      if (action.addCard) {
        const uid = await session.addCard(action.string ?? "", action.addCard);
        canvas.render();
        if (uid && !action.string) canvas.editCard?.(uid);
      }
      if (action.addSection) {
        await session.addSection(action.addSection);
        canvas.render();
      }
    }
  });
  wrapper.append(canvas.root);
  host.insertBefore(wrapper, nativeElement.nextSibling);
  if (settings.get("fullscreen-on-zoom") !== false && isZoomedDiagramPage(nativeElement, session?.diagramUid)) {
    canvas.setFullscreen(true);
  }
  const dispose = () => {
    canvas.dispose();
    wrapper.remove();
    nativeElement.classList.remove(NATIVE_HIDDEN_CLASS);
  };
  lifecycle.add(dispose);
  session.addView({ refresh: () => canvas.render(), dispose, canvas, wrapper, setFullscreen: canvas.setFullscreen });
  return { wrapper, canvas, dispose };
}
function markNativePending(nativeElement) {
  nativeElement.classList.add(PENDING_CLASS);
}

// src/feature.js
var runtime = {
  extensionAPI: null,
  lifecycle: null,
  metadata: null,
  settings: null,
  version: "0.3.2",
  enhancedUids: /* @__PURE__ */ new Set(),
  activeDiagramUid: null,
  guardStyle: null,
  mounting: /* @__PURE__ */ new Set()
};
function enabled() {
  return runtime.settings?.get(SETTING_IDS.enabled) !== false;
}
function mobileBlocked() {
  return runtime.settings?.get(SETTING_IDS.disableOnMobile) && runtime.extensionAPI?.platform?.isMobile?.();
}
function guardDisabled() {
  return !enabled() || mobileBlocked();
}
function installGuard(uids) {
  if (typeof document === "undefined") return;
  if (guardDisabled()) {
    const style2 = document.getElementById(PREPAINT_STYLE_ID);
    if (style2) style2.textContent = "";
    return;
  }
  const style = document.getElementById(PREPAINT_STYLE_ID) || document.createElement("style");
  style.id = PREPAINT_STYLE_ID;
  style.textContent = enhancedUidGuardCss(uids);
  if (!style.isConnected) document.head.appendChild(style);
  runtime.guardStyle = style;
}
function syncGuard() {
  const uids = runtime.metadata?.enhancedUids?.() || [...runtime.enhancedUids];
  runtime.enhancedUids = new Set(uids);
  writeEnhancedUidCache(uids);
  installGuard(uids);
}
async function ensureMetadata() {
  if (!runtime.metadata) runtime.metadata = new MetadataStore();
  runtime.metadata.reload();
  const cached = readEnhancedUidCache();
  for (const uid of cached) {
    if (!runtime.metadata.has(uid)) runtime.metadata.diagrams.set(uid, { viewport: null, nodes: /* @__PURE__ */ new Map(), edges: [], sections: /* @__PURE__ */ new Map() });
  }
  syncGuard();
}
function connectedMountForUid(uid, root = globalThis.document) {
  if (!uid || !root?.querySelector) return null;
  const mount = root.querySelector(`.pxd-mount[data-diagram-uid="${cssAttributeValue(uid)}"]`);
  return mount && mount.isConnected !== false ? mount : null;
}
function instanceAlreadyMounted(uid, nativeElement) {
  const adjacent = nativeElement?.nextElementSibling;
  if (adjacent?.classList?.contains?.("pxd-mount") && adjacent.isConnected !== false) return true;
  return Boolean(
    nativeElement?.classList?.contains?.(NATIVE_HIDDEN_CLASS) && connectedMountForUid(uid)
  );
}
async function enhanceDiagram(uid, nativeElement) {
  if (!enabled() || mobileBlocked()) {
    console.info("[plexus-diagram] Enhance skipped — extension disabled or mobile blocked");
    return;
  }
  if (!uid || !nativeElement) return;
  if (runtime.mounting.has(uid) || instanceAlreadyMounted(uid, nativeElement)) return;
  runtime.mounting.add(uid);
  try {
    if (!runtime.metadata) await ensureMetadata();
    await runtime.metadata.ensurePage();
    markNativePending(nativeElement);
    runtime.enhancedUids.add(uid);
    writeEnhancedUidCache(runtime.enhancedUids);
    installGuard(runtime.enhancedUids);
    const session = getOrCreateSession(uid, () => new NativeDiagramSession({
      diagramUid: uid,
      metadataStore: runtime.metadata,
      settings: runtime.settings,
      onChange: () => syncGuard()
    }));
    pruneDetachedViews(session);
    session.load();
    session.startWatch();
    const layout = session.model.layoutSnapshot();
    if (!runtime.metadata.hasPersisted(uid)) {
      await runtime.metadata.set(uid, layout);
      await session.seedNativeViewport();
    } else if (!runtime.metadata.layoutMatchesStored(uid, layout)) {
      await runtime.metadata.set(uid, layout);
    }
    runtime.activeDiagramUid = uid;
    const mounted = mountDiagramView({
      nativeElement,
      session,
      settings: runtime.settings,
      version: runtime.version,
      lifecycle: runtime.lifecycle,
      onAction: async (action) => {
        if (action.type === "library") await toggleLibrary(mounted.wrapper, mounted.canvas);
        if (action.type === "nested" && action.uid) {
          globalThis.roamAlphaAPI?.ui?.mainWindow?.openBlock?.({ block: { uid: action.uid } });
        }
        if (action.type === "open-block" && action.uid) {
          globalThis.roamAlphaAPI?.ui?.rightSidebar?.addWindow?.({ window: { type: "block", "block-uid": action.uid } });
        }
      }
    });
    if (runtime.settings.get(SETTING_IDS.showLibraryOnOpen)) await openLibrary(mounted.wrapper, mounted.canvas);
    syncGuard();
  } finally {
    runtime.mounting.delete(uid);
  }
}
async function restoreDiagram(uid) {
  disposeSession(uid);
  await runtime.metadata.remove(uid);
  runtime.enhancedUids.delete(uid);
  syncGuard();
}
function blockStringForUid(uid) {
  const pull = globalThis.roamAlphaAPI?.data?.pull?.(
    "[:block/string]",
    [":block/uid", uid]
  );
  return pull?.[":block/string"] ?? pull?.string ?? "";
}
function focusedDiagramUid() {
  const uid = globalThis.roamAlphaAPI?.ui?.getFocusedBlock?.()?.["block-uid"] || runtime.extensionAPI?.ui?.getFocusedBlock?.()?.["block-uid"];
  if (!uid) return null;
  return isDiagramString(blockStringForUid(uid)) ? uid : null;
}
async function resolveDiagramUid(context) {
  const candidates = [
    context?.["block-uid"],
    context?.uid,
    globalThis.roamAlphaAPI?.ui?.getFocusedBlock?.()?.["block-uid"],
    runtime.extensionAPI?.ui?.getFocusedBlock?.()?.["block-uid"]
  ];
  try {
    const view = await globalThis.roamAlphaAPI?.ui?.mainWindow?.getOpenView?.();
    if (view?.uid) candidates.push(view.uid);
  } catch {
  }
  if (typeof document !== "undefined") {
    const visible = document.querySelector(".rm-diagram");
    if (visible) candidates.push(findDiagramUidFromEl(visible));
  }
  for (const uid of candidates) {
    if (uid && isDiagramString(blockStringForUid(uid))) return uid;
  }
  return null;
}
async function enhanceByUid(uid) {
  if (!uid) {
    console.info("[plexus-diagram] Focus a {{[[diagram]]}} block first");
    return;
  }
  await ensureMetadata();
  runtime.enhancedUids.add(uid);
  writeEnhancedUidCache(runtime.enhancedUids);
  installGuard(runtime.enhancedUids);
  let diagram = diagramElForUid(uid);
  if (!diagram && typeof document !== "undefined") diagram = document.querySelector(".rm-diagram");
  if (!diagram) diagram = await waitForDiagramEl(uid);
  if (!diagram) {
    console.info("[plexus-diagram] Native diagram canvas did not remount in time", uid);
    return;
  }
  await enhanceDiagram(uid, diagram);
}
var activeLibrary = null;
async function toggleLibrary(mountRoot, canvas) {
  const uid = runtime.activeDiagramUid || focusedDiagramUid();
  const session = uid ? getSession(uid) : null;
  if (!session) return;
  const root = mountRoot || document.querySelector(".pxd-root");
  if (activeLibrary?.isOpen?.()) {
    activeLibrary.close();
    activeLibrary = null;
    canvas?.setLibraryOpen?.(false);
    return;
  }
  activeLibrary = createLibrarySidebar({
    lifecycle: runtime.lifecycle,
    settings: runtime.settings,
    session,
    mountRoot: root,
    onClose: () => {
      activeLibrary = null;
      canvas?.setLibraryOpen?.(false);
    },
    onPlacePage: async (title) => {
      const center = root ? viewportCenterPosition(root, session, runtime.settings) : { x: 120, y: 120 };
      await session.addCard(`[[${title}]]`, center);
      session.notifyViews();
    }
  });
  canvas?.setLibraryOpen?.(true);
}
async function openLibrary(mountRoot, canvas) {
  if (activeLibrary?.isOpen?.()) return;
  await toggleLibrary(mountRoot, canvas);
}
function scanAddedNode(node) {
  for (const diagram of diagramsWithin(node)) {
    const uid = findDiagramUidFromEl(diagram);
    if (!uid) continue;
    if (!runtime.enhancedUids.has(uid)) {
      if (runtime.settings.get(SETTING_IDS.autoEnhance) && isDiagramString(blockStringForUid(uid))) {
        void enhanceDiagram(uid, diagram);
      }
      continue;
    }
    if (!diagram.classList.contains("pxd-native-hidden") && !diagram.nextElementSibling?.classList?.contains("pxd-mount")) {
      void enhanceDiagram(uid, diagram);
    }
  }
}
function installObservers(lifecycle) {
  if (typeof document === "undefined") return;
  const app = document.querySelector(".roam-app");
  if (app) {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) scanAddedNode(node);
        }
      }
    });
    lifecycle.observer(observer, app, { childList: true, subtree: true });
    scanAddedNode(app);
  }
  const bodyObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element) || !node.classList?.contains("bp3-portal")) continue;
        const portalObserver = new MutationObserver((portalRecords) => {
          for (const portalRecord of portalRecords) {
            for (const child of portalRecord.addedNodes) {
              if (child.nodeType === Node.ELEMENT_NODE) scanAddedNode(child);
            }
          }
        });
        lifecycle.observer(portalObserver, node, { childList: true, subtree: true });
        scanAddedNode(node);
      }
    }
  });
  lifecycle.observer(bodyObserver, document.body, { childList: true });
}
async function reconcileVisibleDiagrams() {
  if (guardDisabled()) return;
  if (typeof document === "undefined") return;
  for (const session of allSessions().values()) pruneDetachedViews(session);
  const pageUid = diagramUidFromLocation();
  for (const uid of [...runtime.enhancedUids]) {
    if (connectedMountForUid(uid)) continue;
    let native = diagramElForUid(uid);
    if (!native && pageUid === uid) {
      const candidate = document.querySelector(".rm-diagram");
      const candidateUid = candidate ? findDiagramUidFromEl(candidate) : null;
      if (candidate && (!candidateUid || candidateUid === uid)) native = candidate;
    }
    if (!native && pageUid === uid) native = await waitForDiagramEl(uid, { timeout: 400 });
    if (!native || native.isConnected === false) continue;
    if (connectedMountForUid(uid)) continue;
    await enhanceDiagram(uid, native);
  }
}
var RECONCILE_INTERVAL_MS = 250;
function exitFullscreenOnNavigate(hash = globalThis.location?.hash || "") {
  if (typeof document === "undefined") return;
  const height = Number(runtime.settings?.get(SETTING_IDS.defaultHeight)) || 560;
  let left = false;
  for (const uid of [...runtime.enhancedUids]) {
    if (!routeLeftZoomedDiagram(uid, hash)) continue;
    left = true;
    const session = getSession(uid);
    for (const view of session?.views || []) {
      const fn = view.setFullscreen || view.canvas?.setFullscreen;
      fn?.(false);
    }
    const mount = connectedMountForUid(uid);
    if (!mount) continue;
    mount.classList.remove("pxd-mount--fullscreen", "pxd-mount--zoomed");
    mount.style.top = "";
    mount.style.left = "";
    mount.style.right = "";
    mount.style.bottom = "";
    mount.style.width = "";
    mount.style.height = `${height}px`;
    mount.style.minHeight = `${height}px`;
  }
  if (left) document.body?.classList?.remove("pxd-has-fullscreen");
}
function installReconcile(lifecycle) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const trigger = () => {
    if (!runtime.enhancedUids.size) return;
    void reconcileVisibleDiagrams().catch((error) => console.warn("[plexus-diagram] Reconcile failed", error));
  };
  const onNavigate = () => {
    exitFullscreenOnNavigate();
    trigger();
  };
  lifecycle.event(window, "hashchange", onNavigate);
  lifecycle.event(window, "popstate", onNavigate);
  lifecycle.interval(trigger, RECONCILE_INTERVAL_MS);
}
async function registerCommands(lifecycle, extensionAPI) {
  const run = async (label, fn) => {
    const full = `Plexus Diagram: ${label}`;
    const callback = (context) => {
      if (!enabled()) {
        console.info("[plexus-diagram] Command skipped — extension disabled");
        return;
      }
      void fn(context);
    };
    await lifecycle.command(extensionAPI.ui.commandPalette, { label: full, callback });
    if (extensionAPI.ui?.slashCommand?.addCommand) {
      await lifecycle.command(extensionAPI.ui.slashCommand, { label: full, callback });
    }
  };
  await run("Enhance this diagram", async (context) => {
    await enhanceByUid(await resolveDiagramUid(context));
  });
  await run("Fullscreen this diagram", () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    const mount = document.querySelector(".pxd-mount");
    const next = !mount?.classList.contains("pxd-mount--fullscreen");
    if (session) {
      for (const view of session.views) {
        const fn = view.setFullscreen || view.canvas?.setFullscreen;
        fn?.(next);
      }
      return;
    }
    mount?.classList.toggle("pxd-mount--fullscreen", next);
    document.body.classList.toggle("pxd-has-fullscreen", next);
  });
  await run("Restore native diagram", async () => {
    const uid = focusedDiagramUid() || runtime.activeDiagramUid;
    if (uid) await restoreDiagram(uid);
  });
  await run("Add card", async () => {
    const uid = runtime.activeDiagramUid || focusedDiagramUid();
    const session = uid ? getSession(uid) : null;
    if (!session) return;
    await session.addCard("", { x: 80, y: 80 });
  });
  await run("Connect selected", async () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    if (!session) return;
    await session.connectSelected(runtime.settings.get(SETTING_IDS.connectorStyle));
  });
  await run("Toggle connect tool", () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    if (!session) return;
    session.model.activeTool = session.model.activeTool === "connect" ? "select" : "connect";
  });
  await run("Open nested diagram", () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    const uid = [...session?.model.selected || []][0];
    if (uid) globalThis.roamAlphaAPI?.ui?.mainWindow?.openBlock?.({ block: { uid } });
  });
  await run("Show library", () => openLibrary());
  await run("Appearances of this block", () => {
    const focused = extensionAPI.ui?.getFocusedBlock?.()?.["block-uid"];
    if (!focused) return;
    const rows = globalThis.roamAlphaAPI?.data?.q?.(`[:find ?diagram :where
      [?child :block/uid "${focused}"]
      [?diagram :block/children ?child]]`) || [];
    console.info("[plexus-diagram] Appearances:", rows);
  });
  await run("Snap selection to grid", async () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    if (!session) return;
    session.model.snapSelectionToGrid(Number(runtime.settings.get(SETTING_IDS.gridSize)) || 24);
    await session.persistLayout();
    session.notifyViews();
  });
  await run("Auto-layout", async () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    if (!session) return;
    session.model.autoLayoutGrid(true, Number(runtime.settings.get(SETTING_IDS.gridSize)) || 24);
    await session.persistLayout();
    session.notifyViews();
  });
}
async function registerSlashAndContext(lifecycle, extensionAPI) {
  if (extensionAPI.ui?.blockContextMenu?.addCommand) {
    await lifecycle.command(extensionAPI.ui.blockContextMenu, {
      label: "Plexus Diagram: Enhance",
      "display-conditional": (event) => isDiagramString(event["block-string"]),
      callback: async (event) => {
        await enhanceByUid(await resolveDiagramUid(event));
      }
    });
  }
}
async function installPlexusDiagram({ extensionAPI, lifecycle, version }) {
  runtime.extensionAPI = extensionAPI;
  runtime.lifecycle = lifecycle;
  runtime.version = version || "0.3.2";
  runtime.settings = createSettingsReader(extensionAPI);
  runtime.enhancedUids = readEnhancedUidCache();
  installGuard(runtime.enhancedUids);
  await registerCommands(lifecycle, extensionAPI);
  await registerSlashAndContext(lifecycle, extensionAPI);
  installObservers(lifecycle);
  installReconcile(lifecycle);
  lifecycle.add(async () => {
    if (runtime.settings.get(SETTING_IDS.restoreNativeOnUnload)) {
      for (const uid of [...runtime.enhancedUids]) await restoreDiagram(uid);
    } else {
      for (const uid of [...allSessions().keys()]) disposeSession(uid);
    }
    runtime.metadata = null;
    runtime.guardStyle?.remove?.();
  });
  if (runtime.enhancedUids.size) await ensureMetadata();
}

// src/extension.js
var activeLifecycle = null;
async function onload({ extensionAPI, extension }) {
  if (!extensionAPI) throw new TypeError("Roam did not provide extensionAPI");
  if (activeLifecycle) await activeLifecycle.dispose();
  const lifecycle = createLifecycle();
  activeLifecycle = lifecycle;
  try {
    await initializeSettings(extensionAPI);
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel());
    await installPlexusDiagram({ extensionAPI, lifecycle, version: extension?.version });
    console.info(`[plexus-diagram] Loaded v${extension?.version || "development"}`);
  } catch (error) {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose().catch((cleanupError) => console.error(cleanupError));
    throw error;
  }
  return async () => {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose();
  };
}
async function onunload() {
  const lifecycle = activeLifecycle;
  activeLifecycle = null;
  if (lifecycle) await lifecycle.dispose();
  console.info("[plexus-diagram] Unloaded");
}
var extension_default = { onload, onunload };
export {
  arrowheadPoints,
  buildEdgePath,
  childrenFingerprint,
  extension_default as default,
  enhancedUidGuardCss,
  importNativeLayout,
  isDiagramString,
  onload,
  onunload,
  settingsDefaults
};
