// Add panel (spec 3.5): Search (pages + blocks), Related (for the selected card), Boards (every diagram
// board in the graph) and Outline (the board's cards as an indented tree).
// Rows click-add beside the selection and drag onto the board with a custom MIME.

import { closeInfoTab, infoTabList, nextPanelWidth, PANEL_WIDTH_DEFAULT } from "../model/info.js";
import { LIBRARY_TYPES, libraryFilterActive } from "../model/library.js";

export const CARD_MIME = "application/x-plexus-card";
const DEBOUNCE_MS = 150;
const LIMIT = 40;

// Roam bullet drags carry uids in roam/* types (text/plain is a single space); our own rows carry CARD_MIME.
// Returns Array<{string}> (empty when nothing usable). resolveUid(uid) -> card string | null is injected by the view.
const MAX_DROP = 50;
export function parseDropPayload(dataTransfer, { resolveUid } = {}) {
  if (!dataTransfer) return [];
  const take = (type) => {
    try { return String(dataTransfer.getData?.(type) || ""); } catch { return ""; }
  };
  const resolve = typeof resolveUid === "function" ? resolveUid : (uid) => `((${uid}))`;
  const own = take(CARD_MIME).trim();
  if (own) return [{ string: own }];
  const tokens = (text) => text.split(/\s+/).filter((t) => /^[\w-]+$/.test(t));
  let uids = tokens(take("roam/block-uid-list-only-parents"));
  if (!uids.length) uids = tokens(take("roam/block-uid-list"));
  if (!uids.length) {
    for (const type of ["roam/roam-uri-list", "text/uri-list"]) {
      for (const line of take(type).split(/\r?\n/)) {
        if (!line.trim() || line.startsWith("#")) continue;
        const m = line.match(/\/page\/([\w-]+)/);
        if (m) uids.push(m[1]);
      }
      if (uids.length) break;
    }
  }
  if (uids.length) {
    const out = [];
    for (const uid of [...new Set(uids)].slice(0, MAX_DROP)) {
      let string = null;
      try { string = resolve(uid); } catch { string = null; }
      if (typeof string === "string" && string.trim()) out.push({ string });
    }
    if (out.length) return out;
  }
  const chunks = [take("text/plain"), take("text/html")];
  const types = dataTransfer.types;
  if (types) for (const type of types) chunks.push(take(type));
  const blob = chunks.join("\n");
  if (!blob.trim()) return [];
  const page = blob.match(/\[\[([^\]]+)\]\]/);
  if (page) return [{ string: `[[${page[1]}]]` }];
  const blockRef = blob.match(/\(\(([^)]+)\)\)/);
  if (blockRef) return [{ string: `((${blockRef[1]}))` }];
  const plain = take("text/plain").trim();
  if (/^[A-Za-z0-9_-]{9}$/.test(plain)) {
    let string = null;
    try { string = resolve(plain); } catch { string = null; }
    if (typeof string === "string" && string.trim()) return [{ string }];
  }
  return [];
}

