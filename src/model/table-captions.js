// "Fold tables under captions": old-form table cards (the card block is the {{[[table]]}} itself) become a folded
// caption block in the same place with the table under it. Roam renders a table's rows even when the table block is
// folded, but it does not render the children of a folded block, so the board's outline stops paying for every row.
import { edgeString, semanticRef } from "./schema.js";
import { isRoamTableString, rowsCaption } from "./roam-table.js";

// An old-form table card on this board (sections included).
export function isOldTableCard(item) {
  return Boolean(item && item.type === "card" && !item.tableUid && isRoamTableString(item.string));
}

export function oldTableCards(board) {
  const out = [];
  for (const item of board?.items?.values?.() || []) if (isOldTableCard(item)) out.push(item);
  return out;
}

// The dry-run plan. deps:
//   layoutOf(uid) -> the raw :plexus props on the table block (copied to the caption)
//   newUid()      -> a fresh block uid
//   captionOf(item) -> a title Plexus already has for the table ("" when none; "Table · N rows" then)
// Out: { graph, boardUid, folds, edges }. folds[i] = { tableUid, captionUid, parentUid, order, caption, layout }.
// edges[i] = { uid, from, to, fromBlock?, toBlock?, string } for every connection that names a folded table card.
export function planTableCaptions(board, { graph = "", layoutOf, newUid, captionOf } = {}) {
  const plan = { graph, boardUid: board?.uid || "", folds: [], edges: [] };
  if (!board?.items) return plan;
  const call = (fn, ...args) => {
    try { return typeof fn === "function" ? fn(...args) : null; } catch { return null; }
  };
  const folded = new Map();
  for (const item of oldTableCards(board)) {
    const captionUid = String(call(newUid) || "");
    if (!captionUid) continue;
    const layout = call(layoutOf, item.uid);
    const fold = {
      tableUid: item.uid,
      captionUid,
      parentUid: item.parentUid,
      order: Number.isInteger(item.order) ? item.order : 0,
      caption: String(call(captionOf, item) || "").replace(/\s+/g, " ").trim() || rowsCaption((item.content || []).length),
      layout: layout && typeof layout === "object" ? { ...layout } : { type: "card", x: item.x, y: item.y, w: item.w, h: item.h },
    };
    plan.folds.push(fold);
    folded.set(item.uid, fold);
  }
  if (!folded.size) return plan;
  const swap = (id) => folded.get(id)?.captionUid || id;
  const refOf = (id) => {
    if (folded.has(id)) return `((${folded.get(id).captionUid}))`;
    const item = board.items.get(id);
    return item ? semanticRef(item) : `((${id}))`;
  };
  for (const edge of board.edges?.values?.() || []) {
    const hit = [edge.from, edge.to, edge.fromBlock, edge.toBlock].some((id) => id && folded.has(id));
    if (!hit) continue;
    const fromBlock = edge.fromBlock ? swap(edge.fromBlock) : undefined;
    const toBlock = edge.toBlock ? swap(edge.toBlock) : undefined;
    plan.edges.push({
      uid: edge.uid,
      from: swap(edge.from),
      to: swap(edge.to),
      ...(fromBlock ? { fromBlock } : {}),
      ...(toBlock ? { toBlock } : {}),
      string: edgeString({ srcRef: refOf(edge.from), dstRef: refOf(edge.to), dir: edge.dir, label: edge.label || "", srcBlock: fromBlock, dstBlock: toBlock }),
    });
  }
  return plan;
}

// Lines for the dry-run dialog.
export function tableCaptionLines(plan) {
  const lines = [];
  for (const f of plan?.folds || []) lines.push(`${f.caption}: folded under a caption`);
  if (plan?.edges?.length) lines.push(`${plan.edges.length} ${plan.edges.length === 1 ? "connection" : "connections"} rewritten`);
  return lines;
}
