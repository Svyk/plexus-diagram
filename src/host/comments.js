// Native Roam comments and edit times for the board. Installed onto the host as a small additive layer:
// cardStats gains `comments` and `commentThread`, and the host gains addComment, openCommentThread, editTimes.
// Reads are one datalog query per badge chunk and one pull_many per changed-since pass. Nothing runs in mount.

import { dailyTitle } from "../model/journal.js";
import {
  COMMENTS_PAGE,
  commentIndexFromRows,
  commentThreadPlan,
} from "../model/comments.js";
import { CHANGE_CAP, CHANGE_PULL } from "../model/changes.js";

// Starts from the few [[roam/comments]] containers and walks down to the anchors, then keeps the asked cards.
// Starting from the cards (one :block/refs join per card) cost ~55 ms for 240 cards; this is ~7 ms whatever the board size.
const THREAD_QUERY = `[:find ?cell ?au (count ?comment) :in $ ?cp :where
 [?container :block/refs ?cp] [?container :block/children ?date] [?date :block/children ?author] [?author :block/children ?anchor]
 [?anchor :block/refs ?t] [?t :block/uid ?cell] [?anchor :block/uid ?au] [?anchor :block/children ?comment]]`;
const PAGE_QUERY = `[:find ?pu :in $ ?u :where [?b :block/uid ?u] [?b :block/page ?p] [?p :block/uid ?pu]]`;
const CONTAINER_QUERY = `[:find ?cu :in $ ?pu ?cp :where [?p :block/uid ?pu] [?p :block/children ?c] [?c :block/refs ?cp] [?c :block/uid ?cu]]`;
const AUTHOR_QUERY = `[:find ?title :in $ ?uid :where [?u :user/uid ?uid] [?u :user/display-page ?p] [?p :node/title ?title]]`;
const TREE_PULL = `[:block/uid :block/string :block/order {(limit :block/children nil) [:block/uid :block/string :block/order {(limit :block/children nil) [:block/uid :block/string :block/order {(limit :block/children nil) [:block/uid :block/string :block/order]}]}]}]`;

export function installCommentHost(host, { api, data = api?.data, now = () => new Date() } = {}) {
  if (!host || !data) return host;
  const commentsEid = () => {
    try { return host.resolveEid({ title: COMMENTS_PAGE }); } catch { return null; }
  };

  // Map<cardUid, { count, threadUid, threads }>. Empty when the graph has no comment page.
  host.commentThreads = (uids) => {
    const list = [...new Set((uids || []).map((u) => String(u || "")).filter(Boolean))];
    const cp = commentsEid();
    if (cp == null || !list.length) return new Map();
    const want = new Set(list);
    try { return commentIndexFromRows((host.q(THREAD_QUERY, cp) || []).filter((row) => want.has(String(row?.[0] ?? "")))); } catch { return new Map(); }
  };

  const baseStats = typeof host.cardStats === "function" ? host.cardStats.bind(host) : null;
  if (baseStats) {
    host.cardStats = (targets, opts) => {
      const res = baseStats(targets, opts);
      if (!(res instanceof Map)) return res;
      const blockKeys = [];
      for (const key of res.keys()) if (key.startsWith("uid:")) blockKeys.push(key.slice(4));
      const threads = host.commentThreads(blockKeys);
      if (!threads.size) return res;
      const out = new Map();
      for (const [key, stat] of res) {
        const hit = key.startsWith("uid:") ? threads.get(key.slice(4)) : null;
        out.set(key, hit ? { ...stat, comments: hit.count, commentThread: hit.threadUid } : stat);
      }
      return out;
    };
  }

  host.openCommentThread = (threadUid) => {
    if (!threadUid) return false;
    try { host.openInSidebar(threadUid, "block"); return true; } catch { return false; }
  };

  // Writes the same four-level shape Roam writes, then the comment body. Returns { anchorUid, commentUid }.
  host.addComment = async (targetUid, body) => {
    const text = String(body ?? "").trim();
    const target = String(targetUid || "");
    if (!target || !text) return null;
    const pageRows = host.q(PAGE_QUERY, target) || [];
    const pageUid = pageRows[0]?.[0] ? String(pageRows[0][0]) : "";
    const authorRows = host.q(AUTHOR_QUERY, String(api?.user?.uid?.() || "")) || [];
    const authorTitle = authorRows[0]?.[0] ? String(authorRows[0][0]) : "";
    const cp = commentsEid();
    let tree = { children: [] };
    if (cp != null && pageUid) {
      const found = host.q(CONTAINER_QUERY, pageUid, cp) || [];
      const containers = [];
      for (const row of found) {
        const node = data.pull(TREE_PULL, [":block/uid", String(row[0])]);
        if (node) containers.push({ uid: node[":block/uid"], string: node[":block/string"], order: node[":block/order"], children: asTree(node[":block/children"]) });
      }
      tree = { children: containers };
    }
    const plan = commentThreadPlan(tree, {
      pageUid, targetUid: target, dateTitle: dailyTitle(now()), authorTitle,
      generateUid: () => host.generateUid(),
    });
    let commentUid = null;
    await host.group(async () => {
      for (const op of plan.ops) {
        await host.createBlock({ parentUid: op.parentUid, order: op.order, uid: op.uid, string: op.string, ...(op.open === false ? { open: false } : {}) });
      }
      commentUid = await host.createBlock({ parentUid: plan.anchorUid, order: "last", string: text });
    }, "comment");
    return { anchorUid: plan.anchorUid, commentUid, existed: plan.existed };
  };

  // One pull_many over the board's card blocks: Map<uid, node> with edit times three levels deep.
  host.editTimes = (uids) => {
    const list = [...new Set((uids || []).map((u) => String(u || "")).filter(Boolean))].slice(0, CHANGE_CAP * 2);
    const out = new Map();
    if (!list.length || typeof data.pull_many !== "function") return out;
    const eids = [];
    const owners = [];
    for (const uid of list) {
      const eid = host.resolveEid({ uid });
      if (eid == null) continue;
      eids.push(eid);
      owners.push(uid);
    }
    if (!eids.length) return out;
    let nodes = null;
    try { nodes = data.pull_many(CHANGE_PULL, eids); } catch { return out; }
    const rows = Array.isArray(nodes) ? nodes : nodes && typeof nodes.length === "number" ? Array.from(nodes) : [];
    rows.forEach((node, i) => { if (node && typeof node === "object") out.set(owners[i], node); });
    return out;
  };

  return host;
}

function asTree(list) {
  return (Array.isArray(list) ? list : []).map((n) => ({
    uid: n[":block/uid"],
    string: n[":block/string"],
    order: n[":block/order"],
    children: asTree(n[":block/children"]),
  }));
}