export function createPanel({ doc = globalThis.document, root, host, timers, on = {}, width } = {}) {
  const listeners = [];
  const listen = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    listeners.push(() => el.removeEventListener(type, fn, opts));
  };
  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    parent?.append(node);
    return node;
  };

  const panel = el("aside", "pxd-panel pxd-chrome", root);
  panel.style.display = "none";
  if (Number.isFinite(Number(width))) panel.style.width = `${nextPanelWidth(width, 0)}px`;
  const resize = el("div", "pxd-panel__resize", panel);
  resize.title = "Resize";
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "keydown", "keyup"]) {
    listen(panel, type, (event) => {
      // The fullscreen editor is a real Roam block. Its keys have to reach Roam (undo, indent).
      if ((type === "keydown" || type === "keyup") && event.target?.closest?.(".pxd-panel__info-mount")) return;
      event.stopPropagation();
    });
  }
  let resizing = null;
  listen(resize, "pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const measured = panel.getBoundingClientRect?.().width;
    const styled = parseFloat(panel.style.width);
    resizing = { x: event.clientX, w: measured || styled || PANEL_WIDTH_DEFAULT };
    try { resize.setPointerCapture?.(event.pointerId); } catch { /* no capture */ }
  });
  listen(resize, "pointermove", (event) => {
    if (!resizing) return;
    panel.style.width = `${nextPanelWidth(resizing.w, resizing.x - event.clientX)}px`;
  });
  listen(resize, "pointerup", (event) => {
    if (!resizing) return;
    const next = nextPanelWidth(resizing.w, resizing.x - event.clientX);
    resizing = null;
    panel.style.width = `${next}px`;
    on.rememberWidth?.(next);
  });
  const head = el("div", "pxd-panel__head", panel);
  const tabs = el("div", "pxd-panel__tabs", head);
  const tabSearch = el("button", "pxd-btn pxd-panel__tab pxd-panel__tab--on", tabs, "Search");
  const tabRelated = el("button", "pxd-btn pxd-panel__tab", tabs, "Related");
  const tabBoards = el("button", "pxd-btn pxd-panel__tab", tabs, "Boards");
  const tabOutline = el("button", "pxd-btn pxd-panel__tab", tabs, "Outline");
  const tabInfo = el("button", "pxd-btn pxd-panel__tab", tabs, "Info");
  const tabButtons = { search: tabSearch, related: tabRelated, boards: tabBoards, outline: tabOutline, info: tabInfo };
  for (const [name, b] of Object.entries(tabButtons)) {
    b.type = "button";
    b.dataset.tab = name;
    b.setAttribute("data-tab", name);
  }
  const closeBtn = el("button", "pxd-btn pxd-panel__close", head, "×");
  closeBtn.type = "button";
  closeBtn.title = "Close";
  const searchPane = el("div", "pxd-panel__pane pxd-panel__pane--search", panel);
  const relatedPane = el("div", "pxd-panel__pane pxd-panel__pane--related", panel);
  relatedPane.style.display = "none";
  const input = el("input", "pxd-input pxd-panel__input", searchPane);
  input.type = "text";
  input.placeholder = "Search pages and blocks…";
  input.setAttribute("placeholder", "Search pages and blocks…");
  const filters = el("div", "pxd-panel__filters", searchPane);
  const typeSel = el("select", "pxd-panel__type", filters);
  typeSel.setAttribute("aria-label", "Type");
  const typeLabels = { all: "All", page: "Pages", block: "Blocks", board: "Boards", daily: "Dailies" };
  for (const value of LIBRARY_TYPES) {
    const opt = el("option", "pxd-panel__type-opt", typeSel, typeLabels[value]);
    opt.value = value;
    opt.setAttribute("value", value);
  }
  typeSel.value = "all";
  const tagInput = el("input", "pxd-panel__tag", filters);
  tagInput.type = "text";
  tagInput.placeholder = "#tag";
  tagInput.setAttribute("placeholder", "#tag");
  tagInput.setAttribute("aria-label", "Tag");
  const daysInput = el("input", "pxd-panel__days", filters);
  daysInput.type = "number";
  daysInput.min = "0";
  daysInput.placeholder = "days";
  daysInput.setAttribute("placeholder", "days");
  daysInput.setAttribute("aria-label", "Edited in the last N days");
  const orphanLabel = el("label", "pxd-panel__orphan", filters);
  const orphanBox = el("input", "pxd-panel__orphan-box", orphanLabel);
  orphanBox.type = "checkbox";
  orphanLabel.append("Not on any board");
  const results = el("div", "pxd-panel__list", searchPane);
  const relatedHead = el("div", "pxd-panel__related-head", relatedPane);
  const relatedTitle = el("span", "pxd-panel__related-title", relatedHead, "Select a card");
  const addAll = el("button", "pxd-btn pxd-panel__add-all", relatedHead, "Add all");
  addAll.type = "button";
  addAll.style.display = "none";
  const relatedList = el("div", "pxd-panel__list", relatedPane);
  const boardsPane = el("div", "pxd-panel__pane pxd-panel__pane--boards", panel);
  boardsPane.style.display = "none";
  const boardsFilter = el("input", "pxd-input pxd-panel__input pxd-panel__boards-filter", boardsPane);
  boardsFilter.type = "text";
  boardsFilter.placeholder = "Filter boards…";
  boardsFilter.setAttribute("placeholder", "Filter boards…");
  const boardsList = el("div", "pxd-panel__list pxd-panel__boards", boardsPane);
  const outlinePane = el("div", "pxd-panel__pane pxd-panel__pane--outline", panel);
  outlinePane.style.display = "none";
  const outlineList = el("div", "pxd-panel__list pxd-panel__outline", outlinePane);
  const infoPane = el("div", "pxd-panel__pane pxd-panel__pane--info", panel);
  infoPane.style.display = "none";
  const infoTabsBar = el("div", "pxd-panel__infotabs", infoPane);
  const infoScroll = el("div", "pxd-panel__info", infoPane);

  let tab = "search";
  let debounce = null;
  let selected = null;
  let relatedRows = [];
  let queryId = 0;

  const row = (parent, { string, label, text, kind }) => {
    const r = el("div", "pxd-panel__row", parent);
    r.setAttribute("draggable", "true");
    r.draggable = true;
    r.dataset.string = string;
    r.setAttribute("data-string", string);
    if (label) el("span", "pxd-panel__row-label", r, label);
    el("span", `pxd-panel__row-text pxd-panel__row-text--${kind || "page"}`, r, text);
    if (on.isOnBoard?.(string)) {
      r.classList.add("pxd-panel__row--on");
      el("span", "pxd-panel__row-on", r, "on board");
    }
    listen(r, "click", (event) => { event.stopPropagation(); on.addBeside?.(string); r.classList.add("pxd-panel__row--on"); });
    listen(r, "dragstart", (event) => {
      try {
        event.dataTransfer?.setData?.(CARD_MIME, string);
        event.dataTransfer?.setData?.("text/plain", string);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      } catch { /* stub */ }
    });
    return r;
  };

  const readFilter = () => ({
    text: input.value,
    type: typeSel.value || "all",
    tag: tagInput.value,
    days: daysInput.value,
    orphan: orphanBox.checked === true,
  });

  const runSearch = async () => {
    const filter = readFilter();
    const id = queryId += 1;
    results.replaceChildren();
    if (!libraryFilterActive(filter)) return;
    let pack = null;
    try {
      if (typeof host?.librarySearch === "function") {
        pack = await Promise.resolve(host.librarySearch(filter, LIMIT));
      } else {
        const q = String(filter.text || "").trim();
        if (!q) return;
        const [pages, blocks] = await Promise.all([
          Promise.resolve(host?.searchPages?.(q, LIMIT) || []),
          Promise.resolve(host?.searchBlocks?.(q, LIMIT) || []),
        ]);
        pack = {
          rows: [
            ...(pages || []).map((p) => ({ string: `[[${p.title}]]`, text: p.title, kind: "page", label: "page" })),
            ...(blocks || []).map((b) => ({ string: `((${b.uid}))`, text: `${b.string || ""}`.slice(0, 120), kind: "block", label: b.pageTitle ? `in ${b.pageTitle}` : "block" })),
          ].slice(0, LIMIT),
          queries: [],
        };
      }
    } catch { /* search failed; show nothing */ }
    if (id !== queryId) return;
    const queries = Array.isArray(pack?.queries) ? pack.queries : [];
    const ms = queries.reduce((max, q) => Math.max(max, Number(q?.ms) || 0), 0);
    results.dataset.queryMs = String(ms);
    results.setAttribute("data-query-ms", String(ms));
    const log = JSON.stringify(queries.map((q) => ({ name: q.name, ms: Math.round((Number(q.ms) || 0) * 10) / 10 })));
    results.dataset.queryLog = log;
    results.setAttribute("data-query-log", log);
    const rows = (Array.isArray(pack?.rows) ? pack.rows : []).slice(0, LIMIT);
    results.replaceChildren();
    if (!rows.length) { el("div", "pxd-panel__empty", results, "No matches"); return; }
    rows.forEach((r) => row(results, r));
  };

  const scheduleSearch = () => {
    debounce?.();
    debounce = timers.later(() => { debounce = null; void runSearch(); }, DEBOUNCE_MS);
  };
  const searchNow = () => { debounce?.(); debounce = null; void runSearch(); };
  listen(input, "input", scheduleSearch);
  listen(tagInput, "input", scheduleSearch);
  listen(daysInput, "input", scheduleSearch);
  listen(typeSel, "change", searchNow);
  listen(orphanBox, "change", searchNow);
  listen(input, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); api.close(); }
    if (event.key === "Enter") { event.preventDefault(); searchNow(); }
  });
  for (const field of [tagInput, daysInput]) {
    listen(field, "keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); searchNow(); }
    });
  }

  const setTab = (next) => {
    if (tab === "info" && next !== "info") unmountInfo();
    tab = next;
    for (const [name, b] of Object.entries(tabButtons)) b.classList.toggle("pxd-panel__tab--on", tab === name);
    searchPane.style.display = tab === "search" ? "" : "none";
    relatedPane.style.display = tab === "related" ? "" : "none";
    boardsPane.style.display = tab === "boards" ? "" : "none";
    outlinePane.style.display = tab === "outline" ? "" : "none";
    infoPane.style.display = tab === "info" ? "" : "none";
    if (tab === "related") void loadRelated();
    if (tab === "boards") void loadBoards();
    if (tab === "outline") renderOutline();
    if (tab === "info") void loadInfo();
  };
  for (const [name, b] of Object.entries(tabButtons)) listen(b, "click", () => setTab(name));
  listen(closeBtn, "click", () => api.close());
  listen(addAll, "click", () => {
    const strings = relatedRows.map((r) => r.string).filter((s) => !on.isOnBoard?.(s));
    if (strings.length) on.addMany?.(strings);
  });

  const loadRelated = async () => {
    relatedList.replaceChildren();
    relatedRows = [];
    addAll.style.display = "none";
    if (!selected || !host?.related) { relatedTitle.textContent = "Select a card"; return; }
    const target = selected.target;
    const key = target.kind === "page" ? { kind: "page", title: target.title } : { kind: "block", uid: target.uid };
    relatedTitle.textContent = selected.title || "Related";
    const id = queryId += 1;
    let list = [];
    try { list = await Promise.resolve(host.related(key, 60, { boardUid: root?.dataset?.board })) || []; } catch { list = []; }
    if (id !== queryId || tab !== "related") return;
    relatedList.replaceChildren();
    for (const rel of list) {
      const t = rel.target || {};
      const string = t.kind === "page" ? `[[${t.title}]]` : `((${t.uid}))`;
      const text = rel.text || (t.kind === "page" ? t.title : t.uid) || "";
      relatedRows.push({ string });
      row(relatedList, { string, label: rel.relation || "related", text, kind: t.kind });
    }
    if (!list.length) el("div", "pxd-panel__empty", relatedList, "Nothing related yet");
    addAll.style.display = list.length ? "" : "none";
  };

  // ---- Boards: every diagram board in the graph. Rows open the board; the button adds a shortcut card.
  let boardRows = [];
  const renderBoards = () => {
    boardsList.replaceChildren();
    const q = String(boardsFilter.value || "").trim().toLowerCase();
    const shown = boardRows.filter((b) => !q || `${b.title || ""}\n${b.page || b.pageTitle || ""}`.toLowerCase().includes(q));
    if (!shown.length) { el("div", "pxd-panel__empty", boardsList, boardRows.length ? "No matching boards" : "No boards found"); return; }
    for (const b of shown) {
      const r = el("div", "pxd-panel__board-row", boardsList);
      r.dataset.uid = b.uid;
      r.setAttribute("data-uid", b.uid);
      const text = el("div", "pxd-panel__board-text", r);
      el("span", "pxd-panel__board-title", text, b.title || "Untitled board");
      const page = b.page || b.pageTitle;
      if (page) el("span", "pxd-panel__board-page", text, page);
      const n = b.count ?? b.itemCount ?? b.items;
      if (Number.isFinite(n)) el("span", "pxd-panel__board-count", r, `${n} ${n === 1 ? "item" : "items"}`);
      const add = el("button", "pxd-btn pxd-panel__board-add", r, "Add shortcut");
      add.type = "button";
      add.title = "Add a card for this board to the current board";
    }
  };
  // One delegated listener: re-rendering the list never adds listeners.
  listen(boardsList, "click", (event) => {
    const row = event.target?.closest?.(".pxd-panel__board-row");
    const uid = row?.dataset?.uid ?? row?.getAttribute?.("data-uid");
    if (!uid) return;
    event.preventDefault?.();
    event.stopPropagation();
    if (event.target.closest(".pxd-panel__board-add")) on.addBoardCard?.(uid);
    else on.openBoardByUid?.(uid);
  });
  const loadBoards = async () => {
    const id = queryId += 1;
    boardsList.replaceChildren();
    el("div", "pxd-panel__empty", boardsList, "Loading boards…");
    let rows = [];
    try { rows = await Promise.resolve(on.listBoards?.()) || []; } catch { rows = []; }
    if (id !== queryId || tab !== "boards") return;
    boardRows = Array.isArray(rows) ? rows.filter((b) => b && b.uid) : [];
    renderBoards();
  };
  listen(boardsFilter, "input", () => renderBoards());
  listen(boardsFilter, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); api.close(); }
  });

  // ---- Outline: the board's cards as an indented tree, in reading order.
  const renderOutline = () => {
    outlineList.replaceChildren();
    let rows = [];
    try { rows = on.getOutline?.() || []; } catch { rows = []; }
    if (!Array.isArray(rows) || !rows.length) { el("div", "pxd-panel__empty", outlineList, "Nothing on this board yet"); return; }
    for (const o of rows) {
      const depth = Math.max(0, Number(o.depth) || 0);
      const r = el("div", "pxd-panel__outline-row", outlineList);
      r.dataset.uid = o.uid;
      r.setAttribute("data-uid", o.uid);
      r.dataset.depth = String(depth);
      r.setAttribute("data-depth", String(depth));
      r.style.paddingLeft = `${8 + depth * 14}px`;
      const dot = el("span", `pxd-panel__outline-dot${o.color ? ` pxd-c-${o.color}` : ""}`, r);
      dot.setAttribute("aria-hidden", "true");
      el("span", "pxd-panel__outline-title", r, o.title || "Untitled");
      if (Number.isFinite(o.count) && o.count > 0) el("span", "pxd-panel__outline-count", r, String(o.count));
    }
  };
  listen(outlineList, "click", (event) => {
    const row = event.target?.closest?.(".pxd-panel__outline-row");
    const uid = row?.dataset?.uid ?? row?.getAttribute?.("data-uid");
    if (!uid) return;
    event.stopPropagation();
    on.outlineClick?.(uid);
  });

  // Card tabs are session state. A new panel starts empty; only the width is remembered.
  let cardTabs = [];
  const cardItems = new Map();
  let cardCurrent = null;
  let followInfoSelection = true;
  const renderCardTabs = () => {
    infoTabsBar.replaceChildren();
    for (const t of cardTabs) {
      const row = el("span", t.uid === cardCurrent ? "pxd-panel__infotab pxd-panel__infotab--on" : "pxd-panel__infotab", infoTabsBar);
      const name = el("button", "pxd-btn pxd-panel__infotab-name", row, cardItems.get(t.uid)?.title || "Untitled");
      name.type = "button";
      name.dataset.uid = t.uid;
      name.setAttribute("data-uid", t.uid);
      const closer = el("button", "pxd-btn pxd-panel__infotab-x", row, "×");
      closer.type = "button";
      closer.title = "Close";
      closer.dataset.uid = t.uid;
      closer.setAttribute("data-uid", t.uid);
    }
  };
  // Inline boards are too narrow for a second editor. Fullscreen mounts Roam's renderer in the panel.
  let infoMounted = false;
  const unmountInfo = () => {
    if (!infoMounted) return;
    infoMounted = false;
    const prev = infoScroll.querySelector(".pxd-panel__info-mount");
    if (prev) {
      try { host?.unmount?.(prev); } catch { /* already gone */ }
    }
  };
  const infoSection = (label) => {
    const section = el("section", "pxd-panel__info-sec", infoScroll);
    el("div", "pxd-panel__info-h", section, label);
    return section;
  };
  const loadInfo = async () => {
    const id = queryId += 1;
    unmountInfo();
    infoScroll.replaceChildren();
    const tabItem = cardCurrent ? cardItems.get(cardCurrent) || null : null;
    const subject = followInfoSelection ? selected : (tabItem || selected);
    if (!subject || subject.type === "section") {
      el("div", "pxd-panel__empty", infoScroll, "Select a card");
      return;
    }
    let info = null;
    try { info = await Promise.resolve(host?.cardInfo?.(subject)) ?? null; } catch { info = null; }
    if (id !== queryId || tab !== "info") return;
    unmountInfo();
    infoScroll.replaceChildren();
    if (!info) {
      el("div", "pxd-panel__empty", infoScroll, "Nothing to show");
      return;
    }
    const bodySec = infoSection("Card");
    el("div", "pxd-panel__info-body", bodySec, info.body || "");
    const mount = el("div", "pxd-panel__info-mount", bodySec);
    if (on.isFullscreen?.()) {
      try {
        if (info.kind === "page" && info.pageUid && host?.renderPage) {
          host.renderPage(mount, info.pageUid);
          infoMounted = true;
        } else if (info.uid && host?.renderBlock) {
          host.renderBlock(mount, info.uid);
          infoMounted = true;
        }
      } catch { /* render failed */ }
    } else {
      el("div", "pxd-panel__info-note", mount, "Editing in the right sidebar");
      try { on.openSidebarEditor?.(subject); } catch { /* sidebar unavailable */ }
    }
    const attrSec = infoSection("Attributes");
    if (!info.attributes?.length) el("div", "pxd-panel__empty", attrSec, "No attributes");
    else for (const attr of info.attributes) {
      const row = el("div", "pxd-panel__info-attr", attrSec);
      el("span", "pxd-panel__info-name", row, attr.name);
      el("span", "pxd-panel__info-value", row, attr.value);
    }
    const refSec = infoSection("Linked references");
    if (!info.refs?.length) el("div", "pxd-panel__empty", refSec, "No linked references");
    else for (const ref of info.refs) {
      const row = el("button", "pxd-btn pxd-panel__info-ref", refSec, ref.string || ref.uid);
      row.type = "button";
      row.dataset.uid = ref.uid;
      row.setAttribute("data-uid", ref.uid);
      if (ref.pageTitle) row.title = ref.pageTitle;
    }
    const boardSec = infoSection("On boards");
    if (!info.boards?.length) el("div", "pxd-panel__empty", boardSec, "Not on another board");
    else for (const board of info.boards) {
      const row = el("button", "pxd-btn pxd-panel__info-board", boardSec);
      row.type = "button";
      row.dataset.uid = board.uid;
      row.setAttribute("data-uid", board.uid);
      el("span", "pxd-panel__info-board-title", row, board.title || "Untitled board");
      if (board.pageTitle) el("span", "pxd-panel__info-board-page", row, board.pageTitle);
    }
    const tagSec = infoSection("Tags");
    if (!info.tags?.length) el("div", "pxd-panel__empty", tagSec, "No tags");
    else {
      const wrap = el("div", "pxd-panel__info-tags", tagSec);
      for (const name of info.tags) el("span", "pxd-panel__info-tag", wrap, name);
    }
  };
  listen(infoScroll, "click", (event) => {
    const board = event.target?.closest?.(".pxd-panel__info-board");
    const ref = event.target?.closest?.(".pxd-panel__info-ref");
    const node = board || ref;
    const uid = node?.dataset?.uid ?? node?.getAttribute?.("data-uid");
    if (!uid) return;
    event.preventDefault?.();
    event.stopPropagation();
    if (board) on.openBoardByUid?.(uid);
    else on.openRef?.(uid);
  });
  listen(infoTabsBar, "click", (event) => {
    const closer = event.target?.closest?.(".pxd-panel__infotab-x");
    const name = event.target?.closest?.(".pxd-panel__infotab-name");
    const node = closer || name;
    const uid = node?.dataset?.uid ?? node?.getAttribute?.("data-uid");
    if (!uid) return;
    event.preventDefault?.();
    event.stopPropagation();
    if (closer) {
      const next = closeInfoTab(cardTabs, cardCurrent, uid);
      cardTabs = next.tabs;
      if (!next.tabs.some((t) => t.uid === uid)) cardItems.delete(uid);
      cardCurrent = next.current;
      followInfoSelection = false;
      renderCardTabs();
      void loadInfo();
      return;
    }
    cardCurrent = uid;
    followInfoSelection = false;
    renderCardTabs();
    on.focusInfoTab?.(uid);
    void loadInfo();
  });

  const api = {
    el: panel,
    open(which = tab) {
      panel.style.display = "";
      setTab(which);
      on.opened?.(true);
      const focusTarget = which === "search" ? input : which === "boards" ? boardsFilter : null;
      if (focusTarget) { try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus?.(); } }
    },
    currentTab: () => tab,
    refreshOutline() { if (api.isOpen() && tab === "outline") renderOutline(); },
    close() {
      if (tab === "info") unmountInfo();
      panel.style.display = "none";
      on.opened?.(false);
    },
    toggle() { if (api.isOpen()) api.close(); else api.open(); },
    isOpen: () => panel.style.display !== "none",
    setSelection(item) {
      selected = item && item.type !== "section" ? item : null;
      followInfoSelection = true;
      if (selected && cardItems.has(selected.uid)) cardCurrent = selected.uid;
      if (api.isOpen() && tab === "related") void loadRelated();
      if (api.isOpen() && tab === "info") {
        renderCardTabs();
        void loadInfo();
      }
    },
    addInfoTab(item) {
      if (!item?.uid || item.type === "section") return cardTabs.map((t) => t.uid);
      const title = item.title || String(item.string || "").split("\n")[0].slice(0, 48) || "Untitled";
      cardItems.set(item.uid, { ...item, title });
      const next = infoTabList(cardTabs, item.uid, { add: true });
      cardTabs = next.tabs;
      cardCurrent = next.current;
      followInfoSelection = false;
      panel.style.display = "";
      setTab("info");
      on.opened?.(true);
      renderCardTabs();
      void loadInfo();
      return cardTabs.map((t) => t.uid);
    },
    infoTabs: () => cardTabs.map((t) => t.uid),
    infoCurrent: () => cardCurrent,
    refreshMarks() {
      for (const r of panel.querySelectorAll(".pxd-panel__row")) {
        const s = r.dataset?.string || r.getAttribute("data-string");
        r.classList.toggle("pxd-panel__row--on", Boolean(on.isOnBoard?.(s)));
      }
    },
    dispose() {
      debounce?.();
      queryId += 1;
      unmountInfo();
      listeners.splice(0).forEach((off) => off());
      panel.remove();
    },
  };
  return api;
}
