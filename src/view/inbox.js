// "Inbox (N)" pill and its list. Daily-note blocks that cite this board, newest first, not yet cards.
// The read runs once when the board is idle and again when the list opens. Placing a row adds a ((uid)) card.

import { CARD_MIME } from "../model/drop.js";
import { filterInbox, inboxLabel, inboxRow, inboxTitles, readInbox } from "../model/inbox.js";

export function createInbox({ doc = globalThis.document, root, host, timers, titles, onBoard, skip, place } = {}) {
  let entries = [];
  let rows = [];
  let btn = null;
  let panel = null;
  let open = false;
  let disposed = false;
  let reading = null;
  let loaded = false;

  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  };
  const swallow = (event) => event.stopPropagation();

  const compute = () => {
    rows = filterInbox(entries, { onBoard: onBoard?.() || new Set(), skip: skip?.() || new Set() }).map(inboxRow);
  };

  const paintList = () => {
    if (!panel) return;
    panel.replaceChildren?.();
    const head = el("div", "pxd-inbox__head", panel);
    el("span", "pxd-inbox__title", head, "Daily notes that mention this board");
    const all = el("button", "pxd-inbox__all", head, "Place all");
    all.type = "button";
    all.disabled = rows.length === 0;
    for (const type of ["pointerdown", "mousedown", "dblclick"]) all.addEventListener(type, swallow);
    all.addEventListener("click", (event) => {
      event.stopPropagation();
      const batch = rows.slice(0, 30);
      if (!batch.length) return;
      place?.(batch.map((r) => r.string));
      const gone = new Set(batch.map((r) => r.uid));
      entries = entries.filter((e) => !gone.has(e.uid));
      sync();
    });
    if (!rows.length) {
      el("div", "pxd-inbox__empty", panel, loaded ? "Nothing waiting." : "Reading daily notes…");
      return;
    }
    const list = el("div", "pxd-inbox__list", panel);
    for (const row of rows) {
      const node = el("div", "pxd-inbox__row", list);
      node.draggable = true;
      node.setAttribute("draggable", "true");
      node.dataset.uid = row.uid;
      el("span", "pxd-inbox__text", node, row.text);
      el("span", "pxd-inbox__page", node, row.page);
      const go = el("button", "pxd-inbox__place", node, "Place");
      go.type = "button";
      for (const type of ["pointerdown", "mousedown", "dblclick"]) node.addEventListener(type, swallow);
      go.addEventListener("click", (event) => {
        event.stopPropagation();
        place?.([row.string]);
        entries = entries.filter((e) => e.uid !== row.uid);
        sync();
      });
      node.addEventListener("dragstart", (event) => {
        event.stopPropagation();
        try {
          event.dataTransfer?.setData?.(CARD_MIME, row.string);
          event.dataTransfer?.setData?.("text/plain", row.string);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
        } catch { /* the drag still leaves the source block alone */ }
      });
    }
  };

  const paintPill = () => {
    if (!rows.length && !open) { btn?.remove(); btn = null; return; }
    if (!btn) {
      btn = el("button", "pxd-inbox pxd-chrome", root);
      btn.type = "button";
      for (const type of ["pointerdown", "mousedown", "dblclick"]) btn.addEventListener(type, swallow);
      btn.addEventListener("click", (event) => { event.stopPropagation(); toggle(); });
    }
    btn.textContent = inboxLabel(rows.length);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", `${rows.length} daily-note block${rows.length === 1 ? "" : "s"} mention this board`);
  };

  function sync() {
    if (disposed) return;
    compute();
    paintPill();
    paintList();
  }

  function refresh() {
    if (disposed || reading) return reading;
    const names = titles?.() || [];
    if (!names.length || typeof host?.q !== "function") { loaded = true; sync(); return null; }
    reading = readInbox((query, ...inputs) => host.q(query, ...inputs), inboxTitles({ pageTitle: names[0], boardTitle: names[1] }), {
      tick: () => new Promise((resolve) => timers.idle(resolve)),
    }).then((got) => {
      reading = null;
      loaded = true;
      entries = got.entries;
      sync();
    }).catch(() => { reading = null; loaded = true; sync(); });
    return reading;
  }

  function toggle() {
    if (disposed) return;
    open = !open;
    if (open) {
      panel = el("div", "pxd-inbox__panel pxd-chrome", root);
      for (const type of ["pointerdown", "mousedown", "dblclick", "wheel"]) panel.addEventListener(type, swallow);
      refresh();
    } else {
      panel?.remove();
      panel = null;
    }
    sync();
  }

  // First read waits for an idle slot, so the board paints first.
  const cancel = timers.idle(() => { void refresh(); });

  return {
    sync,
    refresh,
    rows: () => rows.slice(),
    isOpen: () => open,
    dispose() {
      disposed = true;
      try { cancel?.(); } catch { /* timer gone */ }
      btn?.remove();
      panel?.remove();
      btn = null;
      panel = null;
    },
  };
}
