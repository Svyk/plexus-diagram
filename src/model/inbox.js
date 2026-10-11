// Daily-note inbox. A block on a daily page that cites the board's title shows up here until it is a card.
// The read is one reverse pull per title (`:block/_refs` of the title page), never a graph scan.

import { firstLine } from "./schema.js";
import { isDailyTitle } from "./library.js";
import { pageTitleToDate } from "./resurface.js";

export const INBOX_CAP = 100;
export const INBOX_PULL_LIMIT = 1000;
const ROW_TEXT = 160;

// The page title and the board's own title are both names a daily note can cite. "Untitled board" is not a name.
export function inboxTitles({ pageTitle = "", boardTitle = "" } = {}) {
  const out = [];
  for (const raw of [pageTitle, boardTitle]) {
    const t = String(raw ?? "").trim();
    if (!t || /^untitled board$/i.test(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

export function inboxPlan(titles) {
  const pattern = `[:node/title {(limit :block/_refs ${INBOX_PULL_LIMIT}) [:block/uid :block/string :create/time {:block/page [:node/title]}]}]`;
  return titles.map((title) => ({
    query: `[:find (pull ?p ${pattern}) :in $ ?t :where [?p :node/title ?t]]`,
    inputs: [title],
  }));
}

const pick = (obj, key) => obj?.[`:block/${key}`] ?? obj?.[`block/${key}`] ?? obj?.[key];

// Roam's q returns pull keys with or without the namespace colon; read all three shapes.
export function inboxEntries(rows) {
  const out = [];
  let full = false;
  for (const row of Array.isArray(rows) ? rows : []) {
    const node = Array.isArray(row) ? row[0] : row;
    const refs = node?.[":block/_refs"] ?? node?.["block/_refs"] ?? node?._refs ?? [];
    if (!Array.isArray(refs)) continue;
    if (refs.length >= INBOX_PULL_LIMIT) full = true;
    for (const ref of refs) {
      const uid = pick(ref, "uid");
      const page = ref?.[":block/page"] ?? ref?.["block/page"] ?? ref?.page;
      const pageNode = Array.isArray(page) ? page[0] : page;
      const pageTitle = pageNode?.[":node/title"] ?? pageNode?.["node/title"] ?? pageNode?.title;
      if (typeof uid !== "string" || typeof pageTitle !== "string") continue;
      const string = pick(ref, "string");
      const time = ref?.[":create/time"] ?? ref?.["create/time"] ?? ref?.time;
      out.push({ uid, string: typeof string === "string" ? string : "", page: pageTitle, time: Number(time) || 0 });
    }
  }
  return { entries: out, full };
}

export async function readInbox(q, titles, { tick = () => Promise.resolve() } = {}) {
  const all = [];
  let full = false;
  for (const step of inboxPlan(titles)) {
    let rows = [];
    try { rows = q(step.query, ...step.inputs); } catch { rows = []; }
    const got = inboxEntries(rows);
    all.push(...got.entries);
    if (got.full) full = true;
    await tick();
  }
  return { entries: all, full };
}

// Daily pages only, newest first, nothing already on the board. `onBoard` holds uids; `skip` holds blocks that are the board itself.
export function filterInbox(entries, { onBoard = new Set(), skip = new Set(), cap = INBOX_CAP } = {}) {
  const seen = new Set();
  const kept = [];
  for (const e of entries || []) {
    if (!e || seen.has(e.uid) || onBoard.has(e.uid) || skip.has(e.uid)) continue;
    if (!isDailyTitle(e.page)) continue;
    seen.add(e.uid);
    kept.push(e);
  }
  const day = (e) => pageTitleToDate(e.page) || 0;
  kept.sort((a, b) => (b.time || day(b)) - (a.time || day(a)) || day(b) - day(a) || (a.uid < b.uid ? -1 : 1));
  return kept.slice(0, cap);
}

export function inboxRow(entry) {
  return {
    uid: entry.uid,
    text: firstLine(entry.string).slice(0, ROW_TEXT) || "(empty block)",
    page: entry.page,
    string: `((${entry.uid}))`,
    time: entry.time || 0,
  };
}

export function inboxLabel(n) {
  return `Inbox (${n})`;
}
