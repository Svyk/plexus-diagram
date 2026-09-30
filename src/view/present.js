// Presentation mode: steps through the top-level sections in outline order (or the whole board when there
// are none). The view fits each step's rect and dims everything outside `members`; this module owns only the
// step list and the HUD.

import { boundsOf, outlineOrder } from "../model/board.js";

const collectMembers = (board, uid) => {
  const out = new Set();
  const stack = [uid];
  while (stack.length) {
    const u = stack.pop();
    if (out.has(u)) continue;
    out.add(u);
    stack.push(...(board.items.get(u)?.members ?? []));
  }
  return out;
};

export function createPresenter({ doc = globalThis.document, root, timers, on = {} } = {}) {
  let steps = [];
  let index = -1;
  let active = false;
  let hud = null;
  let titleEl = null;
  let countEl = null;
  let prevBtn = null;
  let nextBtn = null;
  const offs = [];

  const el = (tag, cls, parent, text) => {
    const n = doc.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    parent?.append(n);
    return n;
  };
  const button = (parent, cls, label, fn) => {
    const b = el("button", `pxd-btn ${cls}`, parent, label);
    b.type = "button";
    const click = (event) => { event.preventDefault?.(); event.stopPropagation?.(); fn(); };
    const stop = (event) => event.stopPropagation?.();
    b.addEventListener("click", click);
    b.addEventListener("pointerdown", stop);
    b.addEventListener("dblclick", stop);
    offs.push(() => { b.removeEventListener("click", click); b.removeEventListener("pointerdown", stop); b.removeEventListener("dblclick", stop); });
    return b;
  };

  const paint = () => {
    const s = steps[index];
    if (!hud || !s) return;
    titleEl.textContent = s.title || "";
    countEl.textContent = `${index + 1} / ${steps.length}`;
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= steps.length - 1;
    prevBtn.setAttribute("aria-disabled", String(index <= 0));
    nextBtn.setAttribute("aria-disabled", String(index >= steps.length - 1));
  };

  const goto = (i) => {
    if (!active || !steps.length) return false;
    const next = Math.max(0, Math.min(steps.length - 1, Math.trunc(Number(i))));
    if (!Number.isFinite(next)) return false;
    index = next;
    paint();
    const s = steps[index];
    on.step?.({ index, total: steps.length, uid: s.uid, rect: s.rect, title: s.title, members: s.members });
    return true;
  };

  const teardown = () => {
    offs.splice(0).forEach((off) => off());
    hud?.remove();
    hud = titleEl = countEl = prevBtn = nextBtn = null;
  };

  const stop = () => {
    if (!active) return false;
    active = false;
    teardown();
    steps = [];
    index = -1;
    on.exit?.();
    return true;
  };

  const start = (board, rects) => {
    if (!board) return false;
    if (active) { teardown(); active = false; }
    const rootSet = new Set(board.roots);
    const sections = outlineOrder(board).filter((u) => rootSet.has(u) && board.items.get(u)?.type === "section" && rects.get(u));
    steps = sections.map((uid) => ({
      uid,
      rect: rects.get(uid),
      title: board.items.get(uid).title || "",
      members: collectMembers(board, uid),
    }));
    if (!steps.length) {
      const all = [...board.items.keys()].filter((u) => rects.get(u));
      if (!all.length) return false;
      steps = [{ uid: null, rect: boundsOf(all.map((u) => rects.get(u))), title: board.title || "", members: new Set(all) }];
    }
    active = true;
    hud = el("div", "pxd-present-hud pxd-chrome", root);
    titleEl = el("span", "pxd-present-hud__title", hud);
    countEl = el("span", "pxd-present-hud__count", hud);
    prevBtn = button(hud, "pxd-present-hud__prev", "Prev", () => goto(index - 1));
    nextBtn = button(hud, "pxd-present-hud__next", "Next", () => goto(index + 1));
    button(hud, "pxd-present-hud__exit", "Exit", () => stop());
    goto(0);
    return true;
  };

  return {
    start,
    next: () => goto(index + 1),
    prev: () => goto(index - 1),
    goto,
    stop,
    isActive: () => active,
    index: () => index,
    total: () => steps.length,
    dispose() { if (active) stop(); else teardown(); },
  };
}
