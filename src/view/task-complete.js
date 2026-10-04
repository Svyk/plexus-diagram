// RE-1: complete a task the way a user does, so Better Tasks writes the Completed date AND spawns the next
// occurrence of a repeating task. Better Tasks exposes no tool for that: bt_modify({status: "DONE"}) flips the
// marker and writes Completed, but recurrence only starts from its checkbox observer (document-level pointerdown
// and change on `.check-container input` / `.rm-checkbox input`, see better-tasks src/index.js _onCheckboxPointer
// and _onCheckboxChange). So the task block is rendered closed in a hidden holder inside the board root, the same
// pointerdown + click a user makes is sent to its real Roam checkbox, and the holder is unmounted afterwards.
// Nothing here writes a BT_attr block.

import { taskState } from "../model/tasks.js";

const CHECKBOX = ".check-container input, .rm-checkbox input";
const FIND_MS = 2500;
const DONE_MS = 3000;
const POLL_MS = 40;
const GRACE_MS = 400;

export function createTaskCompleter({ doc = globalThis.document, getRoot, host, bt, win = doc?.defaultView || globalThis } = {}) {
  const busy = new Map();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const until = async (probe, limit) => {
    const end = Date.now() + limit;
    for (;;) {
      const hit = probe();
      if (hit) return hit;
      if (Date.now() >= end) return null;
      await wait(POLL_MS);
    }
  };

  const fire = (target, type) => {
    const Ctor = win.PointerEvent || win.MouseEvent || win.Event;
    target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, pointerType: "mouse", button: 0 }));
  };

  const run = async (uid) => {
    const root = getRoot?.();
    if (!root || typeof host?.renderBlock !== "function" || !bt?.available?.()) return { ok: false, reason: "unavailable" };
    if (taskState(host.blockString?.(uid)) === "DONE") return { ok: true, already: true };
    const holder = doc.createElement("div");
    holder.className = "pxd-task-holder";
    holder.setAttribute("aria-hidden", "true");
    const mount = doc.createElement("div");
    holder.append(mount);
    root.append(holder);
    const cleanup = () => {
      try { host.unmount?.(mount); } catch { /* nothing mounted */ }
      try { holder.remove(); } catch { /* already gone */ }
    };
    try {
      try { host.renderBlock(mount, uid, { open: false }); } catch (error) { return { ok: false, reason: String(error?.message || error) }; }
      const input = await until(() => mount.querySelector?.(CHECKBOX), FIND_MS);
      if (!input) return { ok: false, reason: "no checkbox rendered" };
      // Better Tasks marks a user interaction on pointerdown, then reads the change event the click causes.
      fire(input, "pointerdown");
      input.click();
      const done = await until(() => taskState(host.blockString?.(uid)) === "DONE", DONE_MS);
      if (!done) return { ok: false, reason: "the block did not turn DONE" };
      await wait(GRACE_MS);
      return { ok: true };
    } finally {
      cleanup();
    }
  };

  return {
    // One click per task at a time: a second call while one is running returns the same promise.
    complete(uid) {
      if (!uid) return Promise.resolve({ ok: false, reason: "no uid" });
      if (busy.has(uid)) return busy.get(uid);
      const p = run(uid).catch((error) => ({ ok: false, reason: String(error?.message || error) })).finally(() => busy.delete(uid));
      busy.set(uid, p);
      return p;
    },
    pending: () => busy.size,
  };
}
