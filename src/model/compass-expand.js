// Pure plan for Expand with Compass: which neighbors, where they sit, which way the arrow points.
import { rectsIntersect } from "./geometry.js";
import { DEFAULT_SIZES } from "./schema.js";

const RANK = { north: 0, south: 1, west: 2, east: 3 };
const GAP = 24;
const OUT = 40;
const KEEP = 12;

export function canExpandCard(item) {
  if (!item || item.type === "section" || item.type === "text") return false;
  if (item.kind === "page" || item.target?.kind === "page") {
    return Boolean(item.target?.uid || item.target?.title || item.title);
  }
  if (item.kind === "block" || item.target?.kind === "block") return Boolean(item.target?.uid);
  return false;
}

export function compassExpandTarget(item) {
  if (!canExpandCard(item)) return null;
  if (item.kind === "page" || item.target?.kind === "page") {
    return { kind: "page", uid: item.target?.uid || "", title: item.target?.title || item.title || "" };
  }
  return { kind: "block", uid: item.target?.uid || "" };
}

function targetUid(item) {
  const uid = item?.target?.uid;
  return typeof uid === "string" && uid ? uid : "";
}

export function selectCompassNodes(nodes, items, limit = KEEP) {
  const onBoard = new Set();
  const list = items?.values ? items.values() : items;
  for (const item of list || []) {
    const uid = targetUid(item);
    if (uid) onBoard.add(uid);
  }
  const ranked = [];
  const raw = Array.isArray(nodes) ? nodes : [];
  for (let index = 0; index < raw.length; index++) {
    const node = raw[index];
    if (!node || typeof node.uid !== "string" || !node.uid) continue;
    if (!(node.zone in RANK)) continue;
    if (onBoard.has(node.uid)) continue;
    ranked.push({ node, index });
  }
  ranked.sort((a, b) => RANK[a.node.zone] - RANK[b.node.zone] || a.index - b.index);
  return ranked.slice(0, limit).map((row) => row.node);
}

// [[Title]] for a page, ((uid)) for a block. A page title with [ or ] cannot be a wiki link.
export function compassCardString(node) {
  if (!node) return null;
  if (node.kind === "block") {
    const uid = String(node.uid || "").trim();
    if (!/^[\w-]+$/.test(uid)) return null;
    return `((${uid}))`;
  }
  const title = String(node.title ?? "").trim();
  if (!title || title.includes("[") || title.includes("]")) return null;
  return `[[${title}]]`;
}

function shove(box, zone, occupied) {
  let next = box;
  for (let n = 0; n < 64; n++) {
    const hit = occupied.find((r) => r && Number.isFinite(r.x) && Number.isFinite(r.w) && Number.isFinite(r.h) && rectsIntersect(next, r));
    if (!hit) return next;
    if (zone === "north") next = { ...next, y: hit.y - next.h - GAP };
    else if (zone === "south") next = { ...next, y: hit.y + hit.h + GAP };
    else if (zone === "west") next = { ...next, x: hit.x - next.w - GAP };
    else next = { ...next, x: hit.x + hit.w + GAP };
  }
  return next;
}

function slotOf(node, rect, string) {
  return {
    string,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    zone: node.zone,
    label: String(node.label ?? "").trim(),
    nodeUid: node.uid,
  };
}

// North and south are rows. West and east are columns. 40 from the card, 24 between cards.
// A slot that hits an existing card or text moves further out until it is clear. Sections are frames, not obstacles.
export function placeCompassSlots(anchor, nodes, occupied, size = DEFAULT_SIZES.card) {
  const groups = { north: [], south: [], west: [], east: [] };
  for (const node of nodes) if (groups[node.zone]) groups[node.zone].push(node);
  const taken = (occupied || []).filter((r) => r && Number.isFinite(r.x)).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  const out = [];
  const row = (list, zone) => {
    const n = list.length;
    if (!n) return;
    const span = n * size.w + (n - 1) * GAP;
    const startX = anchor.x + anchor.w / 2 - span / 2;
    const y = zone === "north" ? anchor.y - OUT - size.h : anchor.y + anchor.h + OUT;
    for (let i = 0; i < n; i++) {
      const base = { x: startX + i * (size.w + GAP), y, w: size.w, h: size.h };
      const rect = shove(base, zone, taken);
      taken.push(rect);
      out.push(slotOf(list[i], rect, list[i].string));
    }
  };
  const col = (list, zone) => {
    const n = list.length;
    if (!n) return;
    const span = n * size.h + (n - 1) * GAP;
    const startY = anchor.y + anchor.h / 2 - span / 2;
    const x = zone === "west" ? anchor.x - OUT - size.w : anchor.x + anchor.w + OUT;
    for (let i = 0; i < n; i++) {
      const base = { x, y: startY + i * (size.h + GAP), w: size.w, h: size.h };
      const rect = shove(base, zone, taken);
      taken.push(rect);
      out.push(slotOf(list[i], rect, list[i].string));
    }
  };
  row(groups.north, "north");
  row(groups.south, "south");
  col(groups.west, "west");
  col(groups.east, "east");
  return out;
}

export function planCompassExpand({ anchor, nodes, items, occupied, size = DEFAULT_SIZES.card } = {}) {
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return [];
  const picked = selectCompassNodes(nodes, items);
  const usable = [];
  for (const node of picked) {
    const string = compassCardString(node);
    if (!string) continue;
    usable.push({ ...node, string });
  }
  if (!usable.length) return [];
  return placeCompassSlots(anchor, usable, occupied, size);
}

// South and east point away from the card. North and west point back at it. An empty label stays empty.
export function compassArrow(anchorUid, card, newUid) {
  const outward = card?.zone === "south" || card?.zone === "east";
  const label = String(card?.label ?? "").trim();
  return outward
    ? { from: anchorUid, to: newUid, label, dir: "one" }
    : { from: newUid, to: anchorUid, label, dir: "one" };
}

// Cards and arrows are one undo step when session.host.group exists. Otherwise the card batch is one
// transaction and each arrow is its own.
export async function writeCompassExpand(session, anchorUid, cards) {
  const write = async () => {
    const made = await Promise.resolve(session.addRefCards?.(cards.map((c) => ({
      string: c.string,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
    }))));
    const ids = Array.isArray(made) ? made : [];
    const uids = [];
    for (let i = 0; i < cards.length; i++) {
      const uid = ids[i];
      if (!uid) continue;
      uids.push(uid);
      await Promise.resolve(session.addEdge?.(compassArrow(anchorUid, cards[i], uid)));
    }
    return uids;
  };
  if (typeof session?.host?.group === "function") return session.host.group(write);
  return write();
}
