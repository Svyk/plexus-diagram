// Kanban overlay. Columns come from src/model/kanban.js. A drop plans one
// write: the TODO/DONE marker, one Name:: child, or one Task Status Tags setStatus.
// Nothing is written on open. The lane choice is stored on plexus.kanban only when the user picks it.

import { readPlexus } from "../model/schema.js";
import { DONE_COLUMN, NO_STATUS, STATUS_FIELD, TODO_FIELD, groupByStatus, kanbanColumns, kanbanFields, kanbanRows, planKanbanMove } from "../model/kanban.js";
import { paletteEntries, paletteVars, statusApi, statusPalette } from "../model/status-tags.js";

const BAD_STATUS = new Set(["rejected", "unknown", "conflict", "not-updated"]);

// The column already says the status, so a card title drops the status tag and the TODO/DONE marker.
function kanbanTitle(card) {
  const raw = typeof card?.string === "string" && card.string ? card.string : "";
  if (!/task-status\//.test(raw)) return card?.title || "";
  const text = raw
    .replace(/#\[\[task-status\/[^\]]+\]\]|#task-status\/\S+/g, "")
    .replace(/\{\{\[\[(TODO|DONE)\]\]\}\}|\{\{(TODO|DONE)\}\}/g, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text || card?.title || "";
}

export function mountKanban({
  doc = globalThis.document,
  root,
  host,
  bt = null,
  completeTask = null,
  getBoard,
  setStatus = null,
  toast = () => {},
  onLane = null,
  getPalette = null,
} = {}) {
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
  const listen = (el, type, fn, bucket = offs, capture = false) => {
    el?.addEventListener?.(type, fn, capture);
    bucket.push(() => el?.removeEventListener?.(type, fn, capture));
  };
  const stop = (event) => event.stopPropagation();
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"]) {
    listen(box, type, stop);
  }

  let open = false;
  let field = TODO_FIELD;
  let picked = false;
  let dragUid = null;
  let painted = [];
  const pending = new Map();

  const place = () => {
    const toolbar = root?.querySelector?.(".pxd-toolbar");
    if (!toolbar || typeof toolbar.getBoundingClientRect !== "function" || typeof root.getBoundingClientRect !== "function") return;
    const top = toolbar.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
    if (top > 0) box.style.top = `${Math.ceil(top)}px`;
  };

  const palette = () => (typeof getPalette === "function" ? getPalette() : statusPalette(statusApi(doc.defaultView)));

  const writer = () => {
    if (typeof setStatus === "function") return setStatus;
    const api = statusApi(doc.defaultView);
    return typeof api?.setStatus === "function" ? api.setStatus.bind(api) : null;
  };

  const commit = async (plan) => {
    try {
      // A task moved between To do and Done goes through Better Tasks when it is loaded, so it writes the
      // Completed date. When Better Tasks refuses, the marker write below still moves the card.
      // RE-1: Done goes through the checkbox path first, so a repeating task also makes its next occurrence.
      if (plan.status === "DONE" && typeof completeTask === "function") {
        const res = await completeTask(plan.uid);
        if (res?.ok) { paint(); return; }
      }
      if (plan.status && bt?.available?.()) {
        const res = await bt.modify(plan.uid, { status: plan.status });
        if (res.ok) { paint(); return; }
      }
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

  const persist = (next) => {
    if (typeof onLane === "function") {
      onLane(next);
      return;
    }
    const board = getBoard?.();
    const uid = board?.uid;
    if (!uid || typeof host?.updateProps !== "function") return;
    let base = null;
    if (typeof host.pullProps === "function") {
      try { base = readPlexus(host.pullProps(uid)); } catch { base = null; }
    }
    if (!base || typeof base !== "object") base = board?.plexus && typeof board.plexus === "object" ? board.plexus : null;
    if (!base || base.kanban === next) return;
    const copy = { ...base, kanban: next };
    if (board?.plexus && typeof board.plexus === "object") board.plexus.kanban = next;
    try {
      const write = host.updateProps(uid, copy);
      if (write && typeof write.then === "function") void write.catch(() => {});
    } catch { /* the select already shows the pick */ }
  };

  const applyPending = (columns) => {
    if (!pending.size) return columns;
    const cards = [];
    for (const column of columns) for (const card of column.cards) cards.push({ card, natural: column.name });
    const next = columns.map((column) => ({ ...column, cards: [], count: 0 }));
    const byName = new Map(next.map((column) => [column.name, column]));
    for (const { card, natural } of cards) {
      let name = pending.get(card.uid);
      if (!name || name === natural) {
        if (name === natural) pending.delete(card.uid);
        name = natural;
      }
      const dest = byName.get(name) || byName.get(natural);
      if (dest) dest.cards.push(card);
    }
    for (const column of next) column.count = column.cards.length;
    return next;
  };

  const laneOf = (row) => {
    if (pending.has(row?.uid)) return pending.get(row.uid);
    const found = groupByStatus([row], palette()).find((column) => column.cards.length);
    return found?.name || NO_STATUS;
  };

  // Status lanes call setStatus. Done keeps the checkbox path. Leaving Done reopens only after setStatus accepts.
  const moveToLane = async (row, columnName) => {
    if (!open || !row?.uid || columnName == null || columnName === "") return { ok: false };
    const from = field === STATUS_FIELD ? laneOf(row) : null;
    if (field !== STATUS_FIELD) {
      const plan = planKanbanMove({ field, column: columnName, row });
      if (!plan) return { ok: false };
      await commit(plan);
      return { ok: true };
    }
    if (from === columnName) return { ok: false };
    if (columnName === DONE_COLUMN) {
      pending.delete(row.uid);
      const plan = planKanbanMove({ field: TODO_FIELD, column: DONE_COLUMN, row });
      if (!plan) return { ok: false };
      await commit(plan);
      return { ok: true, via: "done" };
    }
    const leavingDone = from === DONE_COLUMN;
    pending.set(row.uid, columnName);
    paint();
    const write = writer();
    if (typeof write !== "function") {
      pending.delete(row.uid);
      toast({ message: "Task Status Tags is not loaded" });
      paint();
      return { ok: false, reverted: true };
    }
    let res;
    try {
      res = await write(row.uid, columnName === NO_STATUS ? null : columnName);
    } catch (error) {
      res = { status: "rejected", reason: error?.message || "Could not set that status" };
    }
    if (!res || BAD_STATUS.has(res.status)) {
      pending.delete(row.uid);
      toast({ message: res?.reason || "Could not set that status" });
      paint();
      return { ok: false, reverted: true, reason: res?.reason };
    }
    if (leavingDone) {
      const plan = planKanbanMove({ field: TODO_FIELD, column: TODO_FIELD, row });
      if (plan) await commit(plan);
      // A failed reopen leaves the marker DONE. Pending would pin that card in the status column.
      const item = getBoard?.()?.items?.get?.(row.uid);
      const string = item?.string ?? row.string ?? "";
      if (item?.done === true || /\{\{\[\[DONE\]\]\}\}/.test(String(string))) {
        pending.delete(row.uid);
        paint();
      }
    }
    return { ok: true };
  };

  const paint = () => {
    if (!open) return;
    paintOffs.splice(0).forEach((off) => off());
    const focusUid = doc.activeElement?.closest?.(".pxd-kanban__card")?.getAttribute?.("data-uid") || null;
    const rows = kanbanRows(getBoard?.() || null, (uid) => host?.blockString?.(uid));
    painted = rows;
    const fields = kanbanFields(rows);
    if (!fields.includes(STATUS_FIELD)) fields.push(STATUS_FIELD);
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
    const source = field === STATUS_FIELD ? applyPending(groupByStatus(rows, palette())) : kanbanColumns(rows, field);
    const entries = field === STATUS_FIELD ? paletteEntries(palette()) : [];
    const byKey = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
    const theme = root?.classList?.contains?.("pxd-root--dark") ? "dark" : "light";
    columnsEl.replaceChildren();
    for (const column of source) {
      const col = doc.createElement("section");
      col.className = "pxd-kanban__column";
      col.setAttribute("data-column", column.name);
      const count = column.count ?? column.cards.length;
      col.setAttribute("data-count", String(count));
      const entry = byKey.get(String(column.name || "").toLowerCase()) || null;
      if (entry) {
        for (const [key, value] of Object.entries(paletteVars(entry, theme))) col.style.setProperty(key, value);
      } else if (column.glyph === "diamond") {
        for (const [key, value] of Object.entries(paletteVars({ light: {}, dark: {} }, theme))) col.style.setProperty(key, value);
      }
      const title = doc.createElement("h3");
      title.className = "pxd-kanban__heading";
      const glyphName = entry?.glyph || column.glyph || "";
      if (glyphName) {
        const glyph = doc.createElement("span");
        glyph.className = "pxd-kanban__glyph";
        glyph.setAttribute("data-status", glyphName);
        glyph.setAttribute("aria-hidden", "true");
        title.append(glyph);
      }
      const nameEl = doc.createElement("span");
      nameEl.className = "pxd-kanban__name";
      nameEl.textContent = column.name || "None";
      title.append(nameEl);
      const countEl = doc.createElement("span");
      countEl.className = "pxd-kanban__count";
      countEl.textContent = String(count);
      title.append(countEl);
      col.append(title);
      for (const card of column.cards) {
        const item = doc.createElement("div");
        item.className = "pxd-kanban__card";
        item.setAttribute("data-uid", card.uid);
        item.tabIndex = 0;
        item.textContent = kanbanTitle(card) || card.uid;
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
        if (!row) return;
        if (field === STATUS_FIELD) void moveToLane(row, column.name);
        else {
          const plan = planKanbanMove({ field, column: column.name, row });
          if (plan) void commit(plan);
        }
      }, paintOffs);
      columnsEl.append(col);
    }
    if (focusUid) {
      const again = columnsEl.querySelector(`[data-uid="${focusUid}"]`);
      try { again?.focus?.({ preventScroll: true }); } catch { again?.focus?.(); }
    }
  };

  listen(select, "change", () => {
    const next = select.value || TODO_FIELD;
    if (next === field) return;
    field = next;
    picked = true;
    pending.clear();
    persist(next);
    paint();
  });

  // `[` and `]` only act on a focused Kanban card: the listener sits on the box and only while Kanban is open,
  // so a board that never opens Kanban carries no extra listener (FAST-1 listenersPerBoard).
  const keyOffs = [];
  const onLaneKey = (event) => {
    if (!open || (event.key !== "[" && event.key !== "]")) return;
    const tag = String(doc.activeElement?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    const card = doc.activeElement?.closest?.(".pxd-kanban__card");
    if (!card || !box.contains?.(card)) return;
    event.preventDefault();
    event.stopPropagation();
    const names = [...columnsEl.querySelectorAll(".pxd-kanban__column")]
      .map((col) => col.getAttribute("data-column"))
      .filter((name) => name);
    const current = card.closest?.(".pxd-kanban__column")?.getAttribute?.("data-column");
    const index = names.indexOf(current);
    if (index < 0) return;
    const next = event.key === "]" ? index + 1 : index - 1;
    if (next < 0 || next >= names.length) return;
    const row = painted.find((item) => item.uid === card.getAttribute("data-uid"));
    if (row) void moveToLane(row, names[next]);
  };
  const armKeys = () => { if (!keyOffs.length) listen(box, "keydown", onLaneKey, keyOffs, true); };
  const disarmKeys = () => { keyOffs.splice(0).forEach((off) => off()); };

  let resizeObs = null;
  const toolbar = root?.querySelector?.(".pxd-toolbar");
  if (toolbar && typeof globalThis.ResizeObserver === "function") {
    resizeObs = new globalThis.ResizeObserver(() => { if (open) place(); });
    resizeObs.observe(toolbar);
  }

  return {
    el: box,
    moveToLane,
    open() {
      open = true;
      armKeys();
      pending.clear();
      if (!picked) {
        const saved = getBoard?.()?.plexus?.kanban;
        if (typeof saved === "string" && saved) field = saved;
      }
      place();
      paint();
    },
    close() { open = false; dragUid = null; disarmKeys(); },
    refresh() { if (open) paint(); },
    dispose() {
      open = false;
      dragUid = null;
      disarmKeys();
      pending.clear();
      try { resizeObs?.disconnect(); } catch { /* stub */ }
      paintOffs.splice(0).forEach((off) => off());
      offs.splice(0).forEach((off) => off());
      box.remove();
    },
  };
}

export { DONE_COLUMN, STATUS_FIELD, TODO_FIELD };
