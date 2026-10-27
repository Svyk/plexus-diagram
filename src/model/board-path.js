import { isDiagramString } from "../discovery.js";
import { boardLabel, readPlexus, UNTITLED_BOARD } from "./schema.js";

function blockString(node) {
  return String(node?.[":block/string"] ?? node?.string ?? "");
}

function blockUid(node) {
  return node?.[":block/uid"] ?? node?.uid ?? "";
}

function parentCount(node) {
  const parents = node?.[":block/parents"] ?? node?.parents;
  return Array.isArray(parents) ? parents.length : 0;
}

// Root-first board ancestors from one pull of :block/parents, then the board itself.
// A native diagram (no plexus v:2) and a plain bullet are not part of the path.
export function boardPath(parents, self, resolve) {
  const selfUid = self?.uid || "";
  const chain = [];
  for (const node of parents || []) {
    const uid = blockUid(node);
    if (!uid || uid === selfUid) continue;
    const string = blockString(node);
    if (!isDiagramString(string)) continue;
    if (readPlexus(node?.[":block/props"] ?? node?.props)?.v !== 2) continue;
    chain.push({ uid, title: boardLabel(string, resolve), depth: parentCount(node) });
  }
  chain.sort((a, b) => a.depth - b.depth);
  const out = chain.map(({ uid, title }) => ({ uid, title }));
  if (selfUid) out.push({ uid: selfUid, title: self?.title || UNTITLED_BOARD });
  return out;
}
