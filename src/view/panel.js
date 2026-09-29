// Add panel (spec 3.5): Search (pages + blocks) and Related (for the selected card).
// Rows click-add beside the selection and drag onto the board with a custom MIME.

export const CARD_MIME = "application/x-plexus-card";
const DEBOUNCE_MS = 150;
const LIMIT = 40;

// Ported from 0.6: Roam drags carry [[page]] / ((uid)) text; our own rows carry CARD_MIME.
export function parseDropPayload(dataTransfer) {
  if (!dataTransfer) return null;
  const take = (type) => {
    try { return String(dataTransfer.getData?.(type) || ""); } catch { return ""; }
  };
  const own = take(CARD_MIME);
  if (own.trim()) return { kind: "card", string: own.trim() };
  const chunks = [take("text/plain"), take("text/html")];
  const types = dataTransfer.types;
  if (types) for (const type of types) chunks.push(take(type));
  const blob = chunks.join("\n");
  if (!blob.trim()) return null;
  const page = blob.match(/\[\[([^\]]+)\]\]/);
  if (page) return { kind: "page", title: page[1], string: `[[${page[1]}]]` };
  const blockRef = blob.match(/\(\(([^)]+)\)\)/);
  if (blockRef) return { kind: "block", uid: blockRef[1], string: `((${blockRef[1]}))` };
  const plain = take("text/plain").trim();
  if (/^[A-Za-z0-9_-]{9}$/.test(plain)) return { kind: "block", uid: plain, string: `((${plain}))` };
  return null;
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
  tabSearch.type = "button";
  tabRelated.type = "button";
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
    tabSearch.classList.toggle("pxd-panel__tab--on", tab === "search");
    tabRelated.classList.toggle("pxd-panel__tab--on", tab === "related");
    searchPane.style.display = tab === "search" ? "" : "none";
    relatedPane.style.display = tab === "related" ? "" : "none";
    if (tab === "related") void loadRelated();
  };
  listen(tabSearch, "click", () => setTab("search"));
  listen(tabRelated, "click", () => setTab("related"));
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

  const api = {
    el: panel,
    open(which = tab) { panel.style.display = ""; setTab(which); on.opened?.(true); if (which === "search") { try { input.focus({ preventScroll: true }); } catch { input.focus?.(); } } },
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
