// Kanban overlay. Columns come from src/model/kanban.js. A drop plans one
// write: the TODO/DONE marker, or one Name:: child. Nothing is written on open.

import { DONE_COLUMN, TODO_FIELD, kanbanColumns, kanbanFields, kanbanRows, planKanbanMove } from "../model/kanban.js";

export function mountKanban({ doc = globalThis.document, root, host, getBoard } = {}) {
  const box = doc.createElement("div");
  box.className = "pxd-kanban pxd-chrome";
  root?.append(box);
  const bar = doc.createElement("div");
  bar.className = "pxd-kanban__bar";
  box.append(bar);
  const label = doc.createElement("span");
  label.className = "pxd-kanban__label";
  label.textContent = "Group by";
  bar.append(label);
  const select = doc.createElement("select");
  select.className = "pxd-kanban__field";
  select.setAttribute("aria-label", "Group by");
  bar.append(select);
  const columnsEl = doc.createElement("div");
  columnsEl.className = "pxd-kanban__columns";
  box.append(columnsEl);

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
  let field = TODO_FIELD;
  let dragUid = null;

  const place = () => {
    const toolbar = root?.querySelector?.(".pxd-toolbar");
    if (!toolbar || typeof toolbar.getBoundingClientRect !== "function" || typeof root.getBoundingClientRect !== "function") return;
    const top = toolbar.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
    if (top > 0) box.style.top = `${Math.ceil(top)}px`;
  };

  const commit = async (plan) => {
    try {
      if (plan.op === "string" && typeof host?.updateString === "function") {
        const write = () => host.updateString(plan.uid, plan.string);
        if (typeof host.group === "function") await host.group(write);
        else await write();
      } else if (plan.op === "create" && typeof host?.createBlock === "function") {
        const write = () => host.createBlock({ parentUid: plan.parent, order: "last", string: plan.string });
        if (typeof host.group === "function") await host.group(write);
        else await write();
      }
    } catch {
      /* leave the card where it was */
    }
    paint();
  };

  const paint = () => {
    if (!open) return;
    paintOffs.splice(0).forEach((off) => off());
    const rows = kanbanRows(getBoard?.() || null);
    const fields = kanbanFields(rows);
    if (!fields.includes(field)) field = TODO_FIELD;
    select.replaceChildren();
    for (const name of fields) {
      const option = doc.createElement("option");
      option.value = name;
      option.textContent = name;
      if (name === field) option.selected = true;
      select.append(option);
    }
    select.value = field;
    columnsEl.replaceChildren();
    for (const column of kanbanColumns(rows, field)) {
      const col = doc.createElement("section");
      col.className = "pxd-kanban__column";
      col.setAttribute("data-column", column.name);
      const title = doc.createElement("h3");
      title.className = "pxd-kanban__heading";
      title.textContent = column.name || "None";
      col.append(title);
      for (const card of column.cards) {
        const item = doc.createElement("div");
        item.className = "pxd-kanban__card";
        item.setAttribute("data-uid", card.uid);
        item.textContent = card.title || card.uid;
        listen(item, "pointerdown", (event) => {
          dragUid = card.uid;
          event.stopPropagation();
        }, paintOffs);
        col.append(item);
      }
      listen(col, "pointerup", () => {
        const uid = dragUid;
        dragUid = null;
        if (!uid || column.name === "") return;
        const row = rows.find((item) => item.uid === uid);
        const plan = planKanbanMove({ field, column: column.name, row });
        if (plan) void commit(plan);
      }, paintOffs);
      columnsEl.append(col);
    }
  };

  listen(select, "change", () => {
    field = select.value || TODO_FIELD;
    paint();
  });

  let resizeObs = null;
  const toolbar = root?.querySelector?.(".pxd-toolbar");
  if (toolbar && typeof globalThis.ResizeObserver === "function") {
    resizeObs = new globalThis.ResizeObserver(() => { if (open) place(); });
    resizeObs.observe(toolbar);
  }

  return {
    el: box,
    open() { open = true; place(); paint(); },
    close() { open = false; dragUid = null; },
    refresh() { if (open) paint(); },
    dispose() {
      open = false;
      dragUid = null;
      try { resizeObs?.disconnect(); } catch { /* stub */ }
      paintOffs.splice(0).forEach((off) => off());
      offs.splice(0).forEach((off) => off());
      box.remove();
    },
  };
}

export { DONE_COLUMN, TODO_FIELD };
