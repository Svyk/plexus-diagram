// The board's table of contents: sections and landmarks in outline order (the presenter's order), then
// trails, then saved views. Pure and read-only: one outlineOrder pass, no per-item walks.
import { outlineOrder } from "./board.js";
import { plainText } from "./schema.js";

export function boardContents(board) {
  const rows = [];
  if (!board?.items) return { rows, sig: "" };
  for (const uid of outlineOrder(board)) {
    const it = board.items.get(uid);
    if (!it) continue;
    const depth = Number.isFinite(it.depth) ? it.depth : 0;
    if (it.type === "section") {
      const row = { kind: "section", uid, title: plainText(it.title || it.string, 80) || "Section", depth, count: it.members.length, color: it.color || null };
      if (it.landmark === true) row.glyph = it.glyph || "";
      rows.push(row);
    } else if (it.landmark === true) {
      rows.push({ kind: "landmark", uid, title: plainText(it.title || it.string, 80) || "Card", depth, glyph: it.glyph || "" });
    }
  }
  for (const trail of board.trails || []) {
    let count = 0;
    for (const stop of trail?.stops || []) if (stop?.ref && board.items.has(stop.ref)) count += 1;
    rows.push({ kind: "trail", uid: trail.uid, title: trail.name || "Trail", count });
  }
  for (const view of board.views || []) rows.push({ kind: "view", uid: view.uid, title: view.caption || "View" });
  return { rows, sig: rowsSig(rows) };
}

export function rowsSig(rows) {
  let out = "";
  for (const r of rows) out += `${r.kind || "section"}\u0001${r.uid}\u0001${r.title ?? ""}\u0001${r.depth ?? 0}\u0001${r.count ?? ""}\u0001${r.color ?? ""}\u0001${r.glyph ?? ""}\u0002`;
  return out;
}
