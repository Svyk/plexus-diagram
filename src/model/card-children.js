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
    // setKids and addCardChild only plan while the card is closed, so h is the live folded height.
    mem.foldedH = base;
    const grown = Math.min(cap, Math.ceil(base + Math.max(0, Number(extraH) || 0)));
    const remembered = mem.userSized && Number.isFinite(Number(mem.unfoldedH)) ? Number(mem.unfoldedH) : null;
    const target = remembered != null && remembered > base ? Math.min(cap, remembered) : grown;
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

// One crumb step toward the card. A trail of one entry is the card's own child, so the next step is the card.
export function focusStep(trail) {
  const list = Array.isArray(trail) ? trail : [];
  if (list.length <= 1) return { uid: null, trail: [] };
  const next = list.slice(0, -1);
  const uid = next[next.length - 1]?.uid || null;
  return { uid, trail: uid ? next : [] };
}

const eachItem = (items) => {
  if (!items) return [];
  if (typeof items.values === "function") return [...items.values()];
  return Array.isArray(items) ? items : [];
};

const nodeRead = {
  uid: (node) => String(node?.[":block/uid"] ?? node?.uid ?? ""),
  kids: (node) => node?.[":block/children"] || node?.children || [],
  label: () => "",
};

// The card whose content tree contains this block. The card uid itself is not a child focus.
export function cardOwningBlock(items, blockUid) {
  const want = String(blockUid || "");
  if (!want) return null;
  for (const item of eachItem(items)) {
    if (!item || item.type === "section" || item.uid === want) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    if (findBlock(content, want, nodeRead)) return { cardUid: item.uid, blockUid: want };
  }
  return null;
}

const pageUidMemo = new WeakMap();

// A page card's target is the page, not the board block. The pull may already
// carry the page uid. Otherwise one lookup per card, remembered on the item.
const pageTargetUid = (item, pageUidOf) => {
  const target = item?.target;
  if (!target || target.kind !== "page") return "";
  if (target.uid) return String(target.uid);
  if (typeof pageUidOf !== "function") return "";
  const cached = pageUidMemo.get(item);
  if (cached !== undefined) return cached;
  let uid = "";
  try { uid = String(pageUidOf(target.title) || ""); } catch { uid = ""; }
  pageUidMemo.set(item, uid);
  return uid;
};

const cardForParent = (items, parentUid, blockUid, pageUidOf) => {
  if (!parentUid) return null;
  for (const item of eachItem(items)) {
    if (!item || item.type === "section") continue;
    if (item.uid === parentUid && blockUid !== item.uid) return { cardUid: item.uid, blockUid };
    const target = item.target;
    if (target?.kind === "block" && target.uid === parentUid && blockUid !== target.uid) {
      return { cardUid: item.uid, blockUid };
    }
    if (target?.kind === "page") {
      const uid = pageTargetUid(item, pageUidOf);
      if (uid && uid === parentUid && blockUid !== uid) return { cardUid: item.uid, blockUid };
    }
  }
  return null;
};

// Walk Roam's parent pointer until a card on this board. Opening the card block itself is not a child focus.
export function cardOwningByParent(items, blockUid, parentOf, pageUidOf) {
  const want = String(blockUid || "");
  if (!want || typeof parentOf !== "function") return null;
  for (const item of eachItem(items)) {
    if (item?.type !== "section" && item?.uid === want) return null;
  }
  let uid = want;
  const seen = new Set();
  for (let i = 0; i < 24; i += 1) {
    if (!uid || seen.has(uid)) return null;
    seen.add(uid);
    let parent = "";
    try {
      const loc = parentOf(uid);
      parent = typeof loc === "string" ? loc : String(loc?.parentUid || "");
    } catch { return null; }
    if (!parent) return null;
    const hit = cardForParent(items, parent, want, pageUidOf);
    if (hit) return hit;
    uid = parent;
  }
  return null;
}

// Session focus only. The caller still lets Roam open the block.
export function focusOpenBlock(records, blockUid, parentOf, pageUidOf) {
  const want = String(blockUid || "");
  if (!want) return false;
  let hit = false;
  for (const rec of records || []) {
    const items = rec?.items;
    if (!items || typeof rec.focusInside !== "function") continue;
    const owned = cardOwningBlock(items, want) || cardOwningByParent(items, want, parentOf, pageUidOf);
    if (!owned || !owned.cardUid || owned.blockUid === owned.cardUid) continue;
    try {
      rec.focusInside(owned.cardUid, owned.blockUid);
      hit = true;
    } catch { /* view gone */ }
  }
  return hit;
}
