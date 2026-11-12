// Shared board writes for the AI tools and window.PlexusDiagram.
// The AI path passes context so asUser stamps the AI. The public path passes none, so the write is the human's.
import { buildBoard, worldRects } from "./board.js";
import { MAX_GROUP_WRITES } from "../host/roam.js";
import { boardVersion } from "./public-api.js";
import { DIRS } from "./schema.js";

export const ADD_CAP = 45;

export function boardUidOf(raw) {
  const s = String(raw ?? "").trim().replace(/^\(\(/, "").replace(/\)\)$/, "").trim();
  if (!s) throw new Error("Give a board uid");
  return s;
}

export function boardsMatching(rows, page) {
  const needle = String(page ?? "").trim().toLowerCase();
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((r) => !needle || String(r.pageTitle ?? "").toLowerCase().includes(needle));
}

export function publicBoardRows(rows, page) {
  return boardsMatching(rows, page).map((r) => ({
    uid: r.uid,
    title: r.title,
    pageUid: r.pageUid,
    pageTitle: r.pageTitle,
    cards: r.count,
  }));
}

// Where new things go: left of the board, below everything (or the origin on an empty board).
function boardArea(board, rects) {
  let left = Infinity;
  let bottom = -Infinity;
  for (const item of board.items.values()) {
    if (item.parentUid !== board.uid) continue;
    const r = rects.get(item.uid);
    if (!r) continue;
    left = Math.min(left, r.x);
    bottom = Math.max(bottom, r.y + r.h);
  }
  return Number.isFinite(left) ? { x: left, y: bottom + 80 } : { x: 0, y: 0 };
}

export function autoPlace(n, area, { w = 280, h = 160, gap = 40, cols = 4 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: area.x + (i % cols) * (w + gap), y: area.y + Math.floor(i / cols) * (h + gap) });
  }
  return out;
}

const NOT_BOARD = "Not a Plexus board. Open it in Roam and run Plexus: Enhance this diagram first.";

export function loadPlexusBoard(raw, pullBoard) {
  const uid = boardUidOf(raw);
  const pulled = typeof pullBoard === "function" ? pullBoard(uid) : null;
  if (boardVersion(pulled) !== 2) throw new Error(NOT_BOARD);
  const board = buildBoard(pulled);
  if (!board) throw new Error(NOT_BOARD);
  return { uid, board };
}

export function assertCardBatch(cards) {
  const list = Array.isArray(cards) ? cards : [];
  if (!list.length) throw new Error("Give at least one card");
  if (list.length > ADD_CAP) throw new Error("At most 45 cards per call (Roam undo holds 50 changes)");
  return list;
}

// joinPlaced: a card that brought its own x and y still joins the section (the public API).
// Otherwise only auto-placed cards do, including rows past the section's bottom; auto-fit grows it around them.
export function placeCards(board, cards, section, { joinPlaced = false } = {}) {
  const rects = worldRects(board);
  let area = boardArea(board, rects);
  let cols = 4;
  let into = null;
  if (section) {
    const sec = board.items.get(boardUidOf(section));
    if (!sec || sec.type !== "section") throw new Error(`Not a section on this board: ${section}`);
    const r = rects.get(sec.uid);
    area = { x: r.x + 24, y: r.y + 60 };
    cols = Math.max(1, Math.floor((r.w - 24) / 320));
    into = sec.uid;
  }
  const slots = autoPlace(cards.length, area, { cols });
  return cards.map((c, i) => {
    const text = String(c?.text ?? "").trim();
    if (!text) throw new Error("Every card needs text");
    const placed = Number.isFinite(c.x) && Number.isFinite(c.y);
    const card = { string: text, x: placed ? c.x : slots[i].x, y: placed ? c.y : slots[i].y };
    if (into && (joinPlaced || !placed)) card.into = into;
    return card;
  });
}

export function prepareSection(board, spec = {}) {
  const area = boardArea(board, worldRects(board));
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const rect = { x: num(spec.x, area.x), y: num(spec.y, area.y), w: num(spec.w, 640), h: num(spec.h, 400) };
  const title = String(spec.title ?? "").trim() || "Section";
  return { rect, title };
}

export function prepareEdges(board, edges) {
  const list = Array.isArray(edges) ? edges : (edges && typeof edges === "object" ? [edges] : []);
  if (!list.length) throw new Error("Give at least one connection");
  if (list.length > ADD_CAP) throw new Error("At most 45 connections per call (Roam undo holds 50 changes)");
  return list.map((edge) => {
    const from = boardUidOf(edge?.from);
    const to = boardUidOf(edge?.to);
    for (const id of [from, to]) if (!board.items.has(id)) throw new Error(`Not an item on this board: ${id}`);
    const dir = DIRS.includes(edge?.direction) ? edge.direction : "one";
    return { from, to, label: String(edge?.label ?? ""), dir };
  });
}

// Several arrows are one undo step when the session host can group writes. Otherwise each addEdge is its own step.
export async function writeEdges(session, edges) {
  const write = async () => {
    const uids = [];
    for (const edge of edges) {
      const uid = await session.addEdge(edge);
      uids.push(uid || null);
      if (!uid) break;
    }
    return uids;
  };
  if (edges.length > 1 && typeof session?.host?.group === "function") return session.host.group(write);
  return write();
}

export async function runBoardWrite({ context, raw, withSession, pullBoard, fn }) {
  const { uid } = loadPlexusBoard(raw, pullBoard);
  if (typeof withSession !== "function") throw new Error("Board not loaded");
  return withSession(uid, async (session) => {
    if (!session?.board) throw new Error("Board not loaded");
    let pending;
    let ran = false;
    const go = () => {
      ran = true;
      pending = session.asUser(context?.tokenUserUid, () => fn(session), { maxWrites: MAX_GROUP_WRITES });
      return pending;
    };
    if (typeof context?.asTokenUser === "function") context.asTokenUser(go);
    else go();
    if (!ran) throw new Error("Roam did not run the write");
    try {
      return await pending;
    } catch (err) {
      if (/one undo step holds/.test(String(err?.message))) throw err;
      throw new Error(`Roam did not save this change (${err?.message || err}). Plexus reloaded the board: read it and try again.`);
    }
  });
}
