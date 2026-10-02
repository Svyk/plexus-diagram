// Snapshot layout for one board. JSON only. No Roam calls.
// A snapshot records x, y, w, h, color, collapsed, and parent uid.

import { readPlexus } from "./schema.js";

export const SNAPSHOTS_TITLE = "Snapshots";
export const SNAPSHOT_KEEP = 10;
export const SNAPSHOT_CHUNK = 45;

const pad = (n) => String(n).padStart(2, "0");

export function snapshotTitle(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function captureLayout(board) {
  const items = [];
  for (const uid of board?.order || []) {
    const item = board.items?.get?.(uid);
    if (!item) continue;
    items.push({
      uid,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      color: item.color || null,
      collapsed: item.collapsed === true,
      parent: item.parentUid,
    });
  }
  return items;
}

export function snapshotProps(items) {
  return { type: "snapshot", json: JSON.stringify({ items: items || [] }) };
}

export function parseSnapshot(plexus) {
  if (!plexus || plexus.type !== "snapshot" || typeof plexus.json !== "string") return null;
  try {
    const data = JSON.parse(plexus.json);
    if (!Array.isArray(data?.items)) return null;
    return data.items.filter((item) => item && typeof item.uid === "string");
  } catch {
    return null;
  }
}

export function listFromNodes(nodes) {
  const out = [];
  for (const node of nodes || []) {
    const items = parseSnapshot(readPlexus(node?.[":block/props"]));
    if (!items) continue;
    out.push({
      uid: node[":block/uid"],
      title: node[":block/string"] || "",
      items,
    });
  }
  return out;
}

// Block order is oldest first. Restore offers the 10 newest. Older stay listed.
export function partitionSnapshots(list) {
  const all = (list || []).filter((item) => item?.uid && item.title);
  const olderCount = Math.max(0, all.length - SNAPSHOT_KEEP);
  return {
    newest: all.slice(olderCount).reverse(),
    older: all.slice(0, olderCount).reverse(),
  };
}

function changed(item, entry) {
  return item.x !== entry.x
    || item.y !== entry.y
    || item.w !== entry.w
    || item.h !== entry.h
    || (item.color || null) !== (entry.color || null)
    || item.collapsed !== (entry.collapsed === true);
}

export function planRestore(entries, board) {
  const units = [];
  for (const entry of entries || []) {
    const item = board?.items?.get?.(entry?.uid);
    if (!item || !entry) continue;
    const unit = [];
    const parent = entry.parent;
    const parentOk = parent === board.uid || board.items.get(parent)?.type === "section";
    if (parentOk && parent !== item.parentUid) unit.push({ op: "move", uid: item.uid, parent });
    if (changed(item, entry)) {
      unit.push({
        op: "props",
        uid: item.uid,
        x: entry.x,
        y: entry.y,
        w: entry.w,
        h: entry.h,
        color: entry.color || null,
        collapsed: entry.collapsed === true,
      });
    }
    if (unit.length) units.push(unit);
  }
  const chunks = [];
  let chunk = [];
  for (const unit of units) {
    if (chunk.length && chunk.length + unit.length > SNAPSHOT_CHUNK) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(...unit);
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
