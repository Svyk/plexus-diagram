// NAV-2. Inline contexts for a block card. The first chunk paints now. Later chunks wait.

import { CONTEXT_FILTER_AT, filterRows, groupRefs, rowChunks } from "../model/contexts.js";

export function mountContextsDrawer({
  doc = globalThis.document,
  parent,
  rows = [],
  onOpen,
  schedule = (fn) => setTimeout(fn, 0),
} = {}) {
  const el = doc.createElement("div");
  el.className = "pxd-contexts";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "References");

  const grouped = groupRefs(rows);
  const flat = grouped.groups.flatMap((group) => group.rows.map((row) => ({ ...row, year: group.year })));
  const chunks = rowChunks(flat);
  const list = doc.createElement("div");
  list.className = "pxd-contexts__list";

  if (rows.length > CONTEXT_FILTER_AT) {
    const filter = doc.createElement("input");
    filter.className = "pxd-contexts__filter";
    filter.type = "search";
    filter.setAttribute("aria-label", "Filter references");
    filter.addEventListener("input", () => {
      const shown = new Set(filterRows(flat, filter.value).map((row) => row.uid));
      for (const node of list.querySelectorAll(".pxd-contexts__row")) {
        node.hidden = !shown.has(node.getAttribute("data-uid"));
      }
    });
    el.append(filter);
  }

  if (grouped.hidden > 0) {
    const note = doc.createElement("div");
    note.className = "pxd-contexts__cap";
    note.textContent = `Showing ${flat.length} of ${grouped.total}`;
    el.append(note);
  }

  let year;
  const paint = (chunk) => {
    for (const row of chunk) {
      if (row.year !== year) {
        year = row.year;
        const head = doc.createElement("div");
        head.className = "pxd-contexts__year";
        head.textContent = year ? String(year) : "Undated";
        list.append(head);
      }
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "pxd-contexts__row";
      button.setAttribute("data-uid", row.uid);
      const crumb = doc.createElement("div");
      crumb.className = "pxd-contexts__crumb";
      crumb.textContent = row.crumb || "Untitled";
      const snippet = doc.createElement("div");
      snippet.className = "pxd-contexts__snippet";
      snippet.textContent = row.snippet || "";
      button.append(crumb, snippet);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen?.(row.uid, { sidebar: Boolean(event.shiftKey) });
      });
      list.append(button);
    }
  };

  if (chunks[0]) paint(chunks[0]);
  el.append(list);
  parent?.append(el);

  const pending = chunks.slice(1);
  const step = () => {
    if (!el.isConnected || !pending.length) return;
    paint(pending.shift());
    if (pending.length) schedule(step);
  };
  if (pending.length) schedule(step);

  return {
    el,
    close() { el.remove(); },
  };
}
