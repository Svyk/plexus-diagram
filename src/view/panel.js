// Add panel (spec 3.5): Search (pages + blocks), Related (for the selected card), Boards (every diagram
// board in the graph) and Outline (the board's cards as an indented tree).
// Rows click-add beside the selection and drag onto the board with a custom MIME.

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

export function createPanel({ doc = globalThis.document, root, host, timers, on = {} } = {}) {
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
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "keydown", "keyup"]) {
    listen(panel, type, (event) => event.stopPropagation());
  }
  const head = el("div", "pxd-panel__head", panel);
  const tabs = el("div", "pxd-panel__tabs", head);
  const tabSearch = el("button", "pxd-btn pxd-panel__tab pxd-panel__tab--on", tabs, "Search");
  const tabRelated = el("button", "pxd-btn pxd-panel__tab", tabs, "Related");
  const tabBoards = el("button", "pxd-btn pxd-panel__tab", tabs, "Boards");
  const tabOutline = el("button", "pxd-btn pxd-panel__tab", tabs, "Outline");
  const tabButtons = { search: tabSearch, related: tabRelated, boards: tabBoards, outline: tabOutline };
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

  const runSearch = async () => {
    const q = String(input.value || "").trim();
    const id = queryId += 1;
    results.replaceChildren();
    if (!q) return;
    let pages = [];
    let blocks = [];
    try {
      [pages, blocks] = await Promise.all([
        Promise.resolve(host?.searchPages?.(q, LIMIT) || []),
        Promise.resolve(host?.searchBlocks?.(q, LIMIT) || []),
      ]);
    } catch { /* search failed; show nothing */ }
    if (id !== queryId) return;
    const rows = [
      ...pages.map((p) => ({ string: `[[${p.title}]]`, text: p.title, kind: "page", label: "page" })),
      ...blocks.map((b) => ({ string: `((${b.uid}))`, text: `${b.string || ""}`.slice(0, 120), kind: "block", label: b.pageTitle ? `in ${b.pageTitle}` : "block" })),
    ].slice(0, LIMIT);
    results.replaceChildren();
    if (!rows.length) { el("div", "pxd-panel__empty", results, "No matches"); return; }
    rows.forEach((r) => row(results, r));
  };

  listen(input, "input", () => {
    debounce?.();
    debounce = timers.later(() => { debounce = null; void runSearch(); }, DEBOUNCE_MS);
  });
  listen(input, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); api.close(); }
    if (event.key === "Enter") { event.preventDefault(); debounce?.(); debounce = null; void runSearch(); }
  });

  const setTab = (next) => {
    tab = next;
    for (const [name, b] of Object.entries(tabButtons)) b.classList.toggle("pxd-panel__tab--on", tab === name);
    searchPane.style.display = tab === "search" ? "" : "none";
    relatedPane.style.display = tab === "related" ? "" : "none";
    boardsPane.style.display = tab === "boards" ? "" : "none";
    outlinePane.style.display = tab === "outline" ? "" : "none";
    if (tab === "related") void loadRelated();
    if (tab === "boards") void loadBoards();
    if (tab === "outline") renderOutline();
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
    close() { panel.style.display = "none"; on.opened?.(false); },
    toggle() { if (api.isOpen()) api.close(); else api.open(); },
    isOpen: () => panel.style.display !== "none",
    setSelection(item) {
      selected = item && item.type !== "section" ? item : null;
      if (api.isOpen() && tab === "related") void loadRelated();
    },
    refreshMarks() {
      for (const r of panel.querySelectorAll(".pxd-panel__row")) {
        const s = r.dataset?.string || r.getAttribute("data-string");
        r.classList.toggle("pxd-panel__row--on", Boolean(on.isOnBoard?.(s)));
      }
    },
    dispose() {
      debounce?.();
      queryId += 1;
      listeners.splice(0).forEach((off) => off());
      panel.remove();
    },
  };
  return api;
}
