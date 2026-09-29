// Board view: DOM root, layers, render scheduler, culling, LOD (spec 3.2). One rAF loop that
// runs only when dirty; pan/zoom write one transform on .pxd-world plus the grid background.
// Entry used by feature.js: mountBoardView(...) → { root, setFullscreen, fit, dispose, stats }.

import { DEFAULT_SIZES, UNTITLED_BOARD, semanticRef, plainText } from "../model/schema.js";
import { boundsOf, descendantsOf, edgesTouching, worldRects } from "../model/board.js";
import {
  alignRects,
  distributeRects,
  fitViewport,
  gridBackground,
  lodForZoom,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomAt,
} from "../model/geometry.js";
import { createInteractions } from "./interactions.js";
import { createItemRenderer, isTextEntryTarget } from "./cards.js";
import { createEdgeLayer } from "./edges.js";
import { createChrome, LINK_MODES } from "./chrome.js";
import { createPanel, parseDropPayload } from "./panel.js";
import { applyFullscreenChrome, watchRouteExit } from "./fullscreen.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_HEIGHT = 560;
const MIN_HEIGHT = 240;
const RESUME_MS = 120;
const VP_PERSIST_MS = 500;
const CULL_MARGIN = 0.5;

function createTimers() {
  const active = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => { active.delete(entry); fn(); }, ms);
    const entry = () => { clearTimeout(id); active.delete(entry); };
    active.add(entry);
    return entry;
  };
  const frame = (fn) => {
    const raf = globalThis.requestAnimationFrame;
    let entry;
    if (typeof raf === "function") {
      const id = raf((t) => { active.delete(entry); fn(t); });
      entry = () => { globalThis.cancelAnimationFrame?.(id); active.delete(entry); };
    } else {
      const id = setTimeout(() => { active.delete(entry); fn(Date.now()); }, 16);
      entry = () => { clearTimeout(id); active.delete(entry); };
    }
    active.add(entry);
    return entry;
  };
  const idle = (fn) => {
    const ric = globalThis.requestIdleCallback;
    let entry;
    if (typeof ric === "function") {
      const id = ric((d) => { active.delete(entry); fn(d); });
      entry = () => { globalThis.cancelIdleCallback?.(id); active.delete(entry); };
    } else {
      const id = setTimeout(() => { active.delete(entry); fn({ timeRemaining: () => 8, didTimeout: true }); }, 0);
      entry = () => { clearTimeout(id); active.delete(entry); };
    }
    active.add(entry);
    return entry;
  };
  return { later, frame, idle, count: () => active.size, cancelAll: () => { for (const c of [...active]) c(); active.clear(); } };
}

export function isDarkHost(root, doc = globalThis.document) {
  const has = (el, name) => Boolean(el?.classList?.contains?.(name));
  let node = root;
  while (node) {
    if (has(node, "bp3-dark") || has(node, "rm-dark-theme") || has(node, "bt-theme-dark")) return true;
    if (has(node, "roam-body") && has(node, "dark")) return true;
    node = node.parentElement;
  }
  const body = doc?.body;
  const html = doc?.documentElement;
  if (has(html, "bp3-dark") || has(body, "bt-theme-dark") || has(body, "bp3-dark") || has(body, "rm-dark-theme")) return true;
  if (has(body, "roam-body") && has(body, "dark")) return true;
  return false;
}

function graphName(win = globalThis.window) {
  const m = /#\/app\/([^/]+)/.exec(String(win?.location?.hash || ""));
  return m ? decodeURIComponent(m[1]) : "graph";
}

function createLocalViewportStore({ storage, graph, timers }) {
  const key = (uid) => `plexus-diagram:vp:${graph}:${uid}`;
  const pending = new Map();
  return {
    get(uid) {
      try {
        const raw = storage?.getItem?.(key(uid));
        if (!raw) return null;
        const v = JSON.parse(raw);
        return Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.zoom) ? v : null;
      } catch { return null; }
    },
    set(uid, vp) {
      if (!storage?.setItem) return;
      const write = () => { pending.delete(uid); try { storage.setItem(key(uid), JSON.stringify({ x: vp.x, y: vp.y, zoom: vp.zoom })); } catch { /* quota */ } };
      if (pending.has(uid)) { pending.get(uid).vp = vp; return; }
      const entry = { vp, cancel: timers.later(() => write(), VP_PERSIST_MS) };
      pending.set(uid, entry);
    },
    flush() { for (const [uid, e] of pending) { e.cancel(); try { storage?.setItem?.(key(uid), JSON.stringify(e.vp)); } catch { /* quota */ } } pending.clear(); },
  };
}

