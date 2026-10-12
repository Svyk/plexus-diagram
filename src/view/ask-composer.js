// The Ask AI window's composer row and its menus, in the style of Live AI Assistant's chat composer: icon buttons
// (tools, context, style, Prompts, model, thinking, agents, more), one popover at a time, and the suggestion list that
// / commands and [[ # (( mentions open above the question. Generic: the conversation in ask-ai.js decides what the
// menus hold and what a pick does. Menus are built when opened, never while hidden.

const make = (doc, tag, cls, parent, text) => {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  if (parent) parent.append(node);
  return node;
};
const clear = (node) => {
  if (node.replaceChildren) node.replaceChildren();
  else while (node.firstChild) node.removeChild(node.firstChild);
};

// Blueprint icon names (Roam ships the Blueprint icon font) for the row, as in Live AI's composer.
export const ROW_ICONS = Object.freeze({ tools: "wrench", context: "locate", style: "edit", prompts: "rocket", model: "cog", effort: "predictive-analysis", agents: "people", more: "more" });

export function iconButton(doc, parent, { cls, icon, label, text = "" }) {
  const b = make(doc, "button", `pxd-ask__rowbtn ${cls}`, parent);
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.setAttribute("title", label);
  b.setAttribute("aria-haspopup", "menu");
  b.setAttribute("aria-expanded", "false");
  const i = make(doc, "span", `bp3-icon bp3-icon-${icon} pxd-ask__rowicon`, b);
  i.setAttribute("aria-hidden", "true");
  if (text) make(doc, "span", "pxd-ask__rowtext", b, text);
  return b;
}

