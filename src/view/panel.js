// Add panel (spec 3.5): Search (pages + blocks), Related (for the selected card), Boards (every diagram
// board in the graph) and Outline (the board's cards as an indented tree).
// Rows click-add beside the selection and drag onto the board with a custom MIME.

import { askAiIcon } from "./ask-icon.js";
import { closeInfoTab, infoTabList, nextPanelWidth, PANEL_WIDTH_DEFAULT } from "../model/info.js";
import { mountTimeline } from "./timeline.js";
import { LIBRARY_DOC_TYPES, LIBRARY_PART_TYPES, PARSE_PART_TYPES, libraryCard, libraryFilterActive, queryTerms } from "../model/library.js";
import { markTerms } from "../model/pdf-ident.js";
import { mergeSemantic } from "../model/semantic.js";
import { PART_LABELS, partSnippet } from "../model/parts-search.js";
import { COLOR_ANCHORS, COLOR_NAMES } from "../model/color.js";
import { CARD_MIME, PARSE_MIME, parseDropPayload } from "../model/drop.js";
import { dailyTitle, startOfDay, stepDay } from "../model/journal.js";
import { timeAgo } from "../model/changes.js";
import { DEFAULT_SORT, metaFilterActive, metaLine, normalizeMetaFilter, normalizeSort, SORTS, sortLabel } from "../model/search-sort.js";
import { minimapSvg } from "./minimap-svg.js";
import { DEFAULT_WINDOW_NOTE, FILTER_DEBOUNCE_MS, browseEmptyText, wantsFilterBrowse } from "../model/filter-browse.js";

export { CARD_MIME, parseDropPayload };
const DEBOUNCE_MS = 150;
const UNDER_PAUSE_MS = 200;
const BROWSE_SORTS = new Set(["edited", "created", "oldest", "title"]);
const LIMIT = 40;
// Semantic search waits for a pause in typing; keyword results never wait for it.
export const SEMANTIC_PAUSE_MS = 300;
export const SEMANTIC_HINT = "Turn on Roam's semantic search: Settings → Graph → Semantic search";

