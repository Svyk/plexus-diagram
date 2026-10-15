// Card children (UX lane B). Pure decisions: height memory, peek gates, outline focus.
// The session and the card renderer call these. Nothing here touches Roam.

export const KIDS_H_CAP = 900;
export const PEEK_HOVER_MS = 800;
export const PEEK_LEAVE_MS = 400;
export const PEEK_ANIM_MS = 200;
export const CHILD_GROW_H = 30;

export function childIsOpen(block) {
  if (!block || typeof block !== "object") return true;
  if (block.open === false || block[":block/open"] === false) return false;
  return true;
}

// Unfold grows from the stored folded height. Refold returns to that height.
// A resize while unfolded is the unfolded size only; the folded height stays.
export function kidsHeightPlan({ on, h, extraH = 0, memory, cap = KIDS_H_CAP } = {}) {
  const mem = {
    foldedH: memory?.foldedH,
    unfoldedH: memory?.unfoldedH,
    userSized: memory?.userSized === true,
  };
  const base = Number.isFinite(Number(h)) ? Number(h) : 0;
  if (on) {
    if (mem.foldedH == null) mem.foldedH = base;
    const grown = Math.min(cap, Math.ceil(mem.foldedH + Math.max(0, Number(extraH) || 0)));
    const target = mem.userSized && mem.unfoldedH != null ? mem.unfoldedH : grown;
    mem.unfoldedH = target;
    return { h: target, memory: mem };
  }
  return { h: mem.foldedH != null ? mem.foldedH : base, memory: mem };
}

export function rememberUnfoldedSize(memory, h) {
  const mem = {
    foldedH: memory?.foldedH,
    unfoldedH: memory?.unfoldedH,
    userSized: memory?.userSized === true,
  };
  const next = Number(h);
  if (!Number.isFinite(next)) return mem;
  mem.unfoldedH = next;
  mem.userSized = true;
  return mem;
}

// Hover peek is detail-tier only, and only for a block ref or a page card whose
// children are not already on the card. Gestures and an open editor cancel it.
export function peekAllowed({ tier, gesturing, kind, childCount, showing, editing } = {}) {
  if (tier !== "detail" || gesturing || editing || showing) return false;
  if (kind !== "block" && kind !== "page") return false;
  return Number(childCount) > 0;
}

export function findBlock(list, uid, read) {
  const want = String(uid || "");
  if (!want) return null;
  const walk = (nodes, trail) => {
    for (const node of nodes || []) {
      const id = String(read.uid(node) || "");
      if (!id) continue;
      const next = [...trail, { uid: id, label: read.label(node) }];
      if (id === want) return { block: node, trail: next };
      const hit = walk(read.kids(node), next);
      if (hit) return hit;
    }
    return null;
  };
  return walk(list, []);
}