// One popover over the composer. sections: [{ title?, items: [{ label, detail?, checked?, disabled?, onPick, keep? ,
// input? }] }]; opts: { filter: placeholder for a filter box, empty: text when nothing matches, anchor }.
// Keyboard: arrows move, Enter/Space picks, Escape closes and gives focus back to the anchor.
export function createPopover(doc, host) {
  let el = null;
  let anchor = null;
  let rows = [];
  let at = -1;
  let spec = null;
  let filterBox = null;
  let list = null;

  const highlight = (i) => {
    rows.forEach((r, k) => r.classList.toggle("pxd-ask__mitem--active", k === i));
    at = i;
    const r = rows[i];
    if (r) { try { r.scrollIntoView?.({ block: "nearest" }); } catch { /* stub */ } }
  };
  const pick = (i) => {
    const r = rows[i];
    if (!r || r.disabled) return;
    const item = r._item;
    if (!item.keep) close({ refocus: false });
    try { item.onPick?.(item); } catch { /* host */ }
    if (item.keep && el) paint();
  };
  const paint = () => {
    if (!el || !spec) return;
    const sections = typeof spec.sections === "function" ? spec.sections(filterBox ? filterBox.value : "") : spec.sections;
    clear(list);
    rows = [];
    for (const sec of sections || []) {
      if (!sec?.items?.length) continue;
      if (sec.title) make(doc, "div", "pxd-ask__mhead", list, sec.title);
      for (const item of sec.items) {
        if (item.input) {
          const wrap = make(doc, "label", "pxd-ask__mfield", list);
          make(doc, "span", "", wrap, item.label);
          const inp = make(doc, "input", "pxd-ask__mnum", wrap);
          inp.type = "number";
          inp.min = "1";
          inp.max = "365";
          inp.value = String(item.value ?? "");
          inp.setAttribute("aria-label", item.label);
          inp.addEventListener("change", () => { try { item.onInput?.(inp.value); } catch { /* host */ } });
          continue;
        }
        const b = make(doc, "button", `pxd-ask__mitem${item.checked ? " pxd-ask__mitem--on" : ""}`, list);
        b.type = "button";
        b.setAttribute("role", item.checked != null ? "menuitemcheckbox" : "menuitem");
        if (item.checked != null) b.setAttribute("aria-checked", item.checked ? "true" : "false");
        if (item.id != null) b.setAttribute("data-id", item.id);
        b.tabIndex = -1;
        if (item.checked != null) make(doc, "span", "pxd-ask__mcheck", b, item.checked ? "✓" : "");
        make(doc, "span", "pxd-ask__mlabel", b, item.label);
        if (item.detail) make(doc, "span", "pxd-ask__mdetail", b, item.detail);
        b.disabled = Boolean(item.disabled);
        b._item = item;
        const k = rows.length;
        b.addEventListener("click", (event) => { event.preventDefault?.(); pick(k); });
        b.addEventListener("pointermove", () => { if (at !== k) highlight(k); });
        rows.push(b);
      }
    }
    if (!rows.length && spec.empty) make(doc, "div", "pxd-ask__mempty", list, spec.empty);
    highlight(rows.length ? Math.min(Math.max(at, 0), rows.length - 1) : -1);
  };
  // A press anywhere else closes the menu (its own button toggles it).
  const outside = (event) => {
    const t = event.target;
    if (!el || el === t || el.contains?.(t) || anchor === t || anchor?.contains?.(t)) return;
    close({ refocus: false });
  };
  const onKey = (event) => {
    const k = event.key;
    if (k === "Escape") { event.preventDefault?.(); event.stopPropagation?.(); close(); return; }
    if (k === "ArrowDown" || k === "ArrowUp") {
      event.preventDefault?.();
      if (!rows.length) return;
      highlight((at + (k === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
      if (event.target !== filterBox) rows[at]?.focus?.();
      return;
    }
    if ((k === "Enter" || (k === " " && event.target !== filterBox)) && at >= 0 && !event.target?.classList?.contains?.("pxd-ask__mnum")) {
      event.preventDefault?.();
      pick(at);
    }
  };
  function open(spec2, anchorEl) {
    const same = el && anchor === anchorEl;
    close({ refocus: false });
    if (same) return false;
    spec = spec2;
    anchor = anchorEl || null;
    at = 0;
    el = make(doc, "div", `pxd-ask__menu${spec.cls ? ` ${spec.cls}` : ""}`, host);
    el.setAttribute("role", "menu");
    if (spec.label) el.setAttribute("aria-label", spec.label);
    el.addEventListener("keydown", onKey);
    if (spec.filter) {
      filterBox = make(doc, "input", "pxd-ask__mfilter", el);
      filterBox.type = "text";
      filterBox.setAttribute("placeholder", spec.filter);
      filterBox.setAttribute("aria-label", spec.filter);
      filterBox.addEventListener("input", () => { at = 0; paint(); });
    }
    list = make(doc, "div", "pxd-ask__mlist", el);
    paint();
    anchor?.setAttribute?.("aria-expanded", "true");
    doc.addEventListener?.("pointerdown", outside, true);
    try { (filterBox || rows[0] || el).focus?.(); } catch { /* stub */ }
    return true;
  }
  function close({ refocus = true } = {}) {
    if (!el) return false;
    doc.removeEventListener?.("pointerdown", outside, true);
    try { el.remove(); } catch { /* gone */ }
    el = null;
    filterBox = null;
    list = null;
    rows = [];
    spec = null;
    anchor?.setAttribute?.("aria-expanded", "false");
    const a = anchor;
    anchor = null;
    if (refocus) { try { a?.focus?.(); } catch { /* stub */ } }
    return true;
  }
  return {
    open,
    close,
    refresh: () => paint(),
    get isOpen() { return Boolean(el); },
    get element() { return el; },
    get anchor() { return anchor; },
    items: () => rows.map((r) => r._item),
    pick,
    contains: (node) => Boolean(el && node && (el === node || el.contains?.(node))),
  };
}

// The suggestion list above the question, driven from the question's keydown: [{ label, detail?, item }].
export function createSuggest(doc, host) {
  let el = null;
  let rows = [];
  let at = 0;
  let onPick = null;
  const highlight = (i) => {
    at = i;
    rows.forEach((r, k) => {
      r.classList.toggle("pxd-ask__sitem--active", k === i);
      r.setAttribute("aria-selected", k === i ? "true" : "false");
    });
    try { rows[i]?.scrollIntoView?.({ block: "nearest" }); } catch { /* stub */ }
  };
  const pick = (i = at) => {
    const r = rows[i];
    if (!r) return false;
    const fn = onPick;
    const entry = r._entry;
    hide();
    try { fn?.(entry); } catch { /* host */ }
    return true;
  };
  function show(entries, { title = "", pick: fn, empty = "" } = {}) {
    if (!el) {
      el = make(doc, "div", "pxd-ask__suggest", host);
      el.setAttribute("role", "listbox");
      el.addEventListener("pointerdown", (event) => event.preventDefault?.());
    }
    clear(el);
    rows = [];
    onPick = fn;
    if (title) make(doc, "div", "pxd-ask__shead", el, title);
    let lastGroup = "";
    for (const entry of entries || []) {
      if (entry.group && entry.group !== lastGroup) { make(doc, "div", "pxd-ask__sgroup", el, entry.group); lastGroup = entry.group; }
      const r = make(doc, "div", "pxd-ask__sitem", el);
      r.setAttribute("role", "option");
      make(doc, "span", "pxd-ask__slabel", r, entry.label);
      if (entry.detail) make(doc, "span", "pxd-ask__sdetail", r, entry.detail);
      r._entry = entry;
      const k = rows.length;
      r.addEventListener("click", () => pick(k));
      r.addEventListener("pointermove", () => { if (at !== k) highlight(k); });
      rows.push(r);
    }
    if (!rows.length && empty) make(doc, "div", "pxd-ask__sempty", el, empty);
    el.hidden = false;
    highlight(0);
  }
  function hide() {
    if (!el) return;
    el.hidden = true;
    clear(el);
    rows = [];
    onPick = null;
  }
  // true when the key was the list's.
  function key(event) {
    if (!el || el.hidden) return false;
    const k = event.key;
    if (k === "Escape") { hide(); return true; }
    if (!rows.length) return false;
    if (k === "ArrowDown" || k === "ArrowUp") { highlight((at + (k === "ArrowDown" ? 1 : -1) + rows.length) % rows.length); return true; }
    if (k === "Enter" || k === "Tab") return pick();
    return false;
  }
  return {
    show,
    hide,
    key,
    pick,
    get isOpen() { return Boolean(el && !el.hidden); },
    entries: () => rows.map((r) => r._entry),
    get element() { return el; },
  };
}
