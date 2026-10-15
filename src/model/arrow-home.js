import { isDiagramString } from "../discovery.js";
import { anchorUid } from "./board.js";
import { firstLine, parseBoardTitle, plainText, readPlexus, UNTITLED_BOARD } from "./schema.js";

// The ancestor pull feature.js already uses. Exact string, so a broader board pull is left alone.
export const HOME_PULL = "[:block/uid :block/string {:block/parents [:block/uid :block/string :block/props {:block/parents [:db/id]}]}]";

// One pull_many of the cards on a nested board. Not a datalog `:in $ [?u ...]`.
export const REFS_PULL = "[:block/uid {(limit :block/_refs nil) [:block/uid :block/string :block/props {:block/parents [:block/uid :block/string :block/props {:block/parents [:db/id]}]}]}]";

function nodeUid(node) {
  return node?.[":block/uid"] ?? node?.uid ?? "";
}

function nodeString(node) {
  return String(node?.[":block/string"] ?? node?.string ?? "");
}

function parentNodes(node) {
  const parents = node?.[":block/parents"] ?? node?.parents;
  return Array.isArray(parents) ? parents : [];
}

function clipTitle(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "Untitled";
  return t.length > 22 ? `${t.slice(0, 21)}\u2026` : t;
}

const BLOCK_ONLY = /^\(\(([\w-]+)\)\)$/;

function titleFromString(text, resolve) {
  const raw = String(text || "").trim();
  if (isDiagramString(raw)) return clipTitle(parseBoardTitle(raw) || firstLine(raw) || "Untitled");
  const ref = BLOCK_ONLY.exec(raw);
  if (ref && typeof resolve === "function") {
    let target = "";
    try { target = resolve(ref[1]); } catch { target = ""; }
    if (typeof target === "string" && target.trim() && !BLOCK_ONLY.test(target.trim())) {
      return titleFromString(target, null);
    }
  }
  return clipTitle(firstLine(raw) || plainText(raw, 80) || "Untitled");
}

export function cardTitleOf(node, resolve) {
  return titleFromString(nodeString(node), resolve);
}

// Midpoint pill. A typed label stays, with refs and markup flattened. A label that is only the
// missing end's ref shows that card's short title. The stored edge string is left alone.
export function shownEdgeLabel(label, homes) {
  const custom = plainText(String(label ?? ""), 80);
  if (custom) return clipTitle(custom);
  const list = Array.isArray(homes) ? homes : [];
  for (const home of list) {
    const title = String(home?.title || "").trim();
    if (title) return clipTitle(title);
  }
  return "";
}

// Endpoint uids that are not cards or edges on this board. Those are the ones that may live inside a board card.
export function unresolvedUids(board) {
  const out = [];
  const seen = new Set();
  for (const edge of board?.edges?.values?.() || []) {
    for (const uid of [edge.from, edge.to]) {
      if (!uid || seen.has(uid) || board.items.has(uid) || board.edges.has(uid)) continue;
      seen.add(uid);
      out.push(uid);
    }
  }
  return out;
}

// Nearest enhanced board card on this board that contains the pulled block. A shown card wins over a
// collapsed one further in; if every ancestor board is folded, the nearest one is still the home.
export function homeOf(board, node, resolve) {
  if (!board?.items || !node) return null;
  const hits = [];
  for (const parent of parentNodes(node)) {
    const uid = nodeUid(parent);
    const item = uid ? board.items.get(uid) : null;
    if (!item || item.kind !== "board" || !item.enhanced) continue;
    hits.push({ uid, depth: parentNodes(parent).length });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.depth - a.depth);
  const shown = hits.find((hit) => anchorUid(board, hit.uid) === hit.uid);
  const best = shown || hits[0];
  return { cardUid: best.uid, title: cardTitleOf(node, resolve) };
}

export function boardIsNested(node) {
  for (const parent of parentNodes(node)) {
    if (!isDiagramString(nodeString(parent))) continue;
    if (readPlexus(parent?.[":block/props"] ?? parent?.props)?.v === 2) return true;
  }
  return false;
}

