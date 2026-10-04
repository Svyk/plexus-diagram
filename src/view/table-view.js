// Board table. Rows and columns come from src/model/table.js. An existing
// attribute cell mounts host.renderBlock on that child. A new column stays
// local until a cell is filled, and that fill is the only write.

import { cellText, columnNameOk, filterRows, planAttrCell, sortRows, tableColumns, tableRows } from "../model/table.js";

const EDITED_QUERY = "[:find ?u ?e :in $ [?u ...] :where [?b :block/uid ?u] [?b :edit/time ?e]]";

function editedLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1e11) return String(n);
  try {
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? String(n) : d.toLocaleString();
  } catch {
    return String(n);
  }
}

export function mountTable({ doc = globalThis.document, root, host, getBoard } = {}) {
  const box = doc.createElement("div");
  box.className = "pxd-table pxd-chrome";
  root?.append(box);
  const bar = doc.createElement("div");
  bar.className = "pxd-table__bar";
  box.append(bar);
  const filter = doc.createElement("input");
  filter.type = "text";
  filter.className = "pxd-input pxd-table__filter";
  filter.placeholder = "Filter";
  filter.setAttribute("aria-label", "Filter rows");
  bar.append(filter);
  const colName = doc.createElement("input");
  colName.type = "text";
  colName.className = "pxd-input pxd-table__colname";
  colName.placeholder = "Column name";
  colName.setAttribute("aria-label", "New column name");
  bar.append(colName);
  const addBtn = doc.createElement("button");
  addBtn.type = "button";
  addBtn.className = "pxd-btn pxd-table__add";
  addBtn.textContent = "Add column";
  addBtn.setAttribute("aria-label", "Add column");
  bar.append(addBtn);
  const grid = doc.createElement("table");
  grid.className = "pxd-table__grid";
  const thead = doc.createElement("thead");
  const tbody = doc.createElement("tbody");
  grid.append(thead, tbody);
  box.append(grid);

  const offs = [];
  const paintOffs = [];
  const listen = (el, type, fn, bucket = offs) => {
    el.addEventListener(type, fn);
    bucket.push(() => el.removeEventListener(type, fn));
  };
  const stop = (event) => event.stopPropagation();
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"]) {
    listen(box, type, stop);
  }

  let open = false;
  let filterText = "";
  let sortColumn = null;
  let sortDir = "asc";
  const pending = [];
  const filled = new Map();
  const inflight = new Set();
  const edited = new Map();
  let paintQueued = false;

  const editing = () => {
    const active = doc.activeElement;
    return Boolean(active && box.contains(active) && active.closest?.(".pxd-table__edit"));
  };

  const closeEditors = () => {
    for (const cell of [...box.querySelectorAll(".pxd-table__edit")]) {
      try { host?.unmount?.(cell); } catch { /* stub */ }
      cell.classList.remove("pxd-table__edit");
    }
  };

  const sourceRows = () => {
    const rows = tableRows(getBoard?.() || null, (uid) => host?.blockString?.(uid));
    const missing = rows.map((row) => row.uid).filter((uid) => !edited.has(uid));
    if (missing.length && typeof host?.q === "function") {
      let found = [];
      try { found = host.q(EDITED_QUERY, missing) || []; } catch { found = []; }
      for (const hit of found) {
        if (Array.isArray(hit) && hit.length >= 2) edited.set(hit[0], hit[1]);
      }
    }
    for (const row of rows) {
      if (edited.has(row.uid)) row.edited = edited.get(row.uid);
      for (const attr of row.attrs || []) filled.delete(`${row.uid}\u0000${attr.name}`);
    }
    return rows;
  };

  const columnsOf = (rows) => {
    const cols = tableColumns(rows);
    for (const name of pending) if (!cols.includes(name)) cols.push(name);
    return cols;
  };

  const shownRows = (rows) => {
    const filtered = filterRows(rows, filterText);
    return sortColumn ? sortRows(filtered, sortColumn, sortDir) : filtered;
  };

  const commitFill = async (row, column, raw) => {
    const key = `${row.uid}\u0000${column}`;
    if (inflight.has(key) || filled.has(key)) return;
    const plan = planAttrCell({ name: column, value: raw, parentUid: row.uid });
    if (!plan || plan.op !== "create") return;
    if (typeof host?.createBlock !== "function") return;
    inflight.add(key);
    try {
      const write = () => host.createBlock({ parentUid: plan.parent, order: "last", string: plan.string });
      if (typeof host.group === "function") await host.group(write);
      else await write();
      filled.set(key, String(raw).trim());
    } catch {
      /* leave the input so the fill can be tried again */
    } finally {
      inflight.delete(key);
    }
    paint();
  };

  const openEditor = (cell, blockUid) => {
    if (!blockUid || typeof host?.renderBlock !== "function") return;
    closeEditors();
    cell.classList.add("pxd-table__edit");
    cell.replaceChildren();
    try { host.renderBlock(cell, blockUid); } catch { /* render failed */ }
  };

  const paint = () => {
    if (!open) return;
    if (editing()) { paintQueued = true; return; }
    paintQueued = false;
    paintOffs.splice(0).forEach((off) => off());
    const rows = sourceRows();
    const cols = columnsOf(rows);
    const body = shownRows(rows);
    thead.replaceChildren();
    const head = doc.createElement("tr");
    for (const column of cols) {
      const th = doc.createElement("th");
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "pxd-btn pxd-table__sort";
      button.setAttribute("data-col", column);
      const mark = sortColumn === column ? (sortDir === "desc" ? " ↓" : " ↑") : "";
      button.textContent = `${column}${mark}`;
      button.setAttribute("aria-label", `Sort by ${column}`);
      listen(button, "click", () => {
        if (sortColumn === column) sortDir = sortDir === "asc" ? "desc" : "asc";
        else { sortColumn = column; sortDir = "asc"; }
        paint();
      }, paintOffs);
      th.append(button);
      head.append(th);
    }
    thead.append(head);
    tbody.replaceChildren();
    for (const row of body) {
      const tr = doc.createElement("tr");
      tr.className = "pxd-table__row";
      tr.setAttribute("data-uid", row.uid);
      for (const column of cols) {
        const td = doc.createElement("td");
        td.className = "pxd-table__cell";
        td.setAttribute("data-col", column);
        const attr = (row.attrs || []).find((item) => item.name === column);
        const pendingValue = filled.get(`${row.uid}\u0000${column}`);
        if (attr?.uid) {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "pxd-btn pxd-table__value";
          button.textContent = cellText(row, column);
          button.setAttribute("aria-label", `${column} for ${row.title || row.uid}`);
          listen(button, "click", () => openEditor(td, attr.uid), paintOffs);
          td.append(button);
        } else if (pendingValue != null) {
          const span = doc.createElement("span");
          span.className = "pxd-table__text";
          span.textContent = pendingValue;
          td.append(span);
        } else if (column !== "Title" && column !== "Section" && column !== "Type" && column !== "Edited") {
          const input = doc.createElement("input");
          input.type = "text";
          input.className = "pxd-input pxd-table__fill";
          input.setAttribute("aria-label", `${column} for ${row.title || row.uid}`);
          const commit = () => { void commitFill(row, column, input.value); };
          listen(input, "keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commit();
          }, paintOffs);
          listen(input, "blur", commit, paintOffs);
          td.append(input);
        } else {
          const span = doc.createElement("span");
          span.className = "pxd-table__text";
          span.textContent = column === "Edited" ? editedLabel(row.edited) : cellText(row, column);
          td.append(span);
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
  };

  listen(filter, "input", () => {
    filterText = filter.value;
    paint();
  });
  const addColumn = () => {
    const name = colName.value.trim();
    if (!columnNameOk(name)) return;
    const rows = sourceRows();
    if (!tableColumns(rows).includes(name) && !pending.includes(name)) pending.push(name);
    colName.value = "";
    paint();
  };
  listen(addBtn, "click", addColumn);
  listen(colName, "keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addColumn();
  });
  listen(box, "focusout", () => {
    if (!paintQueued) return;
    const later = () => { if (open && paintQueued && !editing()) paint(); };
    if (typeof doc.defaultView?.setTimeout === "function") doc.defaultView.setTimeout(later, 0);
    else later();
  });

  // The toolbar wraps on a narrow board and sits above this overlay (z-index 10).
  // A fixed padding leaves the filter under those buttons. Park the sheet just below it.
  const place = () => {
    const toolbar = root?.querySelector?.(".pxd-toolbar");
    if (!toolbar || typeof toolbar.getBoundingClientRect !== "function" || typeof root.getBoundingClientRect !== "function") return;
    const top = toolbar.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
    if (top > 0) box.style.top = `${Math.ceil(top)}px`;
  };
  let resizeObs = null;
  const toolbar = root?.querySelector?.(".pxd-toolbar");
  if (toolbar && typeof globalThis.ResizeObserver === "function") {
    resizeObs = new globalThis.ResizeObserver(() => { if (open) place(); });
    resizeObs.observe(toolbar);
  }

  return {
    el: box,
    open() { open = true; place(); paint(); },
    close() { open = false; closeEditors(); },
    refresh() { if (open) paint(); },
    dispose() {
      open = false;
      closeEditors();
      try { resizeObs?.disconnect(); } catch { /* stub */ }
      paintOffs.splice(0).forEach((off) => off());
      offs.splice(0).forEach((off) => off());
      box.remove();
    },
  };
}
