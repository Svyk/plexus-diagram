// "Changed since last visit". Pure helpers: the visit stamp per board per device, the pull pattern for edit
// times, and the changed list. The host does the one pull_many; nothing here touches Roam.

export const CHANGE_CAP = 500;
const USER = "{:edit/user [:user/display-name {:user/display-page [:node/title]}]}";
export const CHANGE_PULL = `[:db/id :block/uid :edit/time :create/time ${USER} {:block/children [:block/uid :edit/time ${USER} {:block/children [:block/uid :edit/time ${USER}]}]}]`;

export function createVisitStore({ storage = globalThis.localStorage, graph = "" } = {}) {
  const key = (uid) => `plexus-diagram:visit:${graph}:${uid}`;
  return {
    get(uid) {
      try {
        const n = Number(storage?.getItem(key(uid)));
        return Number.isFinite(n) && n > 0 ? n : null;
      } catch { return null; }
    },
    set(uid, time) {
      if (!Number.isFinite(time)) return;
      try { storage?.setItem(key(uid), String(Math.floor(time))); } catch { /* quota or private mode */ }
    },
  };
}

const userName = (user) => {
  const name = user?.[":user/display-name"];
  if (name) return String(name);
  const title = user?.[":user/display-page"]?.[":node/title"];
  return title ? String(title) : "";
};

// Latest edit in a pulled block and its descendants: { time, user }.
export function latestEdit(node) {
  let best = { time: 0, user: "" };
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    const t = Number(n[":edit/time"] ?? n[":create/time"]);
    if (Number.isFinite(t) && t > best.time) best = { time: t, user: userName(n[":edit/user"]) };
    const kids = n[":block/children"];
    if (Array.isArray(kids)) for (const kid of kids) walk(kid);
  };
  if (Array.isArray(node)) for (const part of node) walk(part);
  else walk(node);
  return best;
}

// nodes: Map<cardUid, pulledNode>. Returns the changed cards, newest first.
export function changedSince(nodes, lastVisit, titleOf = (uid) => uid) {
  if (!Number.isFinite(lastVisit)) return [];
  const rows = [];
  for (const [uid, node] of nodes || []) {
    const edit = latestEdit(node);
    if (edit.time > lastVisit) rows.push({ uid, time: edit.time, user: edit.user, title: titleOf(uid) });
  }
  rows.sort((a, b) => b.time - a.time || String(a.uid).localeCompare(String(b.uid)));
  return rows;
}

export function timeAgo(time, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - time) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}