function pullNodes(pullMany, pattern, uids) {
  if (!uids.length || typeof pullMany !== "function") return [];
  let nodes = [];
  try { nodes = pullMany(pattern, uids) || []; } catch { nodes = []; }
  return Array.isArray(nodes) ? nodes : [];
}

function byUid(nodes) {
  const map = new Map();
  for (const node of nodes || []) {
    const uid = nodeUid(node);
    if (uid) map.set(uid, node);
  }
  return map;
}

// Map of unresolved uid → { cardUid, title } or null. A miss is null. Nothing is deleted.
export function resolveArrowHomes(board, pullMany, resolve) {
  const uids = unresolvedUids(board);
  const out = new Map();
  if (!uids.length) return out;
  const found = byUid(pullNodes(pullMany, HOME_PULL, uids));
  for (const uid of uids) {
    const node = found.get(uid);
    out.set(uid, node ? homeOf(board, node, resolve) : null);
  }
  return out;
}

function outsidePlace(node) {
  let best = null;
  let depth = -1;
  for (const parent of parentNodes(node)) {
    if (!isDiagramString(nodeString(parent))) continue;
    if (readPlexus(parent?.[":block/props"] ?? parent?.props)?.v !== 2) continue;
    const d = parentNodes(parent).length;
    if (d < depth) continue;
    depth = d;
    best = parent;
  }
  if (!best) return null;
  return { uid: nodeUid(best), title: parseBoardTitle(nodeString(best)) || UNTITLED_BOARD };
}

// Map of card uid → arrows that stay on an outer board. Empty for a top-level board, after one parent pull.
export function resolveOutsideArrows(board, pullMany, resolve) {
  const out = new Map();
  if (!board?.uid || !board.items) return out;
  const self = byUid(pullNodes(pullMany, HOME_PULL, [board.uid])).get(board.uid);
  if (!self || !boardIsNested(self)) return out;
  const cards = [];
  for (const item of board.items.values()) {
    if (item.type === "section") continue;
    cards.push(item.uid);
  }
  if (!cards.length) return out;
  const pending = [];
  const seen = new Set();
  for (const node of pullNodes(pullMany, REFS_PULL, cards)) {
    const cardUid = nodeUid(node);
    if (!cardUid || !board.items.has(cardUid)) continue;
    const refs = node?.[":block/_refs"] ?? node?.refs;
    if (!Array.isArray(refs)) continue;
    for (const ref of refs) {
      const plexus = readPlexus(ref?.[":block/props"] ?? ref?.props);
      if (plexus?.type !== "edge") continue;
      const edgeUid = nodeUid(ref);
      if (!edgeUid || seen.has(edgeUid) || board.edges.has(edgeUid)) continue;
      const from = plexus.from;
      const to = plexus.to;
      if (from !== cardUid && to !== cardUid) continue;
      const otherUid = from === cardUid ? to : from;
      if (!otherUid || board.items.has(otherUid)) continue;
      seen.add(edgeUid);
      pending.push({ cardUid, otherUid, edgeUid });
    }
  }
  if (!pending.length) return out;
  const others = byUid(pullNodes(pullMany, HOME_PULL, [...new Set(pending.map((row) => row.otherUid))]));
  for (const row of pending) {
    const node = others.get(row.otherUid);
    const place = node ? outsidePlace(node) : null;
    if (!node || !place?.uid) continue;
    const list = out.get(row.cardUid) || [];
    list.push({
      edgeUid: row.edgeUid,
      otherUid: row.otherUid,
      otherTitle: cardTitleOf(node, resolve),
      boardUid: place.uid,
      boardTitle: place.title,
    });
    out.set(row.cardUid, list);
  }
  return out;
}

export function outsideBadgeText(n) {
  return `↗ ${n}`;
}

export function outsideTip(list) {
  return (list || []).map((row) => `from ${row.otherTitle} on ${row.boardTitle}`).join("\n");
}
