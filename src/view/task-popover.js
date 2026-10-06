// Small popover for one task chip: due, project, priority or repeat. Opening writes nothing. A pick calls
// Better Tasks (bt.modify), never a BT_attr block, so the attribute child keeps its uid and Better Tasks' own
// normalisation and activity log apply. Cmd+Z after a pick is Roam's undo, not the Plexus ledger.

import { paletteEntries, statusApi } from "../model/status-tags.js";
import { dayChoices } from "../model/tasks.js";
import { placeNearAnchor } from "./avoid.js";

const PRIORITIES = ["low", "medium", "high"];
const GAP = 6;

function focusEl(el) {
  if (!el || typeof el.focus !== "function" || el.isConnected === false) return;
  try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch { /* gone */ } }
}

function fieldTag(event) {
  return String(event?.target?.tagName || "").toLowerCase();
}

export function createTaskPopover({ doc = globalThis.document, root, bt, toast = () => {}, today = () => new Date() } = {}) {
  let node = null;
  let offs = [];
  let openFor = null;
  let placeAgain = () => {};

  const close = () => {
    for (const off of offs.splice(0)) off();
    try { node?.remove(); } catch { /* already gone */ }
    node = null;
    openFor = null;
    placeAgain = () => {};
  };

  const el = (tag, cls, parent, text) => {
    const n = doc.createElement(tag);
    n.className = cls;
    if (text != null) n.textContent = text;
    parent?.append(n);
    return n;
  };

  const apply = async (uid, attributes) => {
    close();
    const res = await bt.modify(uid, { attributes });
    if (!res.ok) toast({ message: `Better Tasks could not change that: ${res.reason}` });
  };

  const button = (parent, label, run, cls = "pxd-task-pop__btn") => {
    const b = el("button", cls, parent, label);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.addEventListener("click", (event) => { event.stopPropagation(); run(); });
    return b;
  };

  const fillDue = (box, uid) => {
    for (const choice of dayChoices(today())) button(box, choice.label, () => apply(uid, { due: choice.value }));
    const pick = el("input", "pxd-task-pop__input", box);
    pick.type = "date";
    pick.setAttribute("aria-label", "Pick a date");
    pick.addEventListener("change", () => { if (pick.value) void apply(uid, { due: pick.value }); });
    button(box, "Clear", () => apply(uid, { due: "" }), "pxd-task-pop__btn pxd-task-pop__btn--clear");
  };

  const fillProject = (box, uid) => {
    const list = el("div", "pxd-task-pop__list", box);
    el("div", "pxd-task-pop__hint", list, "Loading projects");
    void bt.projects().then((names) => {
      if (!node || openFor !== uid) return;
      list.replaceChildren();
      if (!names.length) el("div", "pxd-task-pop__hint", list, "No projects yet");
      for (const name of names) button(list, name, () => apply(uid, { project: name }));
      placeAgain();
      const active = doc.activeElement;
      const tag = String(active?.tagName || "").toLowerCase();
      if (tag !== "input" && tag !== "textarea" && (active == null || active === doc.body || node.contains(active))) {
        focusEl(list.querySelector("button"));
      }
    });
    button(box, "Clear", () => apply(uid, { project: "" }), "pxd-task-pop__btn pxd-task-pop__btn--clear");
  };

  const fillPriority = (box, uid) => {
    for (const level of PRIORITIES) button(box, level, () => apply(uid, { priority: level }));
    button(box, "Clear", () => apply(uid, { priority: "" }), "pxd-task-pop__btn pxd-task-pop__btn--clear");
  };

  const fillRepeat = (box, uid) => {
    const input = el("input", "pxd-task-pop__input", box);
    input.type = "text";
    input.placeholder = "every Friday";
    input.setAttribute("aria-label", "Repeat rule");
    const go = () => { const v = input.value.trim(); if (v) void apply(uid, { repeat: v }); };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); go(); }
    });
    button(box, "Set", go);
    button(box, "Clear", () => apply(uid, { repeat: "" }), "pxd-task-pop__btn pxd-task-pop__btn--clear");
    try { input.focus({ preventScroll: true }); } catch { /* stub */ }
  };

  const FILL = { due: fillDue, project: fillProject, priority: fillPriority, repeat: fillRepeat };
  const TITLES = { due: "Due", project: "Project", priority: "Priority", repeat: "Repeat" };

  function open(uid, kind, anchor) {
    if (!bt?.available?.()) return false;
    const prior = doc.activeElement;
    const restoreTo = (anchor && typeof anchor.focus === "function")
      ? anchor
      : (prior && prior !== doc.body && prior !== doc.documentElement ? prior : null);
    close();
    if (!root || !FILL[kind]) return false;
    openFor = uid;
    node = el("div", "pxd-task-pop pxd-chrome", root);
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-label", `${TITLES[kind]} for this task`);
    node.setAttribute("data-task-pop", kind);
    el("div", "pxd-task-pop__title", node, TITLES[kind]);
    FILL[kind](node, uid);
    if (kind !== "repeat") focusEl(node.querySelector("button"));
    const a = anchor?.getBoundingClientRect?.();
    if (a) {
      placeAgain = () => { if (node && anchor.isConnected !== false) placeNearAnchor(node, anchor.getBoundingClientRect(), root, { gap: GAP }); };
      placeAgain();
    }
    const on = (target, type, fn, capture = false) => {
      target.addEventListener?.(type, fn, capture);
      offs.push(() => target.removeEventListener?.(type, fn, capture));
    };
    for (const type of ["pointerdown", "mousedown", "pointerup", "click", "dblclick", "wheel", "contextmenu"]) {
      on(node, type, (event) => event.stopPropagation());
    }
    on(doc, "pointerdown", (event) => { if (!node?.contains?.(event.target) && !anchor?.contains?.(event.target)) close(); }, true);
    on(doc, "keydown", (event) => {
      if (!node) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        const back = restoreTo;
        close();
        focusEl(back);
        return;
      }
      const inside = node.contains?.(event.target) || node.contains?.(doc.activeElement);
      if (!inside) return;
      const tag = fieldTag(event);
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const buttons = [...node.querySelectorAll("button")];
      const current = event.target?.closest?.("button") || (buttons.includes(doc.activeElement) ? doc.activeElement : null);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const index = buttons.indexOf(current);
        const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        focusEl(next);
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && current) {
        event.preventDefault();
        event.stopPropagation();
        current.click();
      }
    }, true);
    on(doc, "wheel", (event) => { if (!node?.contains?.(event.target)) close(); }, true);
    return true;
  }

  return { open, close, isOpen: () => Boolean(node), dispose: close };
}

