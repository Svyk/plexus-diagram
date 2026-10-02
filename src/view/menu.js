// Context menu component (spec 1.2 D). Renders a menu model (see menu-model.js) inside the root:
// .pxd-menu.pxd-chrome with .pxd-menu__item rows, separators, hints and hover / ArrowRight submenus.
// Coordinates passed to open() are client coordinates; the menu converts them to root space and clamps.
// One delegated click and pointerover listener serve the whole menu, so a close leaves nothing behind.

const MARGIN = 4;
const ROW_HEIGHT = 28;
const MENU_WIDTH = 200;
const STOP_EVENTS = ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu", "keydown"];

export function createMenu({ doc = globalThis.document, root, on = {} } = {}) {
  let menuEl = null;
  let offs = [];
  const entries = new Map(); // element -> { item, level }
  const levels = []; // levels[0] is the top list; deeper levels are open submenus
  let disposed = false;

  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    parent?.append(node);
    return node;
  };
  const on_ = (target, type, fn, capture) => {
    target.addEventListener(type, fn, capture);
    offs.push(() => target.removeEventListener(type, fn, capture));
  };

  const selectable = (level) => level.rows.filter((row) => !entries.get(row).item.disabled);
  const setActive = (level, row) => {
    for (const r of level.rows) r.classList.toggle("pxd-menu__item--active", r === row);
    level.active = row || null;
    if (row && level.depth === 0 && menuEl?.classList?.contains("pxd-menu--scroll")) row.scrollIntoView?.({ block: "nearest" });
  };
  const closeFrom = (depth) => {
    while (levels.length > depth) {
      const level = levels.pop();
      level.container.style.display = "none";
      level.container.classList?.remove("pxd-menu__sub--open");
      setActive(level, null);
    }
  };

  const placeSub = (sub, row) => {
    const rootRect = root.getBoundingClientRect();
    sub.classList.remove("pxd-menu__sub--left");
    sub.style.top = "0px";
    const r = row.getBoundingClientRect();
    const w = sub.offsetWidth || MENU_WIDTH;
    const h = sub.offsetHeight || 0;
    if (menuEl?.classList?.contains("pxd-menu--scroll")) {
      // .pxd-root has contain:layout, so this position:fixed submenu is positioned against the board, not the window.
      // Cap it to the on-screen part of the board and scroll; otherwise the lower rows sit below the window.
      const fitsRight = !rootRect.width || r.right + w <= rootRect.right - MARGIN;
      const viewH = doc.defaultView?.innerHeight || 0;
      const viewTop = Math.max(rootRect.top || 0, 0);
      const viewBottom = viewH ? Math.min(rootRect.bottom || viewH, viewH) : (rootRect.bottom || 0);
      const visibleSpan = viewBottom > viewTop ? viewBottom - viewTop : (rootRect.height || 0);
      const available = visibleSpan ? Math.max(ROW_HEIGHT * 3, visibleSpan - 2 * MARGIN) : h;
      const used = h > available && available > 0 ? available : h;
      if (h > available && available > 0) {
        sub.style.maxHeight = `${Math.round(available)}px`;
        sub.style.overflowY = "auto";
        sub.style.overscrollBehavior = "contain";
      } else {
        sub.style.maxHeight = "";
        sub.style.overflowY = "";
        sub.style.overscrollBehavior = "";
      }
      const limitBottom = viewBottom || rootRect.bottom || 0;
      const topVp = visibleSpan ? Math.max(viewTop + MARGIN, Math.min(r.top, limitBottom - MARGIN - used)) : r.top;
      const leftVp = fitsRight ? r.right + 2 : r.left - w - 2;
      sub.style.left = `${Math.round(leftVp - (rootRect.left || 0))}px`;
      sub.style.top = `${Math.round(topVp - (rootRect.top || 0))}px`;
      return;
    }
    if (rootRect.width && r.right + w > rootRect.right - MARGIN) sub.classList.add("pxd-menu__sub--left");
    if (rootRect.height && h && r.top + h > rootRect.bottom - MARGIN) {
      sub.style.top = `${Math.round(Math.min(0, rootRect.bottom - MARGIN - (r.top + h)))}px`;
    }
  };

  const openSub = (row) => {
    const entry = entries.get(row);
    if (!entry?.sub || entry.item.disabled) return null;
    closeFrom(entry.level + 1);
    entry.sub.container.style.display = "";
    entry.sub.container.classList.add("pxd-menu__sub--open");
    levels.push(entry.sub);
    placeSub(entry.sub.container, row);
    return entry.sub;
  };

  const build = (items, parent, depth) => {
    const level = { container: parent, rows: [], active: null, depth };
    for (const item of items) {
      if (item.separator) { el("div", "pxd-menu__sep", parent); continue; }
      let cls = "pxd-menu__item";
      if (item.disabled) cls += " pxd-menu__item--disabled";
      if (item.danger) cls += " pxd-menu__item--danger";
      if (item.checked) cls += " pxd-menu__item--checked";
      if (item.children?.length) cls += " pxd-menu__item--parent";
      const row = el("div", cls, parent);
      row.setAttribute("role", item.checked ? "menuitemradio" : "menuitem");
      if (item.checked) row.setAttribute("aria-checked", "true");
      if (item.disabled) row.setAttribute("aria-disabled", "true");
      row.setAttribute("data-id", item.id);
      row.dataset.id = item.id;
      el("span", "pxd-menu__label", row, item.label);
      if (item.hint) el("span", "pxd-menu__hint", row, item.hint);
      const entry = { item, level: depth, sub: null };
      entries.set(row, entry);
      level.rows.push(row);
      if (item.children?.length) {
        el("span", "pxd-menu__arrow", row, "›");
        const container = el("div", "pxd-menu__sub", row);
        container.style.display = "none";
        container.setAttribute("role", "menu");
        entry.sub = build(item.children, container, depth + 1);
      }
    }
    return level;
  };

  const close = () => {
    if (!menuEl) return;
    offs.splice(0).forEach((off) => off());
    menuEl.remove();
    menuEl = null;
    entries.clear();
    levels.length = 0;
    on.closed?.();
  };

  const pick = (row) => {
    const entry = entries.get(row);
    if (!entry || entry.item.disabled) return;
    if (entry.sub) { const sub = openSub(row); if (sub) setActive(sub, selectable(sub)[0] || null); return; }
    const { item } = entry;
    try { on.pick?.(item.id, item); } finally { close(); }
  };

  const current = () => levels[levels.length - 1];
  const move = (step) => {
    const level = current();
    const rows = selectable(level);
    if (!rows.length) return;
    const i = rows.indexOf(level.active);
    const next = i < 0 ? (step > 0 ? 0 : rows.length - 1) : (i + step + rows.length) % rows.length;
    setActive(level, rows[next]);
  };

  const onKey = (event) => {
    const key = event.key;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape", " ", "Home", "End", "Tab"].includes(key)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const level = current();
    if (key === "Escape" || key === "Tab") return close();
    if (key === "ArrowDown") return move(1);
    if (key === "ArrowUp") return move(-1);
    if (key === "Home" || key === "End") {
      const rows = selectable(level);
      return setActive(level, key === "Home" ? rows[0] : rows[rows.length - 1]);
    }
    if (key === "ArrowRight") {
      if (level.active && entries.get(level.active)?.sub) pick(level.active);
      return undefined;
    }
    if (key === "ArrowLeft") {
      if (levels.length > 1) closeFrom(levels.length - 1);
      return undefined;
    }
    if (level.active) pick(level.active);
    return undefined;
  };

  const rowOf = (event) => event.target?.closest?.(".pxd-menu__item") || null;

  const api = {
    el: null,
    open({ x = 0, y = 0, items = [] } = {}) {
      if (disposed) return false;
      close();
      const list = Array.isArray(items) ? items : [];
      if (!list.some((item) => !item.separator)) return false;
      menuEl = el("div", "pxd-menu pxd-chrome", root);
      api.el = menuEl;
      menuEl.setAttribute("role", "menu");
      menuEl.style.left = "0px";
      menuEl.style.top = "0px";
      for (const type of STOP_EVENTS) on_(menuEl, type, (event) => event.stopPropagation());
      on_(menuEl, "contextmenu", (event) => event.preventDefault?.());
      levels.push(build(list, menuEl, 0));
      on_(menuEl, "click", (event) => {
        const row = rowOf(event);
        if (!row) return;
        event.preventDefault?.();
        pick(row);
      });
      on_(menuEl, "pointerover", (event) => {
        const row = rowOf(event);
        if (!row) return;
        const entry = entries.get(row);
        const level = levels[entry.level];
        if (!level) return;
        closeFrom(entry.level + 1);
        if (entry.item.disabled) { setActive(level, null); return; }
        setActive(level, row);
        if (entry.sub) openSub(row);
      });
      const win = doc.defaultView || doc;
      on_(doc, "pointerdown", (event) => { if (menuEl && !menuEl.contains(event.target)) close(); }, true);
      on_(win, "keydown", onKey, true);

      const rootRect = root.getBoundingClientRect();
      const rows = list.filter((item) => !item.separator).length;
      const w = menuEl.offsetWidth || MENU_WIDTH;
      let h = menuEl.offsetHeight || rows * ROW_HEIGHT;
      const W = rootRect.width || 0;
      const H = rootRect.height || 0;
      // Taller than the board: cap the height and scroll (the root clips overflow, so the bottom rows were unreachable).
      if (H && h > H - 2 * MARGIN) {
        h = Math.max(ROW_HEIGHT * 3, H - 2 * MARGIN);
        menuEl.classList.add("pxd-menu--scroll");
        menuEl.style.maxHeight = `${Math.round(h)}px`;
      }
      let left = x - (rootRect.left || 0);
      let top = y - (rootRect.top || 0);
      if (W) left = Math.max(MARGIN, Math.min(left, W - w - MARGIN));
      if (H) top = Math.max(MARGIN, Math.min(top, H - h - MARGIN));
      menuEl.style.left = `${Math.round(left)}px`;
      menuEl.style.top = `${Math.round(top)}px`;
      return true;
    },
    close,
    isOpen: () => Boolean(menuEl),
    dispose() { close(); disposed = true; api.el = null; },
  };
  return api;
}
