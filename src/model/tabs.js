// Fullscreen board tabs. Local only: a uid list, capped, no Roam writes.

export const TAB_CAP = 9;

export function tabStorageKey(graph) {
  return `plexus-diagram:fullscreen-tabs:${graph || ""}`;
}

export function normalizeTabs(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const uid = typeof item === "string" ? item : item?.uid;
    if (typeof uid !== "string" || uid === "" || seen.has(uid)) continue;
    seen.add(uid);
    const title = typeof item === "string" ? "" : String(item?.title || "");
    out.push({ uid, title });
    if (out.length >= TAB_CAP) break;
  }
  return out;
}

// Opening a board adds it and selects it. A board already in the list stays put.
// Past the cap, the oldest tab drops so the board on screen is always a tab.
export function openTab(tabs, entry) {
  const uid = typeof entry === "string" ? entry : entry?.uid;
  const title = typeof entry === "string" ? "" : String(entry?.title || "");
  const list = normalizeTabs(tabs);
  if (!uid) return { tabs: list, index: list.length ? 0 : -1 };
  const at = list.findIndex((tab) => tab.uid === uid);
  if (at >= 0) {
    if (title && title !== list[at].title) list[at] = { uid, title };
    return { tabs: list, index: at };
  }
  if (list.length >= TAB_CAP) list.shift();
  list.push({ uid: String(uid), title });
  return { tabs: list, index: list.length - 1 };
}

// Removing a tab does not delete the board. `index` is the neighbor that slides into the gap.
export function closeTab(tabs, uid) {
  const list = normalizeTabs(tabs);
  const at = list.findIndex((tab) => tab.uid === uid);
  if (at < 0) return { tabs: list, index: -1, removed: false };
  const next = list.filter((tab) => tab.uid !== uid);
  const index = next.length ? Math.min(at, next.length - 1) : -1;
  return { tabs: next, index, removed: true };
}

export function tabAt(tabs, index) {
  const list = normalizeTabs(tabs);
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0 || n >= list.length) return null;
  return list[n];
}

// Cmd/Ctrl+1..9. Shift+1 and Shift+2 stay the zoom shortcuts (they have no meta/ctrl).
export function isBoardTabEvent(ev, n) {
  if (!ev || !Number.isInteger(n) || n < 1 || n > TAB_CAP) return false;
  if (!(ev.meta || ev.ctrl) || ev.alt || ev.shift) return false;
  const key = String(ev.key ?? "");
  const code = String(ev.code ?? "");
  if (code === `Digit${n}`) return key === "" || key === String(n);
  return key === String(n) && (code === "" || code === `Digit${n}`);
}