export function createPanel({ doc = globalThis.document, root, host, timers, on = {}, width } = {}) {
  const listeners = [];
  const listen = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    listeners.push(() => el.removeEventListener(type, fn, opts));
  };
  // Result rows come and go with every search. Their listeners are released once the row has left the panel.
  const rowOffs = [];
  let rowCap = 128;
  const listenRow = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    rowOffs.push({ el, off: () => el.removeEventListener(type, fn, opts) });
    if (rowOffs.length <= rowCap) return;
    const keep = [];
    for (const entry of rowOffs) {
      if (entry.el.isConnected === false && !root?.contains?.(entry.el)) entry.off();
      else keep.push(entry);
    }
    rowOffs.length = 0;
    rowOffs.push(...keep);
    rowCap = Math.max(128, rowOffs.length * 2);
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
  // The minimap steps left of an open panel; the panel itself sits left of the rail (rail.css).
  const publishWidth = (w) => root?.style?.setProperty?.("--pxd-panel-w", `${w}px`);
  publishWidth(parseFloat(panel.style.width) || PANEL_WIDTH_DEFAULT);
  const resize = el("div", "pxd-panel__resize", panel);
  resize.title = "Resize";
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "keydown", "keyup"]) {
    listen(panel, type, (event) => {
      // The fullscreen editor is a real Roam block. Its keys have to reach Roam (undo, indent).
      if ((type === "keydown" || type === "keyup") && event.target?.closest?.(".pxd-panel__info-mount")) return;
      event.stopPropagation();
      // Trails controls share this listener so listenersPerBoard does not rise.
      if (type === "click") { trailClick(event); changedClick(event); searchClick(event); }
      else if (type === "keyup") underKey(event);
      else if (type === "pointerdown") trailPointerDown(event);
      else if (type === "keydown") trailKey(event);
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
    const w = nextPanelWidth(resizing.w, resizing.x - event.clientX);
    panel.style.width = `${w}px`;
    publishWidth(w);
  });
  listen(resize, "pointerup", (event) => {
    if (!resizing) return;
    const next = nextPanelWidth(resizing.w, resizing.x - event.clientX);
    resizing = null;
    panel.style.width = `${next}px`;
    publishWidth(next);
    on.rememberWidth?.(next);
  });
  const head = el("div", "pxd-panel__head", panel);
  const tabs = el("div", "pxd-panel__tabs", head);
  const tabBtn = (name, label, icon, on) => {
    const b = el("button", `pxd-btn pxd-iconbtn pxd-panel__tab${on ? " pxd-panel__tab--on" : ""}`, tabs);
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.dataset.tab = name;
    b.setAttribute("data-tab", name);
    const i = el("span", `bp3-icon bp3-icon-${icon}`, b);
    i.setAttribute("aria-hidden", "true");
    return b;
  };
  const tabSearch = tabBtn("search", "Search", "search", true);
  const tabRelated = tabBtn("related", "Related", "diagram-tree");
  const tabBoards = tabBtn("boards", "Boards", "applications");
  const tabOutline = tabBtn("outline", "Outline", "list");
  const tabJournal = tabBtn("journal", "Journal", "calendar");
  const tabInfo = tabBtn("info", "Info", "info-sign");
  const tabTrails = tabBtn("trails", "Trails", "flows");
  const tabChanged = tabBtn("changed", "Changed", "history");
  const tabButtons = { search: tabSearch, related: tabRelated, boards: tabBoards, outline: tabOutline, journal: tabJournal, info: tabInfo, trails: tabTrails, changed: tabChanged };
  const closeBtn = el("button", "pxd-btn pxd-iconbtn pxd-panel__close", head);
  closeBtn.type = "button";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  el("span", "bp3-icon bp3-icon-small-cross", closeBtn).setAttribute("aria-hidden", "true");
  const searchPane = el("div", "pxd-panel__pane pxd-panel__pane--search", panel);
  const relatedPane = el("div", "pxd-panel__pane pxd-panel__pane--related", panel);
  relatedPane.style.display = "none";
  const input = el("input", "pxd-input pxd-panel__input", searchPane);
  input.type = "text";
  input.setAttribute("aria-label", "Search pages and blocks");
  input.placeholder = "Search pages and blocks…";
  input.setAttribute("placeholder", "Search pages and blocks…");
  const filters = el("div", "pxd-panel__filters", searchPane);
  const typeBtn = el("button", "pxd-btn pxd-panel__type-btn", filters, "All");
  typeBtn.type = "button";
  typeBtn.setAttribute("aria-label", "Filter card type");
  typeBtn.setAttribute("aria-haspopup", "true");
  typeBtn.setAttribute("aria-expanded", "false");
  const typePop = el("div", "pxd-panel__type-pop", filters);
  typePop.style.display = "none";
  typePop.setAttribute("role", "group");
  typePop.setAttribute("aria-label", "Card types");
  const typeLabels = {
    page: "Page", block: "Block", board: "Board", daily: "Daily", pdf: "PDF", image: "Image", web: "Web link",
    paragraph: "Paragraph", table: "Table", figure: "Figure", caption: "Caption", heading: "Heading", formula: "Formula", region: "Region", pin: "Pin",
  };
  const ALL_TYPES = [...LIBRARY_DOC_TYPES, ...LIBRARY_PART_TYPES];
  const typeBoxes = new Map();
  let swatches = null;
  let checked = new Set(ALL_TYPES);
  try {
    const saved = on.loadTypes?.();
    if (Array.isArray(saved)) checked = new Set(saved.filter((t) => ALL_TYPES.includes(t)));
  } catch { /* default: every type */ }
  const typeBulk = el("div", "pxd-panel__type-bulk", typePop);
  const showAll = el("button", "pxd-btn pxd-panel__type-all", typeBulk, "Show all");
  showAll.type = "button";
  showAll.setAttribute("aria-label", "Show all");
  const hideAll = el("button", "pxd-btn pxd-panel__type-none", typeBulk, "Hide all");
  hideAll.type = "button";
  hideAll.setAttribute("aria-label", "Hide all");
  for (const [title, list] of [["Documents", LIBRARY_DOC_TYPES], ["Inside PDFs", LIBRARY_PART_TYPES]]) {
    el("div", "pxd-panel__type-group", typePop, title);
    for (const value of list) {
      const line = el("label", "pxd-panel__type-row", typePop);
      line.dataset.type = value;
      const box = el("input", "pxd-panel__type-box", line);
      box.type = "checkbox";
      box.dataset.type = value;
      box.setAttribute("data-type", value);
      box.setAttribute("aria-label", typeLabels[value]);
      line.append(typeLabels[value]);
      typeBoxes.set(value, box);
    }
  }
  const paintTypes = () => {
    for (const [value, box] of typeBoxes) box.checked = checked.has(value);
    const n = checked.size;
    typeBtn.textContent = n === ALL_TYPES.length ? "All" : n === 0 ? "None" : `${n} ${n === 1 ? "type" : "types"}`;
    if (swatches) swatches.style.display = typeof on.searchImages === "function" && (checked.has("image") || checked.has("figure")) ? "" : "none";
  };
  paintTypes();
  const setTypesOpen = (open) => {
    if (open) { try { setPopsOpen(null); } catch { /* popovers not built yet */ } }
    typePop.style.display = open ? "" : "none";
    // The panel is its own stacking context, under the palette: lift it while the list is open.
    root?.classList?.toggle?.("pxd-root--types-open", open);
    typeBtn.setAttribute("aria-expanded", open ? "true" : "false");
  };
  const typesOpen = () => typePop.style.display !== "none";
  // Sort (one quiet control beside the types) and the Roam-powered filters (More). Both are popovers like the types list.
  let sort = DEFAULT_SORT;
  try { sort = normalizeSort(on.loadSort?.()); } catch { /* default */ }
  const sortBtn = el("button", "pxd-btn pxd-panel__sort-btn", filters, sortLabel(sort));
  sortBtn.type = "button";
  sortBtn.setAttribute("aria-label", "Sort results");
  sortBtn.setAttribute("aria-haspopup", "true");
  sortBtn.setAttribute("aria-expanded", "false");
  const sortPop = el("div", "pxd-panel__type-pop pxd-panel__sort-pop", filters);
  sortPop.style.display = "none";
  sortPop.setAttribute("role", "menu");
  sortPop.setAttribute("aria-label", "Sort by");
  const sortItems = new Map();
  for (const item of SORTS) {
    const b = el("button", "pxd-panel__sort-item", sortPop, item.label);
    b.type = "button";
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-label", item.label);
    b.setAttribute("data-sort", item.id);
    b.dataset.sort = item.id;
    sortItems.set(item.id, b);
  }
  const paintSort = () => {
    sortBtn.textContent = sortLabel(sort);
    sortBtn.classList.toggle("pxd-panel__sort-btn--on", sort !== DEFAULT_SORT);
    for (const [id, b] of sortItems) b.setAttribute("aria-checked", id === sort ? "true" : "false");
  };
  paintSort();
  const moreBtn = el("button", "pxd-btn pxd-panel__more-btn", filters, "More");
  moreBtn.type = "button";
  moreBtn.setAttribute("aria-label", "More filters");
  moreBtn.setAttribute("aria-haspopup", "true");
  moreBtn.setAttribute("aria-expanded", "false");
  const morePop = el("div", "pxd-panel__type-pop pxd-panel__more-pop", filters);
  morePop.style.display = "none";
  morePop.setAttribute("role", "group");
  morePop.setAttribute("aria-label", "More filters");
  const field = (label, control, parent = morePop) => {
    const line = el("label", "pxd-panel__more-row", parent);
    el("span", "pxd-panel__more-label", line, label);
    line.append(control);
    return line;
  };
  const choose = (aria) => {
    const sel = el("select", "pxd-panel__more-select", null);
    sel.setAttribute("aria-label", aria);
    return sel;
  };
  const createdBySel = choose("Created by");
  const editedBySel = choose("Edited by");
  const fillUsers = (sel, names) => {
    sel.replaceChildren();
    for (const name of ["", ...names]) {
      const o = el("option", "", sel, name || "Anyone");
      o.value = name;
      o.setAttribute("value", name);
    }
  };
  fillUsers(createdBySel, []);
  fillUsers(editedBySel, []);
  field("Created by", createdBySel);
  field("Edited by", editedBySel);
  const dayModeSel = choose("Days count from");
  for (const [v, t] of [["edited", "Edited"], ["created", "Created"]]) {
    const o = el("option", "", dayModeSel, t);
    o.value = v;
    o.setAttribute("value", v);
  }
  field("Days box counts", dayModeSel);
  const underInput = el("input", "pxd-panel__more-under", null);
  underInput.type = "text";
  underInput.placeholder = "Page title";
  underInput.setAttribute("placeholder", "Page title");
  underInput.setAttribute("aria-label", "Under page");
  underInput.setAttribute("list", "pxd-panel-under-pages");
  field("Under page", underInput);
  const underList = el("datalist", "pxd-panel__more-pages", morePop);
  underList.id = "pxd-panel-under-pages";
  const check = (label, aria) => {
    const line = el("label", "pxd-panel__more-check", morePop);
    const box = el("input", "pxd-panel__more-box", line);
    box.type = "checkbox";
    box.setAttribute("aria-label", aria);
    line.append(label);
    return box;
  };
  const refsBox = check("Has linked references", "Has linked references");
  const childrenBox = check("Has children", "Has children");
  const parsedBox = check("Parsed PDFs only", "Parsed PDFs only");
  const highlightsBox = check("PDFs with highlights", "PDFs with highlights");
  const thisBoardBox = check("On this board", "On this board");
  const moreOpen = () => morePop.style.display !== "none";
  let usersLoaded = false;
  const loadUsers = () => {
    if (usersLoaded) return;
    usersLoaded = true;
    let names = [];
    try { names = on.userNames?.() || host?.userNames?.() || []; } catch { names = []; }
    const keep = [createdBySel.value, editedBySel.value];
    fillUsers(createdBySel, names);
    fillUsers(editedBySel, names);
    createdBySel.value = keep[0];
    editedBySel.value = keep[1];
  };
  const readMeta = () => normalizeMetaFilter({
    createdBy: createdBySel.value,
    editedBy: editedBySel.value,
    dayMode: dayModeSel.value,
    refs: refsBox.checked,
    children: childrenBox.checked,
    under: underInput.value,
    parsed: parsedBox.checked,
    highlights: highlightsBox.checked,
    thisBoard: thisBoardBox.checked,
  });
  const paintMore = () => {
    const n = [createdBySel.value, editedBySel.value, underInput.value.trim(), dayModeSel.value === "created" && Number(daysInput.value) > 0, refsBox.checked, childrenBox.checked, parsedBox.checked, highlightsBox.checked, thisBoardBox.checked].filter(Boolean).length + (orphanBox.checked ? 1 : 0);
    const label = n ? `More · ${n}` : "More";
    if (moreBtn.textContent !== label) moreBtn.textContent = label;
    moreBtn.classList.toggle("pxd-panel__more-btn--on", n > 0);
  };
  const setPopsOpen = (which) => {
    sortPop.style.display = which === "sort" ? "" : "none";
    sortBtn.setAttribute("aria-expanded", which === "sort" ? "true" : "false");
    morePop.style.display = which === "more" ? "" : "none";
    moreBtn.setAttribute("aria-expanded", which === "more" ? "true" : "false");
    if (which === "more") loadUsers();
    root?.classList?.toggle?.("pxd-root--types-open", which != null || typesOpen());
  };
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
  const pagesInput = el("input", "pxd-panel__pages", filters);
  pagesInput.type = "text";
  pagesInput.placeholder = "p. 3-8";
  pagesInput.setAttribute("placeholder", "p. 3-8");
  pagesInput.setAttribute("aria-label", "Page range, PDF parts only");
  const orphanLabel = el("label", "pxd-panel__orphan", filters);
  const orphanBox = el("input", "pxd-panel__orphan-box", orphanLabel);
  orphanBox.type = "checkbox";
  orphanBox.setAttribute("aria-label", "Not on any board");
  orphanLabel.append("Not on any board");
  const meaningLabel = el("label", "pxd-panel__meaning", filters);
  meaningLabel.title = "Also find notes by meaning (Roam semantic search)";
  const meaningBox = el("input", "pxd-panel__meaning-box", meaningLabel);
  meaningBox.type = "checkbox";
  meaningBox.setAttribute("aria-label", "Meaning");
  meaningBox.checked = (() => { try { return on.loadMeaning?.() !== false; } catch { return true; } })();
  meaningLabel.append("Meaning");
  const semanticOn = () => { try { return on.semantic?.enabled?.() === true; } catch { return false; } };
  const paintMeaning = () => { meaningLabel.style.display = semanticOn() ? "" : "none"; };
  paintMeaning();
  swatches = el("div", "pxd-panel__swatches", searchPane);
  swatches.style.display = "none";
  swatches.setAttribute("role", "group");
  swatches.setAttribute("aria-label", "Search images by colour");
  const swatchBtns = new Map();
  for (const name of COLOR_NAMES) {
    const b = el("button", "pxd-panel__swatch", swatches);
    b.type = "button";
    b.dataset.color = name;
    b.setAttribute("data-color", name);
    b.setAttribute("aria-label", name);
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("title", name);
    b.style.background = COLOR_ANCHORS[name].hex;
    swatchBtns.set(name, b);
  }
  paintTypes();
  const likeChip = el("div", "pxd-panel__like", searchPane);
  likeChip.style.display = "none";
  const likeText = el("span", "pxd-panel__like-text", likeChip);
  const likeClear = el("button", "pxd-panel__like-x", likeChip, "×");
  likeClear.type = "button";
  likeClear.setAttribute("aria-label", "Clear similar-image search");
  likeClear.setAttribute("title", "Clear");
  const relChip = el("div", "pxd-panel__like pxd-panel__rel", searchPane);
  relChip.style.display = "none";
  const relText = el("span", "pxd-panel__like-text", relChip);
  const relClear = el("button", "pxd-panel__like-x", relChip, "×");
  relClear.type = "button";
  relClear.setAttribute("aria-label", "Clear related search");
  relClear.setAttribute("title", "Clear");
  const results = el("div", "pxd-panel__list", searchPane);
  const indexNote = el("div", "pxd-panel__index-note", searchPane);
  indexNote.style.display = "none";
  indexNote.setAttribute("aria-live", "polite");
  const relatedHead = el("div", "pxd-panel__related-head", relatedPane);
  const relatedTitle = el("span", "pxd-panel__related-title", relatedHead, "Select a card");
  const addAll = el("button", "pxd-btn pxd-panel__add-all", relatedHead, "Add all");
  addAll.type = "button";
  addAll.setAttribute("aria-label", "Add all");
  addAll.style.display = "none";
  const relatedList = el("div", "pxd-panel__list", relatedPane);
  const boardsPane = el("div", "pxd-panel__pane pxd-panel__pane--boards", panel);
  boardsPane.style.display = "none";
  const boardsFilter = el("input", "pxd-input pxd-panel__input pxd-panel__boards-filter", boardsPane);
  boardsFilter.type = "text";
  boardsFilter.setAttribute("aria-label", "Filter boards");
  boardsFilter.placeholder = "Filter boards…";
  boardsFilter.setAttribute("placeholder", "Filter boards…");
  const viewsList = el("div", "pxd-panel__views", boardsPane);
  const boardsList = el("div", "pxd-panel__list pxd-panel__boards", boardsPane);
  let viewSig = "";
  const viewSignature = (views) => (Array.isArray(views) ? views : []).map((view) => `${view?.uid}|${view?.caption}|${(view?.v || []).join(",")}|${(view?.ids || []).join(",")}`).join("\n");
  const renderViews = () => {
    viewsList.replaceChildren();
    let views = [];
    try { views = on.listViews?.() || []; } catch { views = []; }
    viewSig = viewSignature(views);
    if (!Array.isArray(views) || !views.length) return;
    el("div", "pxd-panel__views-title", viewsList, "Views");
    for (const view of views) {
      if (!view?.uid) continue;
      const row = el("div", "pxd-view-row", viewsList);
      row.setAttribute("data-view", view.uid);
      row.append(minimapSvg(doc, { v: view.v, items: view.items || [] }));
      el("span", "pxd-view-caption", row, view.caption || "View");
      const go = el("button", "pxd-btn pxd-view-go", row, "Go");
      go.type = "button";
      go.setAttribute("data-act", "go");
      const copy = el("button", "pxd-btn pxd-view-copy", row, "Copy ref");
      copy.type = "button";
      copy.setAttribute("data-act", "copy");
      const rename = el("button", "pxd-btn pxd-view-rename", row, "Rename");
      rename.type = "button";
      rename.setAttribute("data-act", "rename");
      const del = el("button", "pxd-btn pxd-view-delete", row, "Delete");
      del.type = "button";
      del.setAttribute("data-act", "delete");
    }
  };
  listen(viewsList, "click", (event) => {
    const row = event.target?.closest?.(".pxd-view-row");
    const uid = row?.getAttribute?.("data-view");
    if (!uid) return;
    event.preventDefault?.();
    event.stopPropagation();
    const act = event.target?.closest?.("button")?.getAttribute?.("data-act");
    if (act === "go") on.goView?.(uid);
    else if (act === "copy") on.copyView?.(uid);
    else if (act === "rename") on.renameView?.(uid);
    else if (act === "delete") on.deleteView?.(uid);
  });
  const outlinePane = el("div", "pxd-panel__pane pxd-panel__pane--outline", panel);
  outlinePane.style.display = "none";
  const outlineList = el("div", "pxd-panel__list pxd-panel__outline", outlinePane);
  const journalPane = el("div", "pxd-panel__pane pxd-panel__pane--journal", panel);
  journalPane.style.display = "none";
  const journalBar = el("div", "pxd-journal__bar", journalPane);
  const journalPrev = el("button", "pxd-btn pxd-journal__prev", journalBar, "‹");
  journalPrev.type = "button";
  journalPrev.setAttribute("aria-label", "Previous day");
  const journalDate = el("div", "pxd-journal__date", journalBar);
  const journalToday = el("button", "pxd-btn pxd-journal__today", journalBar, "Today");
  journalToday.type = "button";
  journalToday.setAttribute("aria-label", "Today");
  const journalNext = el("button", "pxd-btn pxd-journal__next", journalBar, "›");
  journalNext.type = "button";
  journalNext.setAttribute("aria-label", "Next day");
  const journalList = el("div", "pxd-panel__list pxd-journal__list", journalPane);
  const infoPane = el("div", "pxd-panel__pane pxd-panel__pane--info", panel);
  infoPane.style.display = "none";
  const trailsPane = el("div", "pxd-panel__pane pxd-panel__pane--trails", panel);
  trailsPane.style.display = "none";
  const trailsBar = el("div", "pxd-trails__bar", trailsPane);
  const trailsNew = el("button", "pxd-btn pxd-trails__new", trailsBar, "New trail");
  trailsNew.setAttribute("aria-label", "New trail");
  trailsNew.type = "button";
  trailsNew.dataset.trailAction = "new";
  const trailsList = el("div", "pxd-trails__list", trailsPane);
  const changedPane = el("div", "pxd-panel__pane pxd-panel__pane--changed", panel);
  changedPane.style.display = "none";
  const changedHead = el("div", "pxd-panel__empty", changedPane);
  const changedList = el("div", "pxd-panel__list", changedPane);
  let trailSig = "";
  let trailDrag = null;
  const infoTabsBar = el("div", "pxd-panel__infotabs", infoPane);
  const infoScroll = el("div", "pxd-panel__info", infoPane);

  let tab = "search";
  let like = null;
  let related = null;
  let semTimer = null;
  let lastInputAt = 0;
  let debounce = null;
  let selected = null;
  let relatedRows = [];
  let queryId = 0;
  let journalId = 0;
  const journalNow = () => (typeof on.now === "function" ? on.now() : Date.now());
  let journalDay = startOfDay(journalNow());

  const paletteDots = (parent, palette) => {
    if (!Array.isArray(palette) || !palette.length) return;
    const wrap = el("span", "pxd-panel__dots", parent);
    for (const hex of palette.slice(0, 3)) {
      const dot = el("span", "pxd-panel__dot", wrap);
      dot.style.background = hex;
    }
  };

  const likeButton = (parent, key, name) => {
    if (!key || typeof on.searchImages !== "function") return;
    const b = el("button", "pxd-panel__row-act pxd-panel__row-like", parent);
    b.setAttribute("type", "button");
    b.setAttribute("aria-label", "More like this");
    b.setAttribute("title", "More like this");
    b.dataset.like = key;
    b.setAttribute("data-like", key);
    el("span", "bp3-icon bp3-icon-style", b).setAttribute("aria-hidden", "true");
    listenRow(b, "click", (event) => { event.stopPropagation(); startLike(key, name); });
  };

  // A PDF row: file icon, its title (two lines, query words marked), then venue · pages · page.
  const paintPdf = (r, card, terms) => {
    let info = null;
    try { info = on.pdfName?.(card) || null; } catch { info = null; }
    const title = info?.title || card.text || "PDF";
    const col = r.querySelector?.(".pxd-panel__row-col") || el("span", "pxd-panel__row-col", r);
    col.replaceChildren();
    const head = el("span", "pxd-panel__row-text pxd-panel__row-text--pdf pxd-panel__row-title", col);
    for (const seg of markTerms(title, terms)) {
      if (seg.hit) el("mark", "pxd-panel__mark", head, seg.text);
      else head.append(seg.text);
    }
    const sub = info?.sub ?? card.label ?? "";
    if (sub) el("span", "pxd-panel__row-label pxd-panel__row-sub", col, sub);
    r.classList.toggle("pxd-panel__row--loading", info?.loading === true);
    r.setAttribute("title", title);
  };

  const row = (parent, card) => {
    const { string, label, text, kind, url, thumb, palette, likeKey, likeName } = card;
    const r = el("div", "pxd-panel__row", parent);
    r.setAttribute("draggable", "true");
    r.draggable = true;
    r.dataset.string = string;
    r.setAttribute("data-string", string);
    if (card.semantic) {
      r.classList.add("pxd-panel__row--sem");
      const sem = el("span", "pxd-panel__sem", r, "≈");
      sem.setAttribute("title", "Found by meaning");
      sem.setAttribute("aria-label", "Found by meaning");
    }
    if (kind === "pdf" && typeof on.pdfName === "function") {
      r.classList.add("pxd-panel__row--pdf");
      r.dataset.pdfUrl = url || "";
      r.setAttribute("data-pdf-url", url || "");
      el("span", "bp3-icon bp3-icon-document pxd-panel__row-icon", r).setAttribute("aria-hidden", "true");
      r.pxdCard = card;
      paintPdf(r, card, queryTerms(input.value));
    }
    if (label && !thumb && !r.pxdCard) el("span", "pxd-panel__row-label", r, label);
    if (thumb) {
      r.classList.add("pxd-panel__row--image");
      const img = el("img", "pxd-panel__thumb", r);
      img.setAttribute("src", thumb);
      img.setAttribute("alt", "");
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
      img.setAttribute("width", "40");
      img.setAttribute("height", "40");
    }
    let shown = text;
    if (kind === "pdf" && url) {
      try { shown = on.pdfTitle?.(url) || text; } catch { shown = text; }
    }
    if (r.pxdCard) {
      // paintPdf drew the title column.
    } else if (thumb) {
      const col = el("span", "pxd-panel__row-col", r);
      el("span", `pxd-panel__row-text pxd-panel__row-text--${kind || "page"}`, col, shown);
      if (label) el("span", "pxd-panel__row-label pxd-panel__row-sub", col, label);
    } else {
      el("span", `pxd-panel__row-text pxd-panel__row-text--${kind || "page"}`, r, shown);
    }
    paletteDots(r, palette);
    likeButton(r, likeKey, likeName);
    if (card.meta && sort !== DEFAULT_SORT) {
      const line = metaLine(card, sort, journalNow());
      if (line) { r.classList.add("pxd-panel__row--meta"); el("span", "pxd-panel__row-meta", r, line); }
    }
    if (on.isOnBoard?.(string)) {
      r.classList.add("pxd-panel__row--on");
      el("span", "pxd-panel__row-on", r, "on board");
    }
    listenRow(r, "click", (event) => { event.stopPropagation(); on.addBeside?.(string); r.classList.add("pxd-panel__row--on"); });
    listenRow(r, "dragstart", (event) => {
      try {
        event.dataTransfer?.setData?.(CARD_MIME, string);
        event.dataTransfer?.setData?.("text/plain", string);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      } catch { /* stub */ }
    });
    return r;
  };

  const partRow = (parent, part, needle) => {
    const r = el("div", "pxd-panel__row pxd-panel__row--part", parent);
    r.setAttribute("draggable", "true");
    r.draggable = true;
    r.dataset.part = part.blockId;
    r.setAttribute("data-part", part.blockId);
    r.dataset.kind = part.kind;
    const head = el("div", "pxd-panel__part-head", r);
    el("span", `pxd-panel__badge pxd-panel__badge--${part.kind}`, head, PART_LABELS[part.kind] || part.kind);
    el("span", "pxd-panel__row-label", head, `p. ${part.page} · ${part.docTitle || "PDF"}`);
    if (typeof on.askPart === "function") {
      const ask = el("button", "pxd-panel__row-act", head);
      ask.setAttribute("type", "button");
      ask.setAttribute("aria-label", "Ask AI");
      ask.setAttribute("title", "Ask AI");
      const mark = askAiIcon(doc, 16);
      if (mark) ask.append(mark);
      listenRow(ask, "click", (event) => { event.stopPropagation(); on.askPart(part); });
    }
    if (part.kind === "figure" && typeof on.chartPart === "function") {
      const chart = el("button", "pxd-panel__row-act pxd-panel__row-chart", head);
      chart.setAttribute("type", "button");
      chart.setAttribute("aria-label", "Chart to table");
      chart.setAttribute("title", "Chart → table");
      el("span", "bp3-icon bp3-icon-timeline-line-chart", chart).setAttribute("aria-hidden", "true");
      listenRow(chart, "click", (event) => { event.stopPropagation(); on.chartPart(part); });
    }
    if (typeof on.basketPart === "function") {
      const add = el("button", "pxd-panel__row-act", head, "+");
      add.setAttribute("type", "button");
      add.setAttribute("aria-label", "Add to question");
      add.setAttribute("title", "Add to question");
      listenRow(add, "click", (event) => { event.stopPropagation(); on.basketPart(part); });
    }
    const snip = partSnippet(part.text, needle);
    const body = el("span", "pxd-panel__row-text pxd-panel__row-text--part", r);
    if (snip.before) body.append(snip.before);
    if (snip.hit) el("mark", "pxd-panel__mark", body, snip.hit);
    if (snip.after) body.append(snip.after);
    paletteDots(r, part.palette);
    if (part.kind === "figure") likeButton(head, part.key, `Figure p. ${part.page}`);
    const payload = {
      sha256: part.sha256, engine: part.engine || "builtin", optsHash: part.optsHash || "", ids: [part.blockId],
      pdfUid: part.pdfUid || "", pdfBlockUid: part.pdfUid || "",
      kind: part.kind === "table" || part.kind === "figure" || part.kind === "formula" ? part.kind : "blocks",
    };
    listenRow(r, "click", (event) => {
      event.stopPropagation();
      if (on.openPart?.(part) !== true) on.addPart?.(payload);
      r.classList.add("pxd-panel__row--on");
    });
    listenRow(r, "dragstart", (event) => {
      try {
        const json = JSON.stringify(payload);
        event.dataTransfer?.setData?.(PARSE_MIME, json);
        event.dataTransfer?.setData?.("text/plain", json);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      } catch { /* stub */ }
    });
    return r;
  };

  const readFilter = () => ({
    text: input.value,
    types: checked.size === ALL_TYPES.length ? [] : ALL_TYPES.filter((t) => checked.has(t)),
    pages: pagesInput.value,
    tag: tagInput.value,
    days: daysInput.value,
    orphan: orphanBox.checked === true,
    ...readMeta(),
  });

  const paintLike = () => {
    likeChip.style.display = like ? "" : "none";
    likeText.textContent = like ? `Like: ${like.name}` : "";
  };
  const imageName = (img) => {
    const alt = /!\[([^\]]*)\]/.exec(String(img?.string ?? ""));
    return (alt && alt[1].trim()) || String(img?.pageTitle || "").trim() || "image";
  };
  // Similarity mode: the source's palette against every indexed image and figure, nearest first.
  const runSimilar = async (id) => {
    const wantImages = checked.has("image");
    const wantFigures = checked.has("figure");
    if (!wantImages && !wantFigures) { el("div", "pxd-panel__empty", results, "Turn on Image or Figure to compare"); return; }
    let found = null;
    try { found = await Promise.resolve(on.searchImages({ like: like.key, images: wantImages, figures: wantFigures }, LIMIT)); } catch { found = null; }
    if (id !== queryId || !like) return;
    results.replaceChildren();
    if (found?.similar === false) { el("div", "pxd-panel__empty", results, "This image has no colours yet. Try again in a moment"); return; }
    const images = Array.isArray(found?.images) ? found.images : [];
    const figures = Array.isArray(found?.figures) ? found.figures : [];
    if (!images.length && !figures.length) { el("div", "pxd-panel__empty", results, "No similar images"); return; }
    const draw = (item, figure) => {
      if (figure) partRow(results, item, "");
      else row(results, { ...libraryCard({ kind: "block", uid: item.uid, string: item.string, pageTitle: item.pageTitle }), palette: item.palette, likeKey: item.key, likeName: imageName(item) });
    };
    const order = Array.isArray(found?.order) ? found.order : null;
    if (order) order.forEach((item) => draw(item, item.kind === "figure"));
    else { images.forEach((i) => draw(i, false)); figures.forEach((f) => draw(f, true)); }
  };
  const startLike = (key, name) => {
    like = { key, name: String(name || "image").slice(0, 40) };
    paintLike();
    searchNow();
  };
  const clearLike = () => {
    if (!like) return;
    like = null;
    paintLike();
    searchNow();
  };
  listen(likeClear, "click", (event) => { event.stopPropagation(); clearLike(); });
  const paintRelated = () => {
    relChip.style.display = related ? "" : "none";
    relText.textContent = related ? `Related to: ${related.label}` : "";
  };
  // Through the panel's one click listener (listenersPerBoard budget). A checkbox is already toggled at click time.
  const searchClick = (event) => {
    const t = event.target;
    if (t === relClear || relClear.contains?.(t)) { related = null; paintRelated(); searchNow(); return; }
    if (t === sortBtn || sortBtn.contains?.(t)) { setPopsOpen(sortPop.style.display === "none" ? "sort" : null); return; }
    if (t === moreBtn || moreBtn.contains?.(t)) { setPopsOpen(moreOpen() ? null : "more"); return; }
    const pick = t?.closest?.("[data-sort]")?.dataset?.sort || t?.getAttribute?.("data-sort");
    if (pick && sortItems.has(pick)) {
      sort = normalizeSort(pick);
      try { on.saveSort?.(sort); } catch { /* storage */ }
      paintSort();
      setPopsOpen(null);
      searchNow();
      return;
    }
    if (t === meaningBox) { try { on.saveMeaning?.(meaningBox.checked); } catch { /* storage */ } searchNow(); }
  };

  const semanticRowsFor = (raw, filter, parsedUrls = null) => {
    try {
      const rows = host?.semanticRows?.(raw, filter, LIMIT, { sort, parsedUrls, pdfList: typeof on.pdfList === "function" ? on.pdfList : null })?.rows || [];
      return filter.thisBoard === true ? rows.filter((c) => on.isOnBoard?.(c.string)) : rows;
    } catch { return []; }
  };
  const wantNames = (cards, opts) => {
    const pdfs = (cards || []).filter((c) => c?.kind === "pdf" && c.url);
    if (pdfs.length) { try { on.wantPdfNames?.(pdfs, opts); } catch { /* host */ } }
  };
  // Semantic hits below the keyword rows, deduped against them, each marked ≈.
  const paintSemantic = (id, cards, keywordCards) => {
    if (id !== queryId) return;
    for (const n of [...results.querySelectorAll(".pxd-panel__row--sem, .pxd-panel__sem-head")]) n.remove();
    const extra = mergeSemantic(keywordCards, cards, LIMIT);
    results.dataset.semCount = String(extra.length);
    results.setAttribute("data-sem-count", String(extra.length));
    if (!extra.length) return;
    for (const n of [...results.querySelectorAll(".pxd-panel__empty")]) n.remove();
    el("div", "pxd-panel__sem-head", results, "By meaning");
    extra.forEach((c) => row(results, c));
    wantNames(extra, { front: true });
  };
  // Parsed PDFs / PDFs with highlights apply to Meaning rows too: the host keeps only the PDF rows that pass.
  const scheduleSemantic = (id, filter, keywordCards, parsedUrls = null) => {
    const text = String(filter.text || "").trim();
    const sem = on.semantic;
    if (!text || !meaningBox.checked || !semanticOn() || typeof host?.semanticRows !== "function" || typeof sem?.search !== "function") return;
    const cached = sem.peek?.(text);
    if (cached) paintSemantic(id, semanticRowsFor(cached.data, filter, parsedUrls), keywordCards);
    if (cached && !cached.stale) return;
    const wait = Math.max(0, SEMANTIC_PAUSE_MS - (Date.now() - lastInputAt));
    semTimer = timers.later(async () => {
      semTimer = null;
      if (id !== queryId) return;
      const t0 = Date.now();
      let raw = [];
      try {
        raw = await sem.search(text, { onFresh: (data) => paintSemantic(id, semanticRowsFor(data, filter, parsedUrls), keywordCards) });
      } catch { raw = []; }
      if (id !== queryId) return;
      results.dataset.semMs = String(Date.now() - t0);
      results.setAttribute("data-sem-ms", String(Date.now() - t0));
      paintSemantic(id, semanticRowsFor(raw, filter, parsedUrls), keywordCards);
    }, wait);
  };
  // "Find related": semantic search on a card's text, nothing typed.
  const runRelated = async (id) => {
    results.replaceChildren();
    if (!semanticOn()) { el("div", "pxd-panel__empty pxd-panel__hint", results, SEMANTIC_HINT); return; }
    el("div", "pxd-panel__empty", results, "Finding related notes…");
    let raw = [];
    const t0 = Date.now();
    try { raw = await on.semantic.search(related.query); } catch { raw = []; }
    if (id !== queryId || !related) return;
    results.dataset.semMs = String(Date.now() - t0);
    results.setAttribute("data-sem-ms", String(Date.now() - t0));
    const cards = semanticRowsFor(raw, { ...readFilter(), text: "" }).filter((c) => !related.exclude || c.string !== related.exclude);
    results.replaceChildren();
    if (!cards.length) { el("div", "pxd-panel__empty", results, "No related notes"); return; }
    cards.forEach((c) => row(results, { ...c, semantic: false }));
    wantNames(cards, { front: true });
  };

  const runSearch = async ({ quiet = false } = {}) => {
    const filter = readFilter();
    paintMore();
    const id = queryId += 1;
    const started = Date.now();
    if (results.dataset.browse) { delete results.dataset.browse; results.removeAttribute?.("data-browse"); }
    semTimer?.();
    semTimer = null;
    if (!quiet || like || related) results.replaceChildren();
    if (like) { await runSimilar(id); return; }
    if (related) { await runRelated(id); return; }
    if (checked.size === 0) { results.replaceChildren(); el("div", "pxd-panel__empty", results, "No card types selected"); return; }
    // Browse lists pages by time or title only; "Most linked" and the like would need every page's numbers.
    if (!libraryFilterActive(filter) && !metaFilterActive(filter) && BROWSE_SORTS.has(sort) && typeof host?.browse === "function") {
      let found = null;
      try { found = await Promise.resolve(host.browse(sort, LIMIT)); } catch { found = null; }
      if (id !== queryId) return;
      results.replaceChildren();
      const list = Array.isArray(found?.rows) ? found.rows : [];
      if (!list.length) el("div", "pxd-panel__empty", results, "No pages");
      list.forEach((r) => row(results, r));
      return;
    }
    // Empty box + filters: the filters browse the graph themselves (filter-browse.js).
    if (wantsFilterBrowse(filter) && typeof host?.filterBrowse === "function") { await runFilterBrowse(id, filter, started); return; }
    if (!libraryFilterActive(filter)) {
      results.replaceChildren();
      if (on.semantic && !semanticOn()) el("div", "pxd-panel__empty pxd-panel__hint", results, SEMANTIC_HINT);
      return;
    }
    let pack = null;
    const wantImages = typeof on.searchImages === "function" && checked.has("image");
    const wantFigures = typeof on.searchImages === "function" && checked.has("figure");
    const hostFilter = wantImages ? { ...filter, types: ALL_TYPES.filter((t) => checked.has(t) && t !== "image") } : filter;
    try {
      if (wantImages && !hostFilter.types.length) {
        pack = { rows: [], queries: [] };
      } else if (typeof host?.librarySearch === "function") {
        pack = await Promise.resolve(host.librarySearch(hostFilter, LIMIT, { pdfMatch: on.pdfMatch, pdfList: on.pdfList, sort }));
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
            ...(blocks || []).map((b) => libraryCard({ kind: "block", uid: b.uid, string: b.string || "", pageTitle: b.pageTitle })),
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
    let rows = (Array.isArray(pack?.rows) ? pack.rows : []).slice(0, LIMIT);
    // What only the board knows: on this board, a kept parse, highlights (PDFs only).
    if (filter.thisBoard) rows = rows.filter((r) => on.isOnBoard?.(r.string));
    const parsedUrls = filter.parsed ? await parsedSet() : null;
    if (id !== queryId) return;
    if ((filter.parsed || filter.highlights) && typeof host?.pdfFilter === "function" && (!filter.parsed || parsedUrls)) {
      rows = host.pdfFilter(rows, { parsed: filter.parsed === true, highlights: filter.highlights === true, parsedUrls });
    } else if (filter.parsed || filter.highlights) {
      const pdfs = rows.filter((r) => r.kind === "pdf");
      const keep = await Promise.all(pdfs.map(async (r) => {
        try {
          if (filter.parsed && !(await on.isParsed?.(r.url))) return false;
          if (filter.highlights && !((await on.highlightCount?.(r.string)) > 0)) return false;
          return true;
        } catch { return false; }
      }));
      if (id !== queryId) return;
      const ok = new Set(pdfs.filter((_, i) => keep[i]));
      rows = rows.filter((r) => ok.has(r));
    }
    let parts = [];
    const needle = String(filter.text || "").trim();
    const kinds = checked.size === ALL_TYPES.length && !wantFigures ? [] : PARSE_PART_TYPES.filter((t) => checked.has(t) && !(wantFigures && t === "figure"));
    if (typeof on.searchParts === "function" && (checked.size === ALL_TYPES.length || kinds.length > 0)
      && (needle || kinds.length) && !filter.tag && !filter.days && filter.orphan !== true && !metaFilterActive(filter)) {
      const t0 = Date.now();
      try { parts = (await Promise.resolve(on.searchParts({ text: needle, kinds, pages: filter.pages }, LIMIT))) || []; } catch { parts = []; }
      if (id !== queryId) return;
      results.dataset.partsMs = String(Date.now() - t0);
    }
    let found = { images: [], figures: [] };
    if ((wantImages || wantFigures) && (needle || filter.types.length) && !filter.tag && !filter.days && filter.orphan !== true && !metaFilterActive(filter)) {
      try { found = (await Promise.resolve(on.searchImages({ text: needle, images: wantImages, figures: wantFigures, pages: filter.pages }, LIMIT))) || found; } catch { /* keep none */ }
      if (id !== queryId) return;
    }
    const images = Array.isArray(found.images) ? found.images : [];
    const figures = Array.isArray(found.figures) ? found.figures : [];
    results.replaceChildren();
    if (!rows.length && !parts.length && !images.length && !figures.length) el("div", "pxd-panel__empty", results, "No matches");
    rows.forEach((r) => row(results, r));
    images.forEach((img) => row(results, { ...libraryCard({ kind: "block", uid: img.uid, string: img.string, pageTitle: img.pageTitle }), palette: img.palette, likeKey: img.key, likeName: imageName(img) }));
    parts.forEach((part) => partRow(results, part, needle));
    figures.forEach((part) => partRow(results, part, needle));
    results.dataset.paintMs = String(Date.now() - started);
    results.setAttribute("data-paint-ms", String(Date.now() - started));
    // The whole PDF list is read only when PDFs are what the user filters for.
    wantNames(rows, { front: true, all: checked.has("pdf") && checked.size < ALL_TYPES.length });
    scheduleSemantic(id, filter, rows, parsedUrls);
  };

  // The local parse store's PDF urls (Parsed PDFs). Null when the board does not say.
  const parsedSet = async () => {
    if (typeof on.parsedUrls !== "function") return null;
    try { const got = await on.parsedUrls(); return got instanceof Set ? got : new Set(Array.isArray(got) ? got : []); } catch { return null; }
  };
  const runFilterBrowse = async (id, filter, started) => {
    const parsedUrls = filter.parsed ? await parsedSet() : null;
    if (id !== queryId) return;
    let pack = null;
    try {
      pack = await Promise.resolve(host.filterBrowse(filter, LIMIT, {
        sort,
        parsedUrls,
        pdfList: typeof on.pdfList === "function" ? on.pdfList : null,
        keep: filter.thisBoard ? (s) => on.isOnBoard?.(s) === true : null,
      }));
    } catch { pack = null; }
    if (id !== queryId) return;
    const queries = Array.isArray(pack?.queries) ? pack.queries : [];
    const log = JSON.stringify(queries.map((q) => ({ name: q.name, ms: Math.round((Number(q.ms) || 0) * 10) / 10 })));
    results.dataset.queryLog = log;
    results.setAttribute("data-query-log", log);
    results.replaceChildren();
    const rows = Array.isArray(pack?.rows) ? pack.rows : [];
    if (pack?.defaulted && rows.length) el("div", "pxd-panel__empty pxd-panel__hint pxd-panel__window", results, DEFAULT_WINDOW_NOTE);
    if (!rows.length) el("div", "pxd-panel__empty", results, browseEmptyText(pack?.spec));
    rows.forEach((r) => row(results, r));
    results.dataset.browse = "filter";
    results.setAttribute("data-browse", "filter");
    results.dataset.paintMs = String(Date.now() - started);
    results.setAttribute("data-paint-ms", String(Date.now() - started));
    wantNames(rows, { front: true });
  };

  let refreshTimer = null;
  const scheduleSearch = () => {
    debounce?.();
    debounce = timers.later(() => { debounce = null; void runSearch(); }, DEBOUNCE_MS);
  };
  const searchNow = () => { debounce?.(); debounce = null; void runSearch(); };
  // Filter changes (More, the days box) wait for a pause, so flipping several runs one search.
  const scheduleFilter = () => {
    paintMore();
    debounce?.();
    debounce = timers.later(() => { debounce = null; void runSearch(); }, FILTER_DEBOUNCE_MS);
  };
  listen(input, "input", () => {
    lastInputAt = Date.now();
    try { on.typing?.(); } catch { /* host */ }
    if (like) { like = null; paintLike(); }
    if (related) { related = null; paintRelated(); }
    paintSwatches();
    scheduleSearch();
  });
  const paintSwatches = () => {
    const have = new Set(input.value.toLowerCase().split(/\s+/));
    for (const [name, b] of swatchBtns) b.setAttribute("aria-pressed", have.has(name) ? "true" : "false");
  };
  listen(swatches, "click", (event) => {
    const name = event.target?.closest?.("[data-color]")?.dataset?.color;
    if (!name) return;
    const tokens = input.value.split(/\s+/).filter(Boolean);
    const at = tokens.findIndex((t) => t.toLowerCase() === name);
    if (at >= 0) tokens.splice(at, 1); else tokens.push(name);
    input.value = tokens.join(" ");
    if (like) { like = null; paintLike(); }
    paintSwatches();
    searchNow();
  });
  listen(tagInput, "input", scheduleSearch);
  listen(daysInput, "input", scheduleFilter);
  listen(pagesInput, "input", scheduleSearch);
  const saveTypes = () => { try { on.saveTypes?.([...checked]); } catch { /* storage */ } };
  const changeTypes = () => { paintTypes(); saveTypes(); searchNow(); };
  listen(typeBtn, "click", (event) => {
    event.stopPropagation();
    setTypesOpen(!typesOpen());
  });
  listen(showAll, "click", () => { checked = new Set(ALL_TYPES); changeTypes(); });
  listen(hideAll, "click", () => { checked = new Set(); changeTypes(); });
  listen(typePop, "change", (event) => {
    const box = event.target;
    const value = box?.dataset?.type;
    if (!ALL_TYPES.includes(value)) return;
    if (box.checked) checked.add(value);
    else checked.delete(value);
    changeTypes();
  });
  listen(panel, "click", (event) => {
    const u = event.target;
    const inside = (n) => u && (n === u || n.contains?.(u));
    if ((sortPop.style.display !== "none" && !inside(sortPop) && !inside(sortBtn)) || (moreOpen() && !inside(morePop) && !inside(moreBtn))) setPopsOpen(null);
    if (!typesOpen()) return;
    const t = event.target;
    if (t && (typePop.contains?.(t) || typeBtn.contains?.(t) || t === typeBtn)) return;
    setTypesOpen(false);
  });
  listen(typePop, "keydown", (event) => {
    if (event.key === "Escape") { event.stopPropagation(); setTypesOpen(false); try { typeBtn.focus?.(); } catch { /* stub */ } }
  });
  morePop.append(orphanLabel);
  listen(morePop, "change", scheduleFilter);
  // Page titles for the Under page box: one title search after a pause in typing, not one per key (each scans every title).
  let underTimer = null;
  let underAsked = "";
  const underKey = (event) => {
    if (event.target !== underInput) return;
    const q = underInput.value.trim();
    if (q === underAsked) return;
    underAsked = q;
    underTimer?.();
    underTimer = null;
    if (q.length < 2) { underList.replaceChildren(); return; }
    underTimer = timers.later(() => {
      underTimer = null;
      let found = [];
      try { found = host?.searchPages?.(q, 12) || []; } catch { found = []; }
      underList.replaceChildren();
      for (const p of found) { const o = el("option", "", underList); o.value = p.title; o.setAttribute("value", p.title); }
    }, UNDER_PAUSE_MS);
  };
  listen(input, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); api.close(); }
    if (event.key === "Enter") { event.preventDefault(); searchNow(); }
  });
  for (const field of [tagInput, daysInput, pagesInput]) {
    listen(field, "keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); searchNow(); }
    });
  }

  const setTab = (next) => {
    setTypesOpen(false);
    setPopsOpen(null);
    if (tab === "info" && next !== "info") unmountInfo();
    tab = next;
    for (const [name, b] of Object.entries(tabButtons)) b.classList.toggle("pxd-panel__tab--on", tab === name);
    searchPane.style.display = tab === "search" ? "" : "none";
    relatedPane.style.display = tab === "related" ? "" : "none";
    boardsPane.style.display = tab === "boards" ? "" : "none";
    outlinePane.style.display = tab === "outline" ? "" : "none";
    journalPane.style.display = tab === "journal" ? "" : "none";
    infoPane.style.display = tab === "info" ? "" : "none";
    trailsPane.style.display = tab === "trails" ? "" : "none";
    changedPane.style.display = tab === "changed" ? "" : "none";
    if (tab === "changed") { on.loadChanged?.(); renderChanged(); }
    if (tab === "related") void loadRelated();
    if (tab === "boards") void loadBoards();
    if (tab === "outline") renderOutline();
    if (tab === "journal") void loadJournal();
    if (tab === "info") void loadInfo();
    if (tab === "trails") renderTrails();
  };
  const renderChanged = () => {
    let model = null;
    try { model = on.listChanged?.() || null; } catch { model = null; }
    changedList.replaceChildren();
    if (!model || !model.on) {
      changedHead.textContent = "Turn on Changed since last visit in the board menu";
      return;
    }
    if (!model.hasBaseline) {
      changedHead.textContent = "No earlier visit on this device yet";
      return;
    }
    const rows = model.rows || [];
    changedHead.textContent = `Changed (${rows.length})`;
    for (const row of rows) {
      const node = el("button", "pxd-btn pxd-changed__row", changedList, row.title || "Card");
      node.type = "button";
      node.dataset.changed = row.uid;
      node.setAttribute("data-changed", row.uid);
      const meta = el("span", "pxd-changed__meta", node, `${row.user ? `${row.user}, ` : ""}${timeAgo(row.time)}`);
      meta.setAttribute("aria-hidden", "true");
    }
  };
  const changedClick = (event) => {
    const node = event.target?.closest?.("[data-changed]");
    if (!node || !changedPane.contains(node)) return;
    event.preventDefault?.();
    on.selectChanged?.(node.dataset.changed || node.getAttribute?.("data-changed"));
  };
  const renderTrails = () => {
    let trails = [];
    let active = "";
    try { trails = on.listTrails?.() || []; } catch { trails = []; }
    try { active = on.activeTrail?.() || ""; } catch { active = ""; }
    const sig = `${active}|${trails.map((t) => `${t.uid}:${t.name}:${(t.stops || []).map((s) => `${s.uid}${s.ref}${s.note}`).join(",")}`).join(";")}`;
    if (sig === trailSig) return;
    trailSig = sig;
    // POL-4. A repaint after Alt+arrow keeps keyboard focus on the same stop.
    const focusedStop = trailsList.contains?.(doc.activeElement) ? doc.activeElement?.dataset?.stop || "" : "";
    trailsList.replaceChildren();
    if (!trails.length) {
      el("div", "pxd-panel__empty", trailsList, "No trails yet");
      return;
    }
    for (const trail of trails) {
      const row = el("div", `pxd-trail-row${trail.uid === active ? " pxd-trail-row--on" : ""}`, trailsList);
      row.dataset.trail = trail.uid;
      const head = el("div", "pxd-trail__head", row);
      const name = el("button", "pxd-btn pxd-trail__name", head, trail.name || "Trail");
      name.type = "button";
      name.dataset.trailAction = "select";
      name.dataset.trail = trail.uid;
      name.setAttribute("aria-label", trail.name || "Trail");
      const rename = el("button", "pxd-btn pxd-trail__rename", head, "Rename");
      rename.type = "button";
      rename.dataset.trailAction = "rename";
      rename.dataset.trail = trail.uid;
      rename.setAttribute("aria-label", "Rename trail");
      const walk = el("button", "pxd-btn pxd-trail__walk", head, "Walk");
      walk.type = "button";
      walk.dataset.trailAction = "walk";
      walk.dataset.trail = trail.uid;
      walk.setAttribute("aria-label", "Walk trail");
      const del = el("button", "pxd-btn pxd-trail__delete", head, "Delete");
      del.type = "button";
      del.dataset.trailAction = "delete";
      del.dataset.trail = trail.uid;
      del.setAttribute("aria-label", "Delete trail");
      const stops = el("ol", "pxd-trail__stops", row);
      for (const stop of trail.stops || []) {
        let title = stop.ref;
        try { title = on.stopTitle?.(stop.ref) || stop.ref; } catch { title = stop.ref; }
        const li = el("li", "pxd-trail__stop", stops, title || "Trail stop");
        li.dataset.stop = stop.uid;
        li.dataset.trail = trail.uid;
        li.dataset.ref = stop.ref || "";
        li.dataset.trailAction = "grip";
        li.tabIndex = 0;
        li.setAttribute("tabindex", "0");
        li.setAttribute("role", "button");
        li.setAttribute("aria-label", title || "Trail stop");
        if (stop.note) el("div", "pxd-trail__note", li, stop.note);
        if (focusedStop && stop.uid === focusedStop) {
          try { li.focus({ preventScroll: true }); } catch { li.focus?.(); }
        }
      }
    }
  };
  const trailClick = (event) => {
    const node = event.target?.closest?.("[data-trail-action]");
    if (!node || !trailsPane.contains(node)) return;
    const action = node.dataset.trailAction || node.getAttribute?.("data-trail-action");
    const id = node.dataset.trail || node.getAttribute?.("data-trail") || "";
    if (action === "grip") return;
    event.preventDefault?.();
    if (action === "new") on.newTrail?.();
    else if (action === "select" && id) { on.selectTrail?.(id); trailSig = ""; renderTrails(); }
    else if (action === "rename" && id) on.renameTrail?.(id);
    else if (action === "delete" && id) on.deleteTrail?.(id);
    else if (action === "walk" && id) on.walkTrail?.(id);
  };
  const trailKey = (event) => {
    const stop = event.target?.closest?.(".pxd-trail__stop");
    if (!stop || !trailsPane.contains(stop)) return;
    const key = event.key;
    if ((key === "ArrowUp" || key === "ArrowDown") && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault?.();
      const items = [...stop.parentElement.querySelectorAll(".pxd-trail__stop")];
      const index = items.indexOf(stop);
      const next = index + (key === "ArrowDown" ? 1 : -1);
      if (index < 0 || next < 0 || next >= items.length) return;
      const list = stop.parentElement;
      if (key === "ArrowDown") {
        const after = items[next].nextElementSibling;
        if (after) list.insertBefore(stop, after);
        else list.append(stop);
      } else list.insertBefore(stop, items[next]);
      on.moveStop?.(stop.dataset.stop, next);
      try { stop.focus({ preventScroll: true }); } catch { stop.focus?.(); }
      return;
    }
    if ((key === "Enter" || key === " ") && !event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault?.();
      const id = stop.dataset.trail || "";
      if (id) on.walkTrail?.(id, stop.dataset.ref || "");
    }
  };
  // Document pointermove exists only while a stop is being dragged, then it is removed.
  const trailPointerDown = (event) => {
    if (event.button !== 0) return;
    const node = event.target?.closest?.("[data-trail-action=grip]");
    if (!node || !trailsPane.contains(node)) return;
    const list = node.parentElement;
    if (!list) return;
    const rows = [...list.querySelectorAll("[data-stop]")];
    const startIndex = rows.indexOf(node);
    trailDrag = { el: node, list, startIndex, y: event.clientY, moved: false, uid: node.dataset.stop };
    const move = (ev) => {
      if (!trailDrag) return;
      if (!trailDrag.moved && Math.abs(ev.clientY - trailDrag.y) < 4) return;
      trailDrag.moved = true;
      const items = [...trailDrag.list.querySelectorAll("[data-stop]")];
      let before = null;
      for (const row of items) {
        if (row === trailDrag.el) continue;
        const box = row.getBoundingClientRect?.();
        if (box && ev.clientY < box.top + box.height / 2) { before = row; break; }
      }
      if (before) trailDrag.list.insertBefore(trailDrag.el, before);
      else trailDrag.list.append(trailDrag.el);
    };
    const up = () => {
      doc.removeEventListener?.("pointermove", move);
      doc.removeEventListener?.("pointerup", up);
      const drag = trailDrag;
      trailDrag = null;
      if (!drag?.moved) return;
      const index = [...drag.list.querySelectorAll("[data-stop]")].indexOf(drag.el);
      if (index < 0 || index === drag.startIndex) return;
      on.moveStop?.(drag.uid, index);
    };
    doc.addEventListener?.("pointermove", move);
    doc.addEventListener?.("pointerup", up);
  };
  // One delegated listener for every tab button (FAST-1 listenersPerBoard).
  listen(tabs, "click", (event) => {
    const b = event.target?.closest?.(".pxd-panel__tab");
    const name = b?.dataset?.tab;
    if (name && tabs.contains?.(b) && Object.prototype.hasOwnProperty.call(tabButtons, name)) setTab(name);
  });
  listen(closeBtn, "click", () => api.close());

  // Journal rows drag onto the board. A click does not add a card.
  const journalRow = (parent, item) => {
    const uid = String(item?.uid || "");
    if (!uid) return null;
    const string = item.string || `((${uid}))`;
    const r = el("div", "pxd-panel__row pxd-journal__row", parent);
    r.setAttribute("draggable", "true");
    r.draggable = true;
    r.dataset.string = string;
    r.setAttribute("data-string", string);
    r.dataset.uid = uid;
    r.setAttribute("data-uid", uid);
    el("span", "pxd-panel__row-text pxd-panel__row-text--block", r, item.text ?? "");
    listenRow(r, "click", (event) => {
      event.preventDefault?.();
      event.stopPropagation();
    });
    listenRow(r, "dragstart", (event) => {
      try {
        event.dataTransfer?.setData?.(CARD_MIME, string);
        event.dataTransfer?.setData?.("text/plain", string);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      } catch { /* stub */ }
    });
    return r;
  };
  const renderJournal = (pack) => {
    journalList.replaceChildren();
    journalDate.textContent = pack?.title || dailyTitle(journalDay);
    const rows = Array.isArray(pack?.rows) ? pack.rows : [];
    if (!rows.length) {
      el("div", "pxd-panel__empty pxd-journal__empty", journalList, "Nothing on this day.");
      return;
    }
    for (const item of rows) journalRow(journalList, item);
  };
  const loadJournal = async () => {
    const id = journalId += 1;
    const day = journalDay;
    journalDate.textContent = dailyTitle(day);
    let pack = { title: dailyTitle(day), rows: [] };
    try {
      if (typeof on.loadJournal === "function") pack = await Promise.resolve(on.loadJournal(day)) || pack;
    } catch { pack = { title: dailyTitle(day), rows: [] }; }
    if (id !== journalId || tab !== "journal") return;
    renderJournal(pack);
  };
  const stepJournal = (delta) => {
    journalDay = delta === 0 ? startOfDay(journalNow()) : stepDay(journalDay, delta);
    void loadJournal();
  };
  // One listener for the day stepper (FAST-1 listenersPerBoard).
  listen(journalBar, "click", (event) => {
    const t = event.target;
    if (journalPrev.contains?.(t)) stepJournal(-1);
    else if (journalToday.contains?.(t)) stepJournal(0);
    else if (journalNext.contains?.(t)) stepJournal(1);
  });
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
      add.setAttribute("aria-label", "Add shortcut");
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
    renderViews();
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
      name.setAttribute("aria-label", name.textContent || "Untitled");
      name.dataset.uid = t.uid;
      name.setAttribute("data-uid", t.uid);
      const closer = el("button", "pxd-btn pxd-panel__infotab-x", row, "×");
      closer.type = "button";
      closer.title = "Close";
      closer.setAttribute("aria-label", "Close");
      closer.dataset.uid = t.uid;
      closer.setAttribute("data-uid", t.uid);
    }
  };
  // Inline boards are too narrow for a second editor. Fullscreen mounts Roam's renderer in the panel.
  let infoMounted = false;
  let timelineView = null;
  const unmountInfo = () => {
    if (timelineView) {
      try { timelineView.dispose(); } catch { /* already gone */ }
      timelineView = null;
    }
    if (!infoMounted) return;
    infoMounted = false;
    const prev = infoScroll.querySelector(".pxd-panel__info-mount");
    if (prev) {
      try { host?.unmount?.(prev); } catch { /* already gone */ }
    }
  };
  // No heading: the Info heading list is an exact snapshot in unowned tests.
  // The section is created after the query so a superseded load does not leave buttons behind.
  const paintTimeline = async (id) => {
    if (id !== queryId || tab !== "info") return;
    if (infoScroll.isConnected === false) return;
    let rows = [];
    try {
      const got = await Promise.resolve(on.ensureTimeline?.());
      rows = Array.isArray(got) ? got : [];
    } catch { rows = []; }
    if (id !== queryId || tab !== "info") return;
    if (infoScroll.isConnected === false) return;
    if (timelineView) {
      try { timelineView.dispose(); } catch { /* already gone */ }
      timelineView = null;
    }
    const section = el("section", "pxd-panel__info-sec", infoScroll);
    timelineView = mountTimeline(section, {
      doc,
      rows,
      onOpenDay: (pageUid) => { try { on.openDay?.(pageUid); } catch { /* host */ } },
      onShowOnBoard: (uids) => { try { on.showOnBoard?.(uids); } catch { /* host */ } },
    });
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
      void paintTimeline(id);
      return;
    }
    let info = null;
    try { info = await Promise.resolve(host?.cardInfo?.(subject)) ?? null; } catch { info = null; }
    if (id !== queryId || tab !== "info") return;
    unmountInfo();
    infoScroll.replaceChildren();
    if (!info) {
      el("div", "pxd-panel__empty", infoScroll, "Nothing to show");
      void paintTimeline(id);
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
    let contextText = "";
    try {
      const line = await Promise.resolve(on.contextLine?.(subject));
      contextText = typeof line === "string" ? line : "";
    } catch { contextText = ""; }
    if (id !== queryId || tab !== "info") return;
    if (contextText) {
      const ctxSec = infoSection("Context");
      el("div", "pxd-panel__info-context", ctxSec, contextText);
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
      row.setAttribute("aria-label", ref.string || ref.uid);
      row.dataset.uid = ref.uid;
      row.setAttribute("data-uid", ref.uid);
      if (ref.pageTitle) row.title = ref.pageTitle;
    }
    const boardSec = infoSection("On boards");
    if (!info.boards?.length) el("div", "pxd-panel__empty", boardSec, "Not on another board");
    else for (const board of info.boards) {
      const row = el("button", "pxd-btn pxd-panel__info-board", boardSec);
      row.type = "button";
      row.setAttribute("aria-label", board.title || "Untitled board");
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
    void paintTimeline(id);
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
      paintMeaning();
      panel.style.display = "";
      root.setAttribute("data-pxd-panel-open", "");
      setTab(which);
      on.opened?.(true);
      const focusTarget = which === "search" ? input : which === "boards" ? boardsFilter : null;
      if (focusTarget) { try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus?.(); } }
    },
    currentTab: () => tab,
    setIndexing(n) {
      const count = Math.max(0, Math.floor(Number(n) || 0));
      indexNote.textContent = count ? `Indexing ${count} ${count === 1 ? "image" : "images"}…` : "";
      indexNote.style.display = count ? "" : "none";
    },
    refreshOutline() { if (api.isOpen() && tab === "outline") renderOutline(); },
    refreshSearch() {
      if (!api.isOpen() || tab !== "search" || !String(input.value || "").trim()) return;
      refreshTimer?.();
      refreshTimer = timers.later(() => { refreshTimer = null; searchNow(); }, 300);
    },
    refreshBoards() { if (tab === "boards") void loadBoards(); },
    // PDF identities landed: rows repaint in place; a PDF the typed words now match brings a quiet re-search.
    refreshPdfNames(urls) {
      if (!api.isOpen() || tab !== "search") return;
      const set = new Set(Array.isArray(urls) ? urls : []);
      const terms = queryTerms(input.value);
      const shown = new Set();
      for (const r of results.querySelectorAll(".pxd-panel__row--pdf")) {
        const url = r.dataset?.pdfUrl || r.getAttribute("data-pdf-url") || "";
        shown.add(url);
        if (r.pxdCard && (!set.size || set.has(url))) paintPdf(r, r.pxdCard, terms);
      }
      if (!terms.length || like || related || !checked.has("pdf") || typeof on.pdfMatch !== "function") return;
      const fresh = [...set].some((url) => { if (shown.has(url)) return false; try { return Boolean(on.pdfMatch(url, terms)); } catch { return false; } });
      if (!fresh) return;
      refreshTimer?.();
      refreshTimer = timers.later(() => { refreshTimer = null; void runSearch({ quiet: true }); }, 400);
    },
    // Card menu "Find related": semantic results for the card's text, ready to drag onto the board.
    findRelated({ query = "", label = "", exclude = "" } = {}) {
      const text = String(query || "").trim().slice(0, 600);
      if (like) { like = null; paintLike(); }
      related = { query: text, label: String(label || "this card").replace(/\s+/g, " ").trim().slice(0, 40), exclude: String(exclude || "") };
      paintRelated();
      input.value = "";
      api.open("search");
      searchNow();
    },
    relatedQuery: () => related?.query || "",
    refreshChanged() { if (tab === "changed" && api.isOpen()) renderChanged(); },
    refreshTrails() {
      if (tab !== "trails" || !api.isOpen()) return;
      trailSig = "";
      renderTrails();
    },
    refreshViews() {
      if (tab !== "boards" || !api.isOpen()) return;
      let views = [];
      try { views = on.listViews?.() || []; } catch { views = []; }
      if (viewSignature(views) === viewSig) return;
      renderViews();
    },
    close() {
      setTypesOpen(false);
      // A quiet re-search waiting for a name or a refresh has nothing to show on a hidden panel.
      refreshTimer?.();
      refreshTimer = null;
      if (tab === "info") unmountInfo();
      panel.style.display = "none";
      root.removeAttribute("data-pxd-panel-open");
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
      semTimer?.();
      underTimer?.();
      queryId += 1;
      journalId += 1;
      unmountInfo();
      listeners.splice(0).forEach((off) => off());
      rowOffs.splice(0).forEach((entry) => entry.off());
      panel.remove();
    },
  };
  return api;
}
