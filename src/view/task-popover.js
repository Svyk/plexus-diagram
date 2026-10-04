// Small popover for one task chip: due, project, priority or repeat. Opening writes nothing. A pick calls
// Better Tasks (bt.modify), never a BT_attr block, so the attribute child keeps its uid and Better Tasks' own
// normalisation and activity log apply. Cmd+Z after a pick is Roam's undo, not the Plexus ledger.

import { dayChoices } from "../model/tasks.js";
import { placeNearAnchor } from "./avoid.js";

const PRIORITIES = ["low", "medium", "high"];
const GAP = 6;

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
    close();
    if (!root || !FILL[kind]) return false;
    openFor = uid;
    node = el("div", "pxd-task-pop pxd-chrome", root);
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-label", `${TITLES[kind]} for this task`);
    node.setAttribute("data-task-pop", kind);
    el("div", "pxd-task-pop__title", node, TITLES[kind]);
    FILL[kind](node, uid);
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
    on(doc, "keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }, true);
    on(doc, "wheel", (event) => { if (!node?.contains?.(event.target)) close(); }, true);
    return true;
  }

  return { open, close, isOpen: () => Boolean(node), dispose: close };
}