export function mountBoardView({
  host,
  session,
  mountEl,
  nativeEl = null,
  settings,
  onRequestFullscreen,
  fullscreen = false,
  version = "",
  crumbs = null,
  onOpenBoard = null,
  onCrumb = null,
  routeUid = session.uid,
  autofocus = false,
} = {}) {
  const doc = globalThis.document;
  const win = globalThis.window;
  const setting = (k, d) => {
    const v = typeof settings?.get === "function" ? settings.get(k) : settings?.[k];
    return v === undefined || v === null ? d : v;
  };
  const timers = createTimers();
  const listeners = [];
  const observers = [];
  const subs = [];
  const listen = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    const off = () => el.removeEventListener(type, fn, opts);
    listeners.push(off);
    return off;
  };
  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    node.className = cls;
    parent?.append(node);
    return node;
  };
  const svg = (cls, parent) => {
    const node = doc.createElementNS(SVG_NS, "svg");
    node.setAttribute("class", cls);
    if (node.classList && !node.classList.contains(cls)) node.className = cls;
    parent?.append(node);
    return node;
  };

  const boardUid = session.uid;
  const graph = host?.graph || graphName(win);
  const storage = globalThis.localStorage;
  const vpStore = host?.viewports || host?.viewportStore || createLocalViewportStore({ storage, graph, timers });
  // The inline height belongs to the mount (the route board), not to whichever nested board it is showing.
  const heightKey = `plexus-diagram:h:${graph}:${routeUid}`;

  // ------------------------------------------------------------ DOM
  const root = el("div", "pxd-root", mountEl);
  root.tabIndex = 0;
  root.setAttribute("tabindex", "0");
  root.dataset.tool = "select";
  root.setAttribute("data-tool", "select");
  root.dataset.board = boardUid;
  const viewport = el("div", "pxd-viewport", root);
  const grid = el("div", "pxd-grid", viewport);
  const world = el("div", "pxd-world", viewport);
  const sectionsLayer = el("div", "pxd-sections", world);
  const edgesSvg = svg("pxd-edges", world);
  const labelsLayer = el("div", "pxd-labels", world);
  const itemsLayer = el("div", "pxd-items", world);
  const overlaySvg = svg("pxd-overlay", world);
  const resizeGrip = el("div", "pxd-resize-grip pxd-chrome", root);
  resizeGrip.title = "Drag to resize the board";
  if (isDarkHost(mountEl, doc)) root.classList.add("pxd-root--dark");

  // ------------------------------------------------------------ state
  let vp = vpStore.get(boardUid);
  let size = { width: 0, height: 0 };
  let rootRect = { left: 0, top: 0, width: 0, height: 0 };
  let disposed = false;
  let released = false;
  let gesturing = false;
  let isFullscreen = false;
  let pointerInside = Boolean(mountEl?.matches?.(":hover"));
  let suppressClick = false;
  let swallowMouseUp = false;
  let linkMode = setting("graph-links", "all");
  let selection = { items: [], edge: null, link: null };
  let liveRects = null; // Map override during move/resize preview
  let resumeTimer = null;
  let settleTimer = null;
  let searchMatches = [];
  let searchIndex = -1;
  let frameHandle = null;
  let fsDispose = () => {};
  let routeOff = () => {};
  const dirty = { viewport: false, items: new Set(), edges: new Set(), structural: false, all: true, selection: false, links: false, ctx: false };

  const board = () => session.board;
  const rects = () => session.rects || worldRects(board());
  const effectiveRects = () => {
    if (!liveRects) return rects();
    const merged = new Map(rects());
    for (const [k, v] of liveRects) merged.set(k, v);
    return merged;
  };

  const measure = () => {
    const r = root.getBoundingClientRect();
    rootRect = { left: r.left || 0, top: r.top || 0, width: r.width || 0, height: r.height || 0 };
    size = { width: rootRect.width, height: rootRect.height };
  };

  // ------------------------------------------------------------ layers
  const itemsR = createItemRenderer({
    doc,
    host,
    session,
    itemsLayer,
    sectionsLayer,
    timers,
    onEditChange: (uid) => { root.classList.toggle("pxd-root--editing", Boolean(uid)); },
    onOpenBoard: (uid) => { void openBoard(uid); },
    onRenameBoard: (uid, title) => session.renameBoard?.(uid, title),
  });
  const edgesR = createEdgeLayer({
    doc,
    svg: edgesSvg,
    labelsLayer,
    overlaySvg,
    onLabelCommit: (uid, label) => session.updateEdge?.(uid, { label }),
  });

  const schedule = () => {
    if (disposed || frameHandle) return;
    frameHandle = timers.frame(() => { frameHandle = null; renderFrame(); });
  };
  const markViewport = () => { dirty.viewport = true; schedule(); };
  const markAll = () => { dirty.all = true; dirty.structural = true; schedule(); };

  // ------------------------------------------------------------ viewport
  const setViewport = (next) => {
    if (!next) return;
    vp = { x: next.x, y: next.y, zoom: next.zoom };
    markViewport();
    // Buttons, Fit, search and edit-zoom change the viewport outside a gesture: re-evaluate LOD + content.
    if (!gesturing) settle();
  };
  const fitTo = (bounds, opts = {}) => {
    if (!size.width || !size.height) measure();
    setViewport(fitViewport(bounds, size, { padding: 64, maxZoom: opts.maxZoom ?? 1.5 }));
  };
  const fitAll = () => fitTo(boundsOf([...rects().values()]));
  const fitSelection = (uids) => {
    const r = rects();
    const b = boundsOf(uids.map((u) => r.get(u)).filter(Boolean));
    if (b) fitTo(b, { maxZoom: 1 });
  };
  const centerOn = (worldPoint) => {
    setViewport({ x: size.width / 2 - worldPoint.x * vp.zoom, y: size.height / 2 - worldPoint.y * vp.zoom, zoom: vp.zoom });
  };

  const applyLod = () => {
    const z = vp.zoom;
    const lod = lodForZoom(z);
    root.classList.toggle("pxd-lod-map", lod === "map");
    root.style.setProperty("--pxd-map-font", `${Math.min(42, Math.max(14, 13 / z))}px`);
    root.style.setProperty("--pxd-ui", String(Math.min(4, Math.max(1, 1 / z))));
    itemsR.setLod(lod, z);
  };
  const scheduleContent = () => {
    if (disposed || gesturing || !board()) return;
    itemsR.scheduleContent({ visibleRect: visibleWorldRect(vp, size, CULL_MARGIN), zoom: vp.zoom });
  };
  const settle = () => {
    settleTimer?.();
    settleTimer = timers.later(() => {
      settleTimer = null;
      if (gesturing) return;
      applyLod();
      scheduleContent();
      vpStore.set(boardUid, vp);
      dirty.edges = new Set(board()?.edges.keys() || []); // arrow sizes depend on zoom
      dirty.links = true;
      schedule();
    }, RESUME_MS);
  };

  // ------------------------------------------------------------ selection + context bar
  const selectedItems = () => selection.items.map((u) => board()?.items.get(u)).filter(Boolean);
  const toScreenRect = (r) => {
    const p = worldToScreen(vp, { x: r.x, y: r.y });
    return { x: p.x, y: p.y, w: r.w * vp.zoom, h: r.h * vp.zoom };
  };
  const pathScreenRect = (geo, extra) => {
    const pts = [geo.start, geo.end, geo.mid].filter(Boolean).map((p) => worldToScreen(vp, p));
    for (const r of extra) pts.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h });
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  const ctxAnchor = () => {
    const b = board();
    if (!b) return null;
    if (selection.edge) {
      const edge = b.edges.get(selection.edge);
      const geo = edgesR.geometryOf(selection.edge);
      if (!edge || !geo) return null;
      // Anchor on the whole connection (path + label) so the bar clears the line, not just its midpoint.
      const lr = edge.label ? edgesR.labelRect(selection.edge) : null;
      const extra = lr && lr.width ? [{ x: lr.left - rootRect.left, y: lr.top - rootRect.top, w: lr.width, h: lr.height }] : [];
      return { kind: "edge", rect: pathScreenRect(geo, extra) };
    }
    if (selection.link) {
      const geo = edgesR.linkGeometryOf(selection.link);
      if (!geo) return null;
      return { kind: "edge", rect: pathScreenRect(geo, []) };
    }
    const r = rects();
    const bounds = boundsOf(selection.items.map((u) => r.get(u)).filter(Boolean));
    return bounds ? { kind: "items", rect: toScreenRect(bounds) } : null;
  };
  const showCtx = () => {
    const b = board();
    if (!b) return chrome.ctx.hide();
    if (selection.edge) {
      const edge = b.edges.get(selection.edge);
      return edge ? chrome.ctx.show("edge", edge, ctxAnchor) : chrome.ctx.hide();
    }
    if (selection.link) {
      const link = (session.links || []).find((l) => l.key === selection.link);
      return link ? chrome.ctx.show("link", link, ctxAnchor) : chrome.ctx.hide();
    }
    const items = selectedItems();
    if (!items.length) return chrome.ctx.hide();
    if (items.length > 1) return chrome.ctx.show("cards", null, ctxAnchor);
    const it = items[0];
    return chrome.ctx.show(it.type === "section" ? "section" : it.type === "text" ? "text" : it.kind === "board" ? "board" : "card", it, ctxAnchor);
  };

  // ------------------------------------------------------------ session mutations used by chrome
  const targetUids = () => (selection.edge ? [selection.edge] : selection.items);
  const singleItem = () => (selection.items.length === 1 ? board()?.items.get(selection.items[0]) : null);
  const openItemInSidebar = (item) => {
    if (!item) return;
    if (item.target.kind === "page") {
      const uid = host?.pageUid?.(item.target.title);
      if (uid) host?.openInSidebar?.(uid, "outline");
    } else {
      host?.openInSidebar?.(item.target.uid || item.uid, "block");
    }
  };
  const stackAt = (strings, x, y, h) => strings.map((string, i) => ({ string, x, y: y + i * (h + 24) }));
  const addStringsBeside = (strings) => {
    const b = board();
    if (!b || !strings.length) return;
    const r = rects();
    const sel = singleItem();
    const w = Number(setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    let x; let y;
    if (sel && r.get(sel.uid)) { const sr = r.get(sel.uid); x = sr.x + sr.w + 40; y = sr.y; }
    else { const c = screenToWorld(vp, { x: size.width / 2, y: size.height / 2 }); x = c.x - w / 2; y = c.y - h / 2; }
    void session.addRefCards?.(stackAt(strings, x, y, h));
  };
  const isOnBoard = (string) => {
    const b = board();
    if (!b) return false;
    const s = String(string || "").trim();
    for (const item of b.items.values()) {
      if (item.string.trim() === s || semanticRef(item) === s) return true;
    }
    return false;
  };

  // ------------------------------------------------------------ nested boards
  // `crumbs` entries are shared with the feature's record, so a rename shows up in both.
  const crumbList = Array.isArray(crumbs) ? crumbs : [];
  const openBoard = async (uid) => {
    const item = board()?.items.get(uid);
    if (!item || item.kind !== "board") return;
    if (itemsR.isEditing()) await exitEdit();
    if (disposed) return;
    if (onOpenBoard) onOpenBoard(uid);
    else host?.openBlock?.(uid);
  };
  const goCrumb = async (index) => {
    if (itemsR.isEditing()) await exitEdit();
    if (disposed) return;
    onCrumb?.(index);
  };
  const popBoard = () => {
    if (crumbList.length > 1 && onCrumb) { void goCrumb(crumbList.length - 2); return true; }
    return false;
  };

  // ------------------------------------------------------------ chrome + panel
  const chrome = createChrome({
    doc,
    root,
    version,
    settings,
    timers,
    crumbs: crumbList,
    on: {
      openBoard: () => { const it = singleItem(); if (it) void openBoard(it.uid); },
      renameBoard: () => { const it = singleItem(); if (it) itemsR.renameBoard(it.uid); },
      crumb: (index) => { void goCrumb(index); },
      wrapBoard: () => {
        if (!selection.items.length) return;
        Promise.resolve(session.wrapInBoard?.(selection.items)).then((uid) => { if (uid) ctl.select([uid]); }).catch(() => {});
      },
      setTool: (tool, lock) => ctl.setTool(tool, lock),
      togglePanel: () => panel.toggle(),
      cycleLinks: () => cycleLinks(),
      zoomIn: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1.2)),
      zoomOut: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / 1.2)),
      zoomReset: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / vp.zoom)),
      fit: () => fitAll(),
      toggleMinimap: () => chrome.minimap.setVisible(!chrome.minimap.isVisible()),
      toggleFullscreen: () => requestFullscreen(!isFullscreen),
      setColor: (c) => { const uids = targetUids(); if (uids.length) void session.setColor?.(uids, c); },
      edit: () => { const it = singleItem(); if (it) void enterEdit(it.uid); },
      openSidebar: () => openItemInSidebar(singleItem()),
      collapse: () => { const it = singleItem(); if (it) void session.setCollapsed?.(it.uid, !it.collapsed); },
      related: () => panel.open("related"),
      delete: () => ctl.deleteSelection(false),
      rename: () => { const it = singleItem(); if (it) itemsR.renameSection(it.uid); },
      selectContents: () => { const it = singleItem(); if (it?.members?.length) ctl.select(it.members); },
      setFontSize: (n) => { const it = singleItem(); if (it) void session.setFontSize?.(it.uid, n); },
      edgeDir: (dir) => { if (selection.edge) void session.updateEdge?.(selection.edge, { dir }); },
      flip: () => { if (selection.edge) void session.flipEdge?.(selection.edge); },
      route: (route) => { if (selection.edge) void session.updateEdge?.(selection.edge, { route }); },
      dash: (dash) => { if (selection.edge) void session.updateEdge?.(selection.edge, { dash }); },
      weight: (weight) => { if (selection.edge) void session.updateEdge?.(selection.edge, { weight }); },
      label: () => { if (selection.edge) edgesR.editLabel(selection.edge); },
      notes: () => { if (selection.edge) host?.openInSidebar?.(selection.edge, "block"); },
      writeToGraph: async () => {
        if (!selection.edge) return;
        const r = await session.writeToGraph?.(selection.edge);
        chrome.toast.show({ message: r?.ok ? "Written to the graph" : `Not written: ${r?.reason || "unknown"}` });
      },
      pinLink: () => {
        const link = (session.links || []).find((l) => l.key === selection.link);
        if (link) Promise.resolve(session.pinLink?.(link)).then((uid) => { if (uid) ctl.selectEdge(uid); }).catch(() => {});
      },
      openSource: (uid) => host?.openInSidebar?.(uid, "block"),
      align: (mode) => {
        const r = rects();
        const list = selection.items.map((uid) => ({ uid, ...r.get(uid) })).filter((x) => Number.isFinite(x.x));
        const moved = alignRects(list, mode).map((m) => ({ ...m, w: r.get(m.uid).w, h: r.get(m.uid).h }));
        void session.commitRects?.(moved);
      },
      distribute: (axis) => {
        const r = rects();
        const list = selection.items.map((uid) => ({ uid, ...r.get(uid) })).filter((x) => Number.isFinite(x.x));
        const moved = distributeRects(list, axis).map((m) => ({ ...m, w: r.get(m.uid).w, h: r.get(m.uid).h }));
        void session.commitRects?.(moved);
      },
      wrap: () => { if (selection.items.length) void session.wrapInSection?.(selection.items); },
      navigate: (worldPoint) => centerOn(worldPoint),
      searchFilter: (text) => searchFilter(text),
      searchNext: (dir) => searchNext(dir),
      searchClosed: () => { try { root.focus({ preventScroll: true }); } catch { /* stub */ } },
    },
  });
  const panel = createPanel({
    doc,
    root,
    host,
    timers,
    on: {
      addBeside: (string) => addStringsBeside([string]),
      addMany: (strings) => addStringsBeside(strings),
      isOnBoard,
      opened: (open) => chrome.toolbar.setPanel(open),
    },
  });
  chrome.minimap.setVisible(setting("show-minimap", true) !== false);
  chrome.toolbar.setLinkMode(linkMode);
  grid.className = `pxd-grid pxd-grid--${setting("grid", "dots")}`;

  const cycleLinks = () => {
    linkMode = LINK_MODES[(LINK_MODES.indexOf(linkMode) + 1) % LINK_MODES.length];
    chrome.toolbar.setLinkMode(linkMode);
    session.setLinkMode?.(linkMode);
  };

  // ------------------------------------------------------------ board search
  const searchFilter = (text) => {
    const b = board();
    const q = String(text || "").trim().toLowerCase();
    searchMatches = [];
    searchIndex = -1;
    root.classList.toggle("pxd-root--searching", Boolean(q));
    if (!b) return 0;
    for (const item of b.items.values()) {
      const hay = `${item.title}\n${plainText(item.string, 2000)}`.toLowerCase();
      const hit = q && hay.includes(q);
      if (hit) searchMatches.push(item.uid);
      itemsR.shellOf(item.uid)?.classList.toggle("pxd-item--dim", Boolean(q) && !hit);
    }
    return searchMatches.length;
  };
  const searchNext = (dir = 1) => {
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
    const uid = searchMatches[searchIndex];
    ctl.select([uid]);
    fitSelection([uid]);
  };

  // ------------------------------------------------------------ editing
  const enterEdit = async (uid) => {
    ctl.select([uid]);
    // Editing at map zoom is unreadable: bring the card to a working zoom first.
    if (lodForZoom(vp.zoom) === "map") { fitSelection([uid]); applyLod(); }
    const ok = await itemsR.enterEdit(uid);
    if (ok) chrome.ctx.hide();
    return ok;
  };
  // Cards/text created by a gesture and left empty are removed on edit exit (no junk cards).
  const freshItems = new Set();
  const exitEdit = async () => {
    const uid = itemsR.editingUid?.();
    await itemsR.exitEdit();
    if (uid && freshItems.delete(uid)) {
      const item = session.board?.items?.get(uid);
      const text = host?.blockString?.(uid);
      if (item && !String(text ?? item.string ?? "").trim() && !(item.content || []).length) {
        await session.deleteItems?.([uid]);
      }
    }
    if (!disposed) { dirty.selection = true; schedule(); }
  };

  // ------------------------------------------------------------ fullscreen
  const applyFullscreen = (on) => {
    isFullscreen = Boolean(on);
    fsDispose();
    fsDispose = applyFullscreenChrome(mountEl, isFullscreen, doc);
    root.classList.toggle("pxd-root--fullscreen", isFullscreen);
    chrome.toolbar.setFullscreen(isFullscreen);
    resizeGrip.style.display = isFullscreen ? "none" : "";
    if (isFullscreen) { root.style.height = ""; }
    else applyInlineHeight();
    timers.frame(() => { measure(); markViewport(); });
  };
  const requestFullscreen = (on) => {
    applyFullscreen(on);
    onRequestFullscreen?.(Boolean(on));
  };

  // ------------------------------------------------------------ inline height
  const readHeight = () => {
    try { const v = Number(storage?.getItem?.(heightKey)); return Number.isFinite(v) && v >= MIN_HEIGHT ? v : Number(setting("default-height", DEFAULT_HEIGHT)) || DEFAULT_HEIGHT; } catch { return DEFAULT_HEIGHT; }
  };
  const applyInlineHeight = (h = readHeight()) => {
    root.style.height = `${h}px`;
    if (mountEl?.style) { mountEl.style.height = `${h}px`; mountEl.style.minHeight = `${h}px`; }
  };
  let heightDrag = null;
  const onHeightMove = (event) => {
    if (!heightDrag) return;
    const h = Math.max(MIN_HEIGHT, Math.round(heightDrag.h0 + (event.clientY - heightDrag.y0)));
    heightDrag.h = h;
    applyInlineHeight(h);
  };
  const onHeightUp = () => {
    if (!heightDrag) return;
    try { storage?.setItem?.(heightKey, String(heightDrag.h)); } catch { /* quota */ }
    heightDrag = null;
    doc.removeEventListener("pointermove", onHeightMove, true);
    doc.removeEventListener("pointerup", onHeightUp, true);
    measure();
    markViewport();
  };
  listen(resizeGrip, "pointerdown", (event) => {
    event.stopPropagation();
    event.preventDefault();
    heightDrag = { y0: event.clientY, h0: rootRect.height || readHeight(), h: rootRect.height || readHeight() };
    doc.addEventListener("pointermove", onHeightMove, true);
    doc.addEventListener("pointerup", onHeightUp, true);
  });

  // ------------------------------------------------------------ controller
  const actions = {
    board,
    rects,
    viewport: () => vp,
    size: () => size,
    setViewport,
    fitAll,
    fitSelection,
    onSelection: (sel) => {
      selection = { items: sel.items || [], edge: sel.edge || null, link: sel.link || null };
      dirty.selection = true;
      panel.setSelection(singleItem());
      schedule();
    },
    onTool: (tool, locked) => {
      root.dataset.tool = tool;
      root.setAttribute("data-tool", tool);
      chrome.toolbar.setTool(tool, locked);
    },
    onHover: (uid) => itemsR.setHover(uid),
    setGesturing: (on, info) => {
      gesturing = Boolean(on);
      root.classList.toggle("pxd-root--gesturing", gesturing);
      world.style.willChange = gesturing ? "transform" : "";
      if (gesturing) {
        resumeTimer?.();
        resumeTimer = null;
        itemsR.setPaused(true);
        chrome.ctx.hide();
      } else {
        // Only a gesture that actually moved swallows its click; a plain click must reach links and chrome.
        if (info?.moved) {
          suppressClick = true;
          swallowMouseUp = true;
          timers.later(() => { suppressClick = false; swallowMouseUp = false; }, 0);
        }
        liveRects = null;
        resumeTimer = timers.later(() => {
          resumeTimer = null;
          itemsR.setPaused(false);
          applyLod();
          scheduleContent();
          vpStore.set(boardUid, vp);
          dirty.selection = true;
          schedule();
        }, RESUME_MS);
      }
    },
    showMarquee: (rect, kind) => edgesR.setMarquee(rect, kind),
    showGuides: (guides) => edgesR.setGuides(guides),
    previewMove: (uids, dx, dy) => {
      const b = board();
      if (!b) return;
      liveRects = itemsR.previewMove(uids, dx, dy, b, rects());
      const set = new Set(uids);
      for (const u of uids) for (const d of descendantsOf(b, u)) set.add(d);
      const linkKeys = new Set((session.links || []).filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: effectiveRects(), zoom: vp.zoom, linkKeys, links: session.links || [] });
    },
    previewRects: (list) => {
      const b = board();
      if (!b) return;
      liveRects = itemsR.previewRects(list);
      const set = new Set(list.map((r) => r.uid));
      const linkKeys = new Set((session.links || []).filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: effectiveRects(), zoom: vp.zoom, linkKeys, links: session.links || [] });
    },
    showTempWire: (spec) => edgesR.setTempWire(spec, rects(), vp.zoom),
    commitMove: (uids, dx, dy) => session.commitMove?.(uids, dx, dy),
    commitRects: (list) => session.commitRects?.(list),
    createCard: (p) => Promise.resolve(session.createCard?.({ x: p.x, y: p.y })).then((uid) => { if (uid) freshItems.add(uid); return uid; }),
    createText: (p) => Promise.resolve(session.createText?.({ x: p.x, y: p.y })).then((uid) => { if (uid) freshItems.add(uid); return uid; }),
    createSection: (p) => session.createSection?.({ rect: p.rect }),
    createBoard: (p) => session.createBoard?.({ rect: p.rect }),
    moveIntoBoard: async (uids, boardUid, dx = 0, dy = 0) => {
      const res = await session.moveIntoBoard?.(uids, boardUid);
      if (!res) { void session.commitMove?.(uids, dx, dy); return; }
      chrome.toast.show({ message: `Moved into ${res.title}`, action: { label: "Undo", run: () => res.undo() } });
    },
    openBoard: (uid) => openBoard(uid),
    popBoard,
    wrapInSection: (uids) => session.wrapInSection?.(uids),
    deleteItems: (uids, opts) => session.deleteItems?.(uids, opts),
    deleteEdges: (uids) => session.deleteEdges?.(uids),
    addEdge: (spec) => session.addEdge?.(spec),
    undo: () => session.undo?.(),
    redo: () => session.redo?.(),
    enterEdit: (uid) => enterEdit(uid),
    exitEdit: () => exitEdit(),
    isEditing: () => itemsR.isEditing(),
    editingUid: () => itemsR.editingUid(),
    autocompleteOpen: () => itemsR.autocompleteOpen(),
    renameSection: (uid) => itemsR.renameSection(uid),
    editLabel: (uid) => edgesR.editLabel(uid),
    openBlock: (uid) => host?.openBlock?.(uid),
    toast: (t) => chrome.toast.show(t),
    openSearch: () => chrome.search.open(),
    cycleLinks,
    isFullscreen: () => isFullscreen,
    setFullscreen: (on) => requestFullscreen(on),
    setSpace: (on) => root.classList.toggle("pxd-root--space", Boolean(on)),
  };
  const ctl = createInteractions({ actions, settings });
  ctl.setTool("select");

  // ------------------------------------------------------------ DOM events → controller
  const targetOf = (t) => {
    if (!t || typeof t.closest !== "function") return { kind: "empty" };
    if (t.closest(".pxd-chrome")) return { kind: "chrome" };
    const port = t.closest(".pxd-port");
    if (port) {
      const owner = port.closest(".pxd-item, .pxd-section");
      return { kind: "port", uid: owner?.dataset?.uid || owner?.getAttribute?.("data-uid"), side: port.dataset?.side || port.getAttribute?.("data-side") };
    }
    const grip = t.closest(".pxd-grip");
    if (grip) {
      const owner = grip.closest(".pxd-item, .pxd-section");
      return { kind: "grip", uid: owner?.dataset?.uid || owner?.getAttribute?.("data-uid"), part: grip.dataset?.part || grip.getAttribute?.("data-part") };
    }
    const label = t.closest(".pxd-label");
    if (label) {
      const key = label.dataset?.key || label.getAttribute?.("data-key");
      if (key) return { kind: "link", key };
      return { kind: "label", uid: label.dataset?.uid || label.getAttribute?.("data-uid") };
    }
    const edge = t.closest(".pxd-edge");
    if (edge) return { kind: "edge", uid: edge.dataset?.uid || edge.getAttribute?.("data-uid") };
    const link = t.closest(".pxd-link");
    if (link) return { kind: "link", key: link.dataset?.key || link.getAttribute?.("data-key") };
    const title = t.closest(".pxd-section__title");
    if (title) return { kind: "section-title", uid: title.closest(".pxd-section")?.dataset?.uid || title.closest(".pxd-section")?.getAttribute?.("data-uid") };
    const border = t.closest(".pxd-section__edge");
    if (border) return { kind: "section-border", uid: border.closest(".pxd-section")?.dataset?.uid || border.closest(".pxd-section")?.getAttribute?.("data-uid") };
    const item = t.closest(".pxd-item");
    if (item) return { kind: "item", uid: item.dataset?.uid || item.getAttribute?.("data-uid"), part: t.closest(".pxd-item__header") ? "header" : "body" };
    return { kind: "empty" };
  };
  const normalize = (event, type = event.type) => {
    const screen = { x: (event.clientX || 0) - rootRect.left, y: (event.clientY || 0) - rootRect.top };
    return {
      type,
      screen,
      world: screenToWorld(vp, screen),
      target: targetOf(event.target),
      button: event.button ?? 0,
      buttons: event.buttons ?? 0,
      shift: Boolean(event.shiftKey),
      alt: Boolean(event.altKey),
      meta: Boolean(event.metaKey),
      ctrl: Boolean(event.ctrlKey),
      key: event.key,
      code: event.code,
      deltaX: event.deltaX || 0,
      deltaY: event.deltaY || 0,
      pointerId: event.pointerId,
    };
  };

  let captured = false;
  const onDocMove = (event) => { if (ctl.isGesturing()) ctl.handle(normalize(event, "pointermove")); };
  const onDocUp = (event) => {
    if (!ctl.isGesturing()) return releaseCapture();
    ctl.handle(normalize(event, "pointerup"));
    releaseCapture();
  };
  const onDocCancel = () => { ctl.handle({ type: "pointercancel" }); releaseCapture(); };
  const releaseCapture = () => {
    if (!captured) return;
    captured = false;
    doc.removeEventListener("pointermove", onDocMove, true);
    doc.removeEventListener("pointerup", onDocUp, true);
    doc.removeEventListener("pointercancel", onDocCancel, true);
  };
  listen(root, "pointerdown", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    measure();
    const ev = normalize(event, "pointerdown");
    const editingUid = itemsR.editingUid();
    // Keep Roam's block handlers out of the overlay. Cancelling pointerdown also suppresses the compat
    // mousedown that Roam's page refs navigate on, so a drag that starts on a [[link]] moves the card;
    // a plain click on a link is routed by the click handler below (openRefFromClick).
    if (!(editingUid && ev.target.kind === "item" && ev.target.uid === editingUid && ev.target.part !== "header")) {
      event.stopPropagation();
      if (ev.target.kind !== "label" && ev.target.kind !== "section-title") event.preventDefault();
    }
    ctl.handle(ev);
    if (ctl.isGesturing() && !captured) {
      captured = true;
      doc.addEventListener("pointermove", onDocMove, true);
      doc.addEventListener("pointerup", onDocUp, true);
      doc.addEventListener("pointercancel", onDocCancel, true);
      // No setPointerCapture: capture retargets click/dblclick to the root, which made double-click on a card
      // create a phantom card and swallowed [[link]] clicks. Document-level listeners already follow the drag.
    }
    try { if (!editingUid && ev.target.kind !== "label") root.focus({ preventScroll: true }); } catch { /* stub */ }
  });
  // The mouseup that ends a drag must not reach a [[link]] the pointer happens to be over (it moved with the card).
  listen(doc, "mouseup", (event) => {
    if (!swallowMouseUp) return;
    swallowMouseUp = false;
    event.stopImmediatePropagation();
    event.preventDefault();
  }, true);
  // mousedown/mouseup: inner React roots (renderString links) see them first; Roam's block handlers do not.
  for (const type of ["mousedown", "mouseup"]) {
    listen(root, type, (event) => {
      if (event.target?.closest?.(".pxd-chrome")) return;
      const editing = itemsR.editingUid();
      if (editing && event.target?.closest?.(".pxd-item--editing")) return;
      event.stopPropagation();
    });
  }
  listen(root, "dragstart", (event) => {
    if (event.target?.closest?.(".pxd-chrome, .pxd-item--editing")) return;
    event.preventDefault();
  });
  // Capture phase only cancels the click that ends a drag. Shielding Roam's block-edit handlers happens in
  // the bubble phase, after renderString's own React roots inside cards have handled [[link]] clicks.
  listen(root, "click", (event) => {
    if (suppressClick) { event.stopPropagation(); event.preventDefault(); return; }
    // Roam's page-ref handlers stop click propagation inside the card's React root, so links are routed here,
    // in the capture phase, before the target sees the click.
    if (openRefFromClick(event)) { event.stopPropagation(); event.preventDefault(); }
  }, true);
  // Static card content: [[page]] / #tag / attr refs carry data-link-uid, ((block)) refs .rm-block-ref[data-uid].
  // Click opens them (Shift: right sidebar), matching Roam; editing cards keep Roam's own handling.
  const openRefFromClick = (event) => {
    const t = event.target;
    if (!t?.closest || !t.closest(".pxd-item") || t.closest(".pxd-item--editing")) return false;
    const api = host?.api;
    const page = t.closest("[data-link-uid]");
    const block = t.closest(".rm-block-ref[data-uid]");
    const uid = page?.getAttribute("data-link-uid") || block?.getAttribute("data-uid");
    if (!uid || !api?.ui) return false;
    if (event.shiftKey) api.ui.rightSidebar?.addWindow?.({ window: { type: page ? "outline" : "block", "block-uid": uid } });
    else if (page) api.ui.mainWindow?.openPage?.({ page: { uid } });
    else api.ui.mainWindow?.openBlock?.({ block: { uid } });
    return true;
  };
  listen(root, "click", (event) => {
    if (!event.target?.closest?.(".pxd-chrome")) event.stopPropagation();
  });
  listen(root, "dblclick", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    event.stopPropagation();
    event.preventDefault();
    ctl.handle(normalize(event, "dblclick"));
  });
  listen(root, "wheel", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    const handled = ctl.handle(normalize(event, "wheel"));
    if (handled) { event.preventDefault(); event.stopPropagation(); settle(); }
  }, { passive: false });
  listen(root, "contextmenu", (event) => { if (!event.target?.closest?.(".pxd-chrome")) event.stopPropagation(); });
  listen(root, "pointerenter", () => { pointerInside = true; });
  listen(root, "pointerleave", () => { pointerInside = false; });
  const acceptsDrop = (event) => !event.target?.closest?.(".pxd-item__editor");
  const dropEffectFor = (effectAllowed) => {
    const a = String(effectAllowed || "uninitialized");
    if (a === "all" || a === "uninitialized" || /copy/i.test(a)) return "copy";
    if (/move/i.test(a)) return "move";
    if (/link/i.test(a)) return "link";
    return "copy";
  };
  const onDragAccept = (event) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer.effectAllowed);
  };
  listen(root, "dragenter", onDragAccept);
  listen(root, "dragover", onDragAccept);
  listen(root, "drop", (event) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    measure();
    const resolveUid = (u) => (host?.cardStringForUid ? host.cardStringForUid(u) : `((${u}))`);
    const list = parseDropPayload(event.dataTransfer, { resolveUid });
    if (!list.length) return;
    const p = screenToWorld(vp, { x: event.clientX - rootRect.left, y: event.clientY - rootRect.top });
    const w = Number(setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    const made = session.addRefCards?.(stackAt(list.map((x) => x.string), p.x - w / 2, p.y - h / 2, h));
    Promise.resolve(made).then((uids) => { if (Array.isArray(uids) && uids.length) ctl.select(uids); }).catch(() => {});
  });

  const ownsKeyboard = () => pointerInside || isFullscreen || root.contains?.(doc.activeElement);
  const onKeyDown = (event) => {
    const inputFocused = isTextEntryTarget(event.target) || isTextEntryTarget(doc.activeElement);
    if (inputFocused) {
      const inside = root.contains?.(event.target) || root.contains?.(doc.activeElement);
      if (!inside && !itemsR.isEditing()) return;
    } else if (!ownsKeyboard()) {
      return;
    }
    // Roam dropped focus to <body> mid-edit: put it back on the editor instead of running a board shortcut.
    if (!inputFocused && itemsR.isEditing() && event.key !== "Escape") { itemsR.recoverFocus(); return; }
    const handled = ctl.handle({ type: "keydown", key: event.key, code: event.code, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, ctrl: event.ctrlKey, inputFocused });
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  };
  const onKeyUp = (event) => { ctl.handle({ type: "keyup", key: event.key, code: event.code }); };
  // Capture phase: Roam's document-level shortcuts (Delete/Backspace on block selection, etc.) stop propagation
  // before a bubble listener on window. onKeyDown returns early for any text input outside the board.
  listen(win, "keydown", onKeyDown, true);
  listen(win, "keyup", onKeyUp, true);

  // ------------------------------------------------------------ session events
  subs.push(session.on("change", ({ dirty: d, structural } = {}) => {
    if (disposed) return;
    const b = board();
    const current = crumbList[crumbList.length - 1];
    if (current && b) {
      const title = b.title || UNTITLED_BOARD;
      if (current.title !== title) { current.title = title; chrome.toolbar.setCrumbs(crumbList); }
    }
    if (structural || !d) dirty.structural = true;
    if (d && b) {
      for (const uid of d) {
        if (b.edges.has(uid)) dirty.edges.add(uid); else dirty.items.add(uid);
      }
    } else dirty.all = true;
    ctl.reconcile();
    dirty.selection = true;
    schedule();
  }));
  subs.push(session.on("links", () => { dirty.links = true; schedule(); }));
  subs.push(session.on("busy", (busy) => chrome.toolbar.setSync(Boolean(busy))));
  subs.push(session.on("toast", (t) => chrome.toast.show(t)));

  // ------------------------------------------------------------ observers
  const RO = globalThis.ResizeObserver;
  if (typeof RO === "function") {
    try {
      const ro = new RO(() => { measure(); markViewport(); chrome.ctx.reposition(); });
      ro.observe(root);
      observers.push(ro);
    } catch { /* stub */ }
  }
  routeOff = watchRouteExit({ boardUid: routeUid, onExit: () => { if (isFullscreen) requestFullscreen(false); }, win });

  // ------------------------------------------------------------ render frame
  const renderFrame = () => {
    if (disposed) return;
    const b = board();
    if (!b) return;
    const r = rects();
    let itemsChanged = false;
    if (dirty.all || dirty.structural || dirty.items.size) {
      itemsR.sync({ board: b, rects: r, dirty: dirty.all ? null : dirty.items, structural: dirty.structural });
      itemsChanged = true;
    }
    if (dirty.all || dirty.structural || dirty.links || dirty.edges.size) {
      const partial = !dirty.all && !dirty.structural && !dirty.links && !dirty.items.size;
      if (partial) {
        edgesR.update({ board: b, edgeUids: dirty.edges, rects: r, zoom: vp.zoom });
      } else {
        edgesR.render({ board: b, rects: r, links: session.links || [], coveredEdges: session.coveredEdges || new Set(), selection, zoom: vp.zoom, dirty: dirty.all || dirty.structural || dirty.links ? null : dirty.edges });
      }
      // edges touching dirty items move with them
      if (dirty.items.size && !dirty.all && !dirty.structural) {
        edgesR.update({ board: b, edgeUids: edgesTouching(b, dirty.items), rects: r, zoom: vp.zoom, linkKeys: new Set((session.links || []).map((l) => l.key)), links: session.links || [] });
      }
    }
    if (dirty.viewport) {
      world.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
      const g = gridBackground(vp, setting("grid", "dots"));
      if (g) {
        grid.style.backgroundSize = `${g.size}px ${g.size}px`;
        grid.style.backgroundPosition = `${g.x}px ${g.y}px`;
      }
      chrome.toolbar.setZoom(vp.zoom);
    }
    if (dirty.selection || itemsChanged) {
      itemsR.setSelection(selection.items);
      edgesR.setSelection({ edge: selection.edge, link: selection.link });
      if (!gesturing && !itemsR.isEditing()) showCtx(); else chrome.ctx.hide();
    } else if (dirty.viewport && chrome.ctx.isOpen()) {
      chrome.ctx.reposition();
    }
    if (dirty.viewport || itemsChanged) chrome.minimap.update({ board: b, rects: r, vp, size });
    if (itemsChanged && !gesturing) scheduleContent();
    if (searchMatches.length || root.classList.contains("pxd-root--searching")) panel.refreshMarks();
    dirty.viewport = false;
    dirty.items = new Set();
    dirty.edges = new Set();
    dirty.structural = false;
    dirty.all = false;
    dirty.selection = false;
    dirty.links = false;
  };

  // ------------------------------------------------------------ boot
  applyFullscreen(fullscreen);
  measure();
  if (autofocus) { try { root.focus({ preventScroll: true }); } catch { /* stub */ } }
  if (!vp) {
    const b = board();
    const r = b ? rects() : new Map();
    vp = fitViewport(boundsOf([...r.values()]), size.width && size.height ? size : { width: 800, height: 560 }, { padding: 64, maxZoom: 1 });
  }
  applyLod();
  dirty.viewport = true;
  markAll();
  timers.later(() => { if (!disposed) scheduleContent(); }, 0);

  // ------------------------------------------------------------ API
  const view = {
    root,
    controller: ctl,
    setFullscreen(on) { if (Boolean(on) !== isFullscreen) applyFullscreen(on); },
    fit() { fitAll(); },
    stats() {
      return { timers: timers.count(), listeners: listeners.length + (captured ? 3 : 0), observers: observers.length, mounted: itemsR.mountedCount(), shells: itemsR.shellCount() };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ctl.cancel();
      releaseCapture();
      if (heightDrag) onHeightUp();
      subs.splice(0).forEach((off) => { try { off?.(); } catch { /* already off */ } });
      routeOff();
      fsDispose();
      applyFullscreenChrome(mountEl, false, doc);
      vpStore.flush?.();
      resumeTimer?.();
      settleTimer?.();
      frameHandle?.();
      itemsR.dispose();
      edgesR.dispose();
      panel.dispose();
      chrome.dispose();
      listeners.splice(0).forEach((off) => off());
      observers.splice(0).forEach((o) => o.disconnect());
      timers.cancelAll();
      root.remove();
      // The acquirer (feature.js) owns session.release(); a second release here destroyed shared sessions.
      released = true;
    },
  };
  return view;
}
