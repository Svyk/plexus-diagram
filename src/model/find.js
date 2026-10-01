import { plainText } from "./schema.js";

function hayOf(item) {
  const bits = [item?.title, plainText(item?.string, 2000)];
  const kids = Array.isArray(item?.content) ? item.content : [];
  for (const kid of kids) bits.push(plainText(kid?.[":block/string"] ?? kid?.string ?? "", 500));
  return bits.filter(Boolean).join("\n").toLowerCase();
}

// Hits on this board. `nested` is one level of child boards, each { parentUid, board }.
// A nested hit focuses the card on this board that holds that child.
export function findOnBoard(board, query, nested = []) {
  const q = String(query || "").trim().toLowerCase();
  if (!q || !board?.items) return [];
  const hits = [];
  for (const item of board.items.values()) {
    if (!hayOf(item).includes(q)) continue;
    hits.push({ uid: item.uid, focus: item.uid, kind: item.type === "section" ? "section" : "card" });
  }
  for (const edge of board.edges?.values?.() || []) {
    const label = `${edge.label || ""}\n${plainText(edge.string, 500)}`.toLowerCase();
    if (!label.includes(q)) continue;
    hits.push({ uid: edge.uid, focus: edge.from, kind: "edge" });
  }
  for (const nest of nested || []) {
    if (!nest?.board || !nest.parentUid) continue;
    for (const hit of findOnBoard(nest.board, query)) {
      hits.push({ uid: hit.uid, focus: nest.parentUid, kind: "nested", via: nest.parentUid });
    }
  }
  return hits;
}
