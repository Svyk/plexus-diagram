// Roam's native comments. A thread lives on the commented block's own page as a collapsed container block that
// references [[roam/comments]]. Verified shape (Readwisenotes, Parse Lab page):
//   [[roam/comments]]            (collapsed; :block/refs -> the roam/comments page)
//     [[October 7th, 2026]]      (daily-note page ref)
//       [[Svy]]                  (author display page ref)
//         ((RODZGpp7r))          (anchor: block ref to the commented block)
//           this is a test       (one block per comment)
// Pure: reads a page tree or query rows, returns data or ops. No Roam calls.

export const COMMENTS_PAGE = "roam/comments";
export const COMMENTS_CONTAINER_STRING = `[[${COMMENTS_PAGE}]]`;

export function commentAnchorString(targetUid) {
  const uids = (Array.isArray(targetUid) ? targetUid : [targetUid]).map((uid) => String(uid ?? "").trim()).filter(Boolean);
  return uids.map((uid) => `((${uid}))`).join(" ");
}

// The block a card's comments belong to: the block it shows, else its own block. Page cards have none.
export function commentTargetUid(item) {
  if (!item || item.type !== "card") return null;
  const target = item.target;
  if (target?.kind === "page") return null;
  return String(target?.uid || item.uid || "") || null;
}

const byOrder = (list) => [...(list || [])].sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0));

// tree: { children: [{ uid, string, order, children }] } for the commented block's page.
export function commentThreadPlan(tree, { pageUid, targetUid, dateTitle, authorTitle, generateUid } = {}) {
  const anchorString = commentAnchorString(targetUid);
  if (!pageUid) throw new Error("A comment needs the page that holds the commented block");
  if (!anchorString) throw new Error("A comment needs a target block uid");
  if (!dateTitle) throw new Error("A comment needs today's daily-note title");
  if (!authorTitle) throw new Error("A comment needs the author's display-page title");
  const ops = [];
  const level = (parentUid, children, string, order, extra = {}) => {
    const found = byOrder(children).find((child) => String(child?.string ?? "") === string);
    if (found?.uid) return { uid: found.uid, children: found.children || [], existed: true };
    const uid = generateUid();
    ops.push({ type: "create", parentUid, uid, string, order, ...extra });
    return { uid, children: [], existed: false };
  };
  const container = level(pageUid, tree?.children, COMMENTS_CONTAINER_STRING, "last", { open: false });
  const date = level(container.uid, container.children, `[[${dateTitle}]]`, "first");
  const author = level(date.uid, date.children, `[[${authorTitle}]]`, "last");
  const anchor = level(author.uid, author.children, anchorString, "last");
  return {
    ops,
    containerUid: container.uid,
    dateUid: date.uid,
    authorUid: author.uid,
    anchorUid: anchor.uid,
    existed: { container: container.existed, date: date.existed, author: author.existed, anchor: anchor.existed },
  };
}

// rows: [cellUid, anchorUid, commentCount] from the thread query. Returns Map<cellUid, { count, threadUid, threads }>.
export function commentIndexFromRows(rows) {
  const out = new Map();
  for (const row of rows || []) {
    const cell = String(row?.[0] || "");
    const thread = String(row?.[1] || "");
    if (!cell || !thread) continue;
    const entry = out.get(cell) || { count: 0, threadUid: thread, threads: [] };
    if (entry.threads.some((t) => t.threadUid === thread)) continue;
    const count = Math.max(0, Number(row?.[2]) || 0);
    entry.threads.push({ threadUid: thread, count });
    entry.count += count;
    out.set(cell, entry);
  }
  for (const entry of out.values()) {
    entry.threads.sort((a, b) => a.threadUid.localeCompare(b.threadUid));
    entry.threadUid = entry.threads[0].threadUid;
  }
  return out;
}

// Count for one card: native comments win; the older "Comments" child convention is the fallback.
export function commentBadgeCount(nativeEntry, legacyCount = 0) {
  const native = Math.max(0, Number(nativeEntry?.count) || 0);
  return native || Math.max(0, Number(legacyCount) || 0);
}