// Status picker. One pick calls onPick(name) or onRemove(null); the caller writes through setStatus.
// Hidden when Task Status Tags is absent, and while a Better Tasks dialog is open. Opening writes nothing.
export function openStatusChooser({ doc = globalThis.document, anchor, palette, current, onPick, onRemove, avoid } = {}) {
  const win = doc?.defaultView || globalThis;
  if (!statusApi(win)) return null;
  const root = avoid?.nodeType === 1 ? avoid : (avoid?.root?.nodeType === 1 ? avoid.root : null);
  const home = root || doc.body;
  if (doc.querySelector?.(".bp3-dialog") || home?.querySelector?.(".bp3-dialog")) return null;

  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    parent?.append(node);
    return node;
  };

  const pop = el("div", "pxd-status-chooser pxd-task-pop pxd-chrome", home);
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Status");
  const list = el("div", "pxd-status-chooser__list", pop);
  list.setAttribute("role", "listbox");
  const want = String(current ?? "").trim().toLowerCase();
  let currentRow = null;
  for (const entry of paletteEntries(palette)) {
    const name = String(entry?.name || "").trim();
    if (!name) continue;
    const row = el("button", "pxd-status-chooser__row", list);
    row.type = "button";
    row.setAttribute("role", "option");
    row.setAttribute("aria-label", name);
    row.setAttribute("data-name", name);
    const glyph = el("span", "pxd-status-chooser__glyph", row);
    glyph.setAttribute("data-status", entry.glyph || "diamond");
    glyph.setAttribute("aria-hidden", "true");
    const label = el("span", "pxd-status-chooser__name", row);
    label.textContent = name;
    if (name.toLowerCase() === want) {
      row.setAttribute("aria-selected", "true");
      currentRow = row;
    }
  }
  const remove = el("button", "pxd-status-chooser__row pxd-status-chooser__row--remove", list);
  remove.type = "button";
  remove.setAttribute("data-remove", "true");
  remove.setAttribute("aria-label", "Remove status");
  const removeLabel = el("span", "pxd-status-chooser__name", remove);
  removeLabel.textContent = "Remove status";

  let closed = false;
  let picked = false;
  const offs = [];
  const on = (target, type, fn, capture = false) => {
    target?.addEventListener?.(type, fn, capture);
    offs.push(() => target?.removeEventListener?.(type, fn, capture));
  };
  const close = () => {
    if (closed) return;
    closed = true;
    for (const off of offs.splice(0)) off();
    try { pop.remove(); } catch { /* already gone */ }
  };
  const finish = (kind, value) => {
    if (picked || closed) return;
    picked = true;
    close();
    if (kind === "remove") onRemove?.(null);
    else onPick?.(value);
  };
  const rowOf = (event) => {
    const target = event?.target?.closest?.("button");
    if (target && pop.contains(target)) return target;
    const active = doc.activeElement?.closest?.("button");
    if (active && pop.contains(active)) return active;
    return null;
  };
  const onKey = (event) => {
    if (closed) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      focusEl(anchor);
      return;
    }
    if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    const inside = pop.contains?.(event.target) || pop.contains?.(doc.activeElement);
    if (!inside) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Enter" || event.key === " ") {
      const row = rowOf(event);
      if (!row) return;
      if (row.getAttribute("data-remove") === "true") finish("remove", null);
      else finish("pick", row.getAttribute("data-name"));
      return;
    }
    const buttons = [...pop.querySelectorAll("button")];
    const index = buttons.indexOf(rowOf(event));
    const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      try { next.focus({ preventScroll: true }); } catch { next.focus?.(); }
    }
  };

  for (const row of pop.querySelectorAll("button")) {
    on(row, "click", (event) => {
      event.stopPropagation();
      if (row.getAttribute("data-remove") === "true") finish("remove", null);
      else finish("pick", row.getAttribute("data-name"));
    });
  }
  for (const type of ["pointerdown", "mousedown", "pointerup", "click", "dblclick", "wheel", "contextmenu"]) {
    on(pop, type, (event) => event.stopPropagation());
  }
  on(doc, "pointerdown", (event) => {
    if (!pop.contains?.(event.target) && !anchor?.contains?.(event.target)) close();
  }, true);
  on(doc, "mousedown", (event) => {
    if (!pop.contains?.(event.target) && !anchor?.contains?.(event.target)) close();
  }, true);
  on(win, "keydown", onKey, true);
  on(pop, "keydown", onKey);

  const rect = anchor?.getBoundingClientRect?.() || { left: 0, top: 0, right: 16, bottom: 16, width: 16, height: 16 };
  if (home) placeNearAnchor(pop, rect, home, { gap: 6 });
  const focusRow = currentRow || pop.querySelector("button");
  try { focusRow?.focus?.({ preventScroll: true }); } catch { focusRow?.focus?.(); }
  return { close, el: pop };
}
