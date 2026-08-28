/* Plexus Diagram v0.2.0 | MIT | generated; edit src/ */

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
    selectors.push(
      `[id$="${escaped}"] .rm-diagram:not(.${NATIVE_HIDDEN_CLASS})`,
      `.rm-block-ref[data-uid="${escaped}"] .rm-diagram:not(.${NATIVE_HIDDEN_CLASS})`,
      `[data-uid="${escaped}"] .rm-diagram:not(.${NATIVE_HIDDEN_CLASS})`
    );
  }
  const hideRule = selectors.length ? `${selectors.join(",\n")} { visibility: hidden !important; pointer-events: none !important; }` : "";
  const pendingRule = unique.length ? `.rm-diagram.${PENDING_CLASS}:not(.${NATIVE_HIDDEN_CLASS}) { visibility: hidden !important; }` : "";
  return [hideRule, pendingRule].filter(Boolean).join("\n");
}
function findDiagramUidFromEl(element) {
  if (!element) return null;
  const ref = element.closest?.(".rm-block-ref[data-uid]");
  if (ref?.dataset?.uid) return ref.dataset.uid;
  const host = element.closest?.("[data-uid]");
  if (host?.dataset?.uid) return host.dataset.uid;
  const blockInput = element.closest?.('[id^="block-input-"]');
  if (blockInput?.id) {
    const match = blockInput.id.match(/block-input-.+-body-outline-\d{2}-\d{2}-\d{4}-(.+)$/);
    if (match) return match[1];
  }
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
  enableShortcuts: "enable-shortcuts"
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
  [SETTING_IDS.enableShortcuts]: true
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
      switchRow(SETTING_IDS.nativeBlockEditor, "Native block editor", "Use Roam's native block renderer inside cards."),
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
      switchRow(SETTING_IDS.enableShortcuts, "Enable shortcuts", "Enable keyboard shortcuts.")
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

// src/canvas.js
function createCanvasRoot({ session, settings, version, onPersist }) {
  const root = document.createElement("div");
  root.className = "pxd-root";
  const world = document.createElement("div");
  world.className = "pxd-world";
  const grid = document.createElement("div");
  grid.className = "pxd-grid";
  const edgesSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  edgesSvg.classList.add("pxd-edges");
  const cardsLayer = document.createElement("div");
  cardsLayer.className = "pxd-cards";
  const sectionsLayer = document.createElement("div");
  sectionsLayer.className = "pxd-sections";
  const toolbar = document.createElement("div");
  toolbar.className = "pxd-toolbar";
  const minimap = document.createElement("div");
  minimap.className = "pxd-minimap";
  world.append(grid, sectionsLayer, edgesSvg, cardsLayer);
  root.append(world, toolbar);
  if (settings.get("minimap")) root.append(minimap);
  const syncRenderChildrenDepth = () => {
    root.dataset.renderChildrenDepth = String(settings.get("render-children-depth") ?? "1");
  };
  const setActiveTool = (tool) => {
    session.model.activeTool = tool;
    toolbar.querySelectorAll(".pxd-toolbar__btn").forEach((el) => {
      el.classList.toggle("pxd-toolbar__btn--active", el.dataset.tool === tool);
    });
  };
  const tools = [
    ["select", "Select"],
    ["card", "Card"],
    ["connect", "Connect"],
    ["section", "Section"],
    ["nested", "Nested"],
    ["library", "Library"]
  ];
  for (const [tool, label] of tools) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pxd-toolbar__btn";
    button.dataset.tool = tool;
    button.title = label;
    button.textContent = label;
    button.addEventListener("click", () => {
      setActiveTool(tool);
      if (tool === "library") onPersist?.({ toggleLibrary: true });
    });
    toolbar.append(button);
  }
  const zoomInBtn = document.createElement("button");
  zoomInBtn.type = "button";
  zoomInBtn.className = "pxd-toolbar__btn pxd-toolbar__btn--zoom";
  zoomInBtn.textContent = "Zoom+";
  zoomInBtn.title = "Zoom in";
  zoomInBtn.addEventListener("click", () => {
    const zoomMax = Number(settings.get("zoom-max")) || 3;
    session.model.viewport.zoom = Math.min(zoomMax, (session.model.viewport.zoom || 1) * 1.2);
    onPersist?.({ persistViewport: true });
    render();
  });
  toolbar.append(zoomInBtn);
  const zoomOutBtn = document.createElement("button");
  zoomOutBtn.type = "button";
  zoomOutBtn.className = "pxd-toolbar__btn pxd-toolbar__btn--zoom";
  zoomOutBtn.textContent = "Zoom-";
  zoomOutBtn.title = "Zoom out";
  zoomOutBtn.addEventListener("click", () => {
    const zoomMin = Number(settings.get("zoom-min")) || 0.15;
    session.model.viewport.zoom = Math.max(zoomMin, (session.model.viewport.zoom || 1) / 1.2);
    onPersist?.({ persistViewport: true });
    render();
  });
  toolbar.append(zoomOutBtn);
  const fitBtn = document.createElement("button");
  fitBtn.type = "button";
  fitBtn.className = "pxd-toolbar__btn pxd-toolbar__btn--zoom";
  fitBtn.textContent = "Fit";
  fitBtn.title = "Fit all cards in view";
  fitBtn.addEventListener("click", () => {
    fitToView();
    onPersist?.({ persistViewport: true });
    render();
  });
  toolbar.append(fitBtn);
  if (settings.get("show-version-badge")) {
    const badge = document.createElement("span");
    badge.className = "pxd-version";
    badge.textContent = `v${version}`;
    toolbar.append(badge);
  }
  let panning = false;
  let panStart = null;
  let spaceDown = false;
  let connectFrom = null;
  const applyTransform = () => {
    const { x, y, zoom } = session.model.viewport;
    world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  };
  const getGridSize = () => Number(settings.get("grid-size")) || 24;
  const snap = (value) => {
    if (!settings.get("snap-to-grid")) return value;
    const size = getGridSize();
    return Math.round(value / size) * size;
  };
  const screenToWorld = (clientX, clientY) => {
    const rect = root.getBoundingClientRect();
    const zoom = session.model.viewport.zoom || 1;
    return {
      x: snap((clientX - rect.left - session.model.viewport.x) / zoom),
      y: snap((clientY - rect.top - session.model.viewport.y) / zoom)
    };
  };
  const cardRect = (contentUid) => {
    const node = session.model.nodes.get(contentUid);
    if (!node) return null;
    return { x: node.pos.x, y: node.pos.y, width: node.size.width, height: node.size.height };
  };
  const fitToView = () => {
    const padding = 40;
    const rect = root.getBoundingClientRect();
    const zoomMin = Number(settings.get("zoom-min")) || 0.15;
    const zoomMax = Number(settings.get("zoom-max")) || 3;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const child of session.model.children) {
      const node = session.model.nodes.get(child.uid);
      if (!node) continue;
      minX = Math.min(minX, node.pos.x);
      minY = Math.min(minY, node.pos.y);
      maxX = Math.max(maxX, node.pos.x + node.size.width);
      maxY = Math.max(maxY, node.pos.y + node.size.height);
    }
    if (!Number.isFinite(minX)) return;
    const contentW = Math.max(maxX - minX, 1);
    const contentH = Math.max(maxY - minY, 1);
    const zoom = Math.min(
      zoomMax,
      Math.max(
        zoomMin,
        Math.min((rect.width - padding * 2) / contentW, (rect.height - padding * 2) / contentH)
      )
    );
    session.model.viewport.zoom = zoom;
    session.model.viewport.x = (rect.width - contentW * zoom) / 2 - minX * zoom;
    session.model.viewport.y = (rect.height - contentH * zoom) / 2 - minY * zoom;
  };
  const renderSections = () => {
    sectionsLayer.innerHTML = "";
    if (!settings.get("show-sections")) return;
    for (const [id, section] of session.model.sections) {
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
  const renderEdges = () => {
    edgesSvg.innerHTML = "";
    const style = settings.get("connector-style") || "bezier";
    const width = Number(settings.get("edge-width")) || 2;
    const animated = settings.get("edge-animated");
    const arrowheads = arrowheadPoints(settings.get("arrowheads") || "end");
    for (const edge of session.model.edges) {
      const source = cardRect(edge.source);
      const target = cardRect(edge.target);
      if (!source || !target) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", buildEdgePath(edge.kind || style, source, target));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--pxd-active)");
      path.setAttribute("stroke-width", String(width));
      if (animated) path.classList.add("pxd-edge--animated");
      if (arrowheads.end) path.setAttribute("marker-end", "url(#pxd-arrow-end)");
      if (arrowheads.start) path.setAttribute("marker-start", "url(#pxd-arrow-start)");
      edgesSvg.append(path);
    }
    if (!edgesSvg.querySelector("defs")) {
      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      defs.innerHTML = `
        <marker id="pxd-arrow-end" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--pxd-active)" />
        </marker>
        <marker id="pxd-arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto">
          <path d="M8,0 L0,4 L8,8 Z" fill="var(--pxd-active)" />
        </marker>`;
      edgesSvg.prepend(defs);
    }
  };
  const cardTitleText = (child) => child.string.replace(/\{\{.*?\}\}/, "").trim() || child.string.slice(0, 48);
  const renderCardContent = (cardEl, child) => {
    const body = document.createElement("div");
    body.className = "pxd-card__body";
    if (settings.get("native-block-editor") && globalThis.roamAlphaAPI?.ui?.components?.renderBlock) {
      try {
        globalThis.roamAlphaAPI.ui.components.renderBlock({ uid: child.uid, el: body });
      } catch {
        body.textContent = child.string;
      }
    } else if (globalThis.roamAlphaAPI?.ui?.components?.renderString) {
      try {
        globalThis.roamAlphaAPI.ui.components.renderString({ string: child.string, el: body });
      } catch {
        body.textContent = child.string;
      }
    } else {
      body.textContent = child.string;
    }
    cardEl.append(body);
  };
  const renderCards = () => {
    cardsLayer.innerHTML = "";
    const radius = Number(settings.get("card-radius")) || 8;
    for (const child of session.model.children) {
      const node = session.model.ensureNode(child.uid, {
        width: Number(settings.get("default-card-width")) || 280,
        height: Number(settings.get("default-card-height")) || 160
      });
      const card = document.createElement("div");
      card.className = "pxd-card";
      if (settings.get("compact-cards")) card.classList.add("pxd-card--compact");
      if (settings.get("card-shadow")) card.classList.add("pxd-card--shadow");
      card.dataset.uid = child.uid;
      card.style.left = `${node.pos.x}px`;
      card.style.top = `${node.pos.y}px`;
      card.style.width = `${node.size.width}px`;
      card.style.height = `${node.size.height}px`;
      card.style.borderRadius = `${radius}px`;
      if (session.model.selected.has(child.uid)) card.classList.add("pxd-card--selected");
      const titleText = cardTitleText(child);
      if (settings.get("show-card-title") && titleText !== child.string.trim()) {
        const title = document.createElement("div");
        title.className = "pxd-card__title";
        title.textContent = titleText;
        card.append(title);
        card.classList.add("pxd-card--titled");
      }
      if (session.model.isNestedDiagram(child.uid)) {
        card.classList.add("pxd-card--nested");
        card.title = "Double-click to open nested diagram";
        card.addEventListener("dblclick", () => onPersist?.({ openNested: child.uid }));
      }
      renderCardContent(card, child);
      for (const side of ["top", "right", "bottom", "left"]) {
        const handle = document.createElement("div");
        handle.className = `pxd-handle pxd-handle--${side}`;
        handle.dataset.side = side;
        handle.addEventListener("mousedown", (event) => {
          event.stopPropagation();
          if (session.model.activeTool !== "connect") return;
          connectFrom = child.uid;
        });
        handle.addEventListener("mouseup", async (event) => {
          event.stopPropagation();
          if (!connectFrom || connectFrom === child.uid) return;
          session.model.addEdge(connectFrom, child.uid, settings.get("connector-style") || "bezier");
          connectFrom = null;
          await onPersist?.({ persistLayout: true });
          render();
        });
        card.append(handle);
      }
      let drag = null;
      card.addEventListener("mousedown", (event) => {
        if (session.model.activeTool !== "select") return;
        event.stopPropagation();
        if (!event.shiftKey) session.model.selected.clear();
        session.model.selected.add(child.uid);
        drag = { x: event.clientX, y: event.clientY, start: { ...node.pos } };
      });
      card.addEventListener("click", (event) => {
        event.stopPropagation();
        if (session.model.activeTool === "select") {
          if (event.shiftKey) session.model.selected.add(child.uid);
          else session.model.selected = /* @__PURE__ */ new Set([child.uid]);
        }
      });
      const onMove = async (event) => {
        if (!drag) return;
        const zoom = session.model.viewport.zoom || 1;
        node.pos.x = snap(drag.start.x + (event.clientX - drag.x) / zoom);
        node.pos.y = snap(drag.start.y + (event.clientY - drag.y) / zoom);
        render();
      };
      const onUp = async () => {
        if (!drag) return;
        drag = null;
        await onPersist?.({ persistLayout: true });
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      card.addEventListener("mousedown", () => {
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
      cardsLayer.append(card);
    }
  };
  const renderGrid = () => {
    const show = settings.get("show-grid");
    const style = settings.get("grid-style") || "dots";
    grid.className = "pxd-grid";
    grid.classList.toggle("pxd-grid--hidden", !show || style === "none");
    grid.classList.toggle("pxd-grid--dots", style === "dots");
    grid.classList.toggle("pxd-grid--lines", style === "lines");
    grid.style.setProperty("--pxd-grid-size", `${getGridSize()}px`);
  };
  const render = () => {
    syncRenderChildrenDepth();
    applyTransform();
    renderGrid();
    renderSections();
    renderCards();
    renderEdges();
  };
  root.addEventListener("wheel", (event) => {
    if (!settings.get("wheel-zoom")) return;
    event.preventDefault();
    const zoomMin = Number(settings.get("zoom-min")) || 0.15;
    const zoomMax = Number(settings.get("zoom-max")) || 3;
    const oldZoom = session.model.viewport.zoom || 1;
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    const nextZoom = Math.min(zoomMax, Math.max(zoomMin, oldZoom * delta));
    const rect = root.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const worldX = (mouseX - session.model.viewport.x) / oldZoom;
    const worldY = (mouseY - session.model.viewport.y) / oldZoom;
    session.model.viewport.zoom = nextZoom;
    session.model.viewport.x = mouseX - worldX * nextZoom;
    session.model.viewport.y = mouseY - worldY * nextZoom;
    onPersist?.({ persistViewport: true });
    render();
  }, { passive: false });
  const onKeyDown = (event) => {
    if (event.code === "Space" && settings.get("pan-on-space")) spaceDown = true;
  };
  const onKeyUp = (event) => {
    if (event.code === "Space") spaceDown = false;
  };
  const isEmptyCanvasTarget = (event) => !event.target.closest(".pxd-card") && !event.target.closest(".pxd-toolbar") && !event.target.closest(".pxd-library-drawer");
  root.addEventListener("mousedown", (event) => {
    const panOnSpace = settings.get("pan-on-space") && spaceDown;
    const panOnEmpty = event.button === 0 && isEmptyCanvasTarget(event) && session.model.activeTool === "select";
    if (event.button === 1 || panOnSpace || panOnEmpty) {
      panning = true;
      panStart = { x: event.clientX, y: event.clientY, viewport: { ...session.model.viewport } };
      event.preventDefault();
    }
  });
  root.addEventListener("mousemove", (event) => {
    if (!panning || !panStart) return;
    session.model.viewport.x = panStart.viewport.x + (event.clientX - panStart.x);
    session.model.viewport.y = panStart.viewport.y + (event.clientY - panStart.y);
    onPersist?.({ persistViewport: true });
    render();
  });
  root.addEventListener("mouseup", () => {
    panning = false;
    panStart = null;
  });
  root.addEventListener("click", async (event) => {
    if (event.target.closest(".pxd-card") || event.target.closest(".pxd-toolbar")) return;
    if (event.target.closest(".pxd-library-drawer")) return;
    const tool = session.model.activeTool;
    if (tool === "card") {
      await onPersist?.({ addCard: screenToWorld(event.clientX, event.clientY) });
    } else if (tool === "section") {
      await onPersist?.({ addSection: screenToWorld(event.clientX, event.clientY) });
    }
  });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  setActiveTool(session.model.activeTool || "select");
  render();
  return {
    root,
    render,
    setLibraryOpen(open) {
      toolbar.querySelector('[data-tool="library"]')?.classList.toggle("pxd-toolbar__btn--active", open);
    },
    dispose() {
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
    const width = data.width ?? data.data?.width ?? defaults.width ?? 280;
    const height = data.height ?? data.data?.height ?? defaults.height ?? 160;
    nodes.set(contentUid, {
      pos: { x: pos.x ?? 0, y: pos.y ?? 0 },
      size: { width, height },
      color: ""
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
    this.viewport = metadataLayout?.viewport || tree.props?.["rf-diagram"]?.viewport || { x: 0, y: 0, zoom: 1 };
    this.selected = /* @__PURE__ */ new Set();
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
    node.size = { ...size };
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
  applyPull(tree, metadataLayout, defaults = {}) {
    const next = new _DiagramModel({ diagramUid: this.diagramUid, tree, metadataLayout, defaults });
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
    const layout = this.model.layoutSnapshot();
    await this.metadataStore.set(this.diagramUid, layout);
  }
  async persistViewport() {
    await this.adapter.updateViewport(this.model.viewport);
    const layout = this.metadataStore.get(this.diagramUid) || this.model.layoutSnapshot();
    layout.viewport = { ...this.model.viewport };
    await this.metadataStore.set(this.diagramUid, layout);
  }
  async addCard(string, position) {
    const contentUid = await this.adapter.createChild(string);
    this.model.ensureNode(contentUid, { pos: position });
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
var sessions = /* @__PURE__ */ new Map();
function getOrCreateSession(diagramUid, factory) {
  if (sessions.has(diagramUid)) return sessions.get(diagramUid);
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
function mountDiagramView({ nativeElement, session, settings, version, lifecycle, onAction }) {
  const host = nativeElement.parentElement || nativeElement;
  nativeElement.classList.add(NATIVE_HIDDEN_CLASS);
  nativeElement.classList.remove(PENDING_CLASS);
  const defaultHeight = Number(settings.get("default-height")) || 560;
  const nativeRect = nativeElement.getBoundingClientRect();
  const wrapperHeight = Math.max(nativeRect.height || 0, defaultHeight);
  const wrapper = document.createElement("div");
  wrapper.className = "pxd-mount";
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
      if (action.addCard) {
        await session.addCard("", action.addCard);
        canvas.render();
      }
      if (action.addSection) {
        await session.addSection(action.addSection);
        canvas.render();
      }
    }
  });
  wrapper.append(canvas.root);
  host.insertBefore(wrapper, nativeElement.nextSibling);
  const dispose = () => {
    canvas.dispose();
    wrapper.remove();
    nativeElement.classList.remove(NATIVE_HIDDEN_CLASS);
  };
  lifecycle.add(dispose);
  session.addView({ refresh: () => canvas.render(), dispose, canvas });
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
  version: "0.2.0",
  enhancedUids: /* @__PURE__ */ new Set(),
  activeDiagramUid: null,
  guardStyle: null
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
async function enhanceDiagram(uid, nativeElement) {
  if (!enabled() || mobileBlocked()) {
    console.info("[plexus-diagram] Enhance skipped — extension disabled or mobile blocked");
    return;
  }
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
  session.load();
  session.startWatch();
  const layout = session.model.layoutSnapshot();
  await runtime.metadata.set(uid, layout);
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
    }
  });
  if (runtime.settings.get(SETTING_IDS.showLibraryOnOpen)) await openLibrary(mounted.wrapper, mounted.canvas);
  syncGuard();
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
  runtime.version = version || "0.2.0";
  runtime.settings = createSettingsReader(extensionAPI);
  runtime.enhancedUids = readEnhancedUidCache();
  installGuard(runtime.enhancedUids);
  await registerCommands(lifecycle, extensionAPI);
  await registerSlashAndContext(lifecycle, extensionAPI);
  installObservers(lifecycle);
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
