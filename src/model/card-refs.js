// PXD-16: arrows for refs written ON the board. linksQuery() leaves out every block under the board, so a note card's
// own text and the child rows of any card never drew a link. This reads them from the board already built (no query,
// no host, no writes) and gives links in the shape reduceLinks makes, plus tree links for a followed block's outline.
import { refsIn } from "./endpoints.js";
import { attrNameOf, colorForLabel } from "./schema.js";

// Same number as VIRTUAL_MIN in src/view/cards.js: past it the board is big and draws no ref arrows.
export const CARD_REFS_MAX = 400;
const MAX_SOURCES = 20;
const MAX_DEPTH = 8;
const RANK = { tree: 0, ref: 1, attr: 2 };
const MAX_STRINGS = 500;

export function cardRefsOn(board) {
  if (!board?.items) return false;
  if (board.items.size > CARD_REFS_MAX) return false;
  return board.plexus?.refs !== false;
}

const isBareAttr = (s) => typeof s === "string" && /^\s*[^:\n]{1,60}::\s*$/.test(s);
const PAGE_RE = /\[\[([^\[\]]+)\]\]/g;
const TAG_RE = /(?:^|[\s(,;])#([^\s\[\]#,.!?;:()`]+)/g;

// { pages: titles, uids } a string refers to. Inline code is skipped.
function refsOf(string) {
  const text = String(string ?? "").replace(/`[^`\n]*`/g, " ");
  const pages = new Set();
  PAGE_RE.lastIndex = 0;
  for (let m = PAGE_RE.exec(text); m; m = PAGE_RE.exec(text)) pages.add(m[1].trim());
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(text); m; m = TAG_RE.exec(text)) pages.add(m[1]);
  pages.delete("");
  return { pages, uids: refsIn(text) };
}

function cardIndex(board) {
  const byKey = new Map();
  const add = (key, uid) => {
    if (!byKey.has(key)) byKey.set(key, []);
    const list = byKey.get(key);
    if (!list.includes(uid)) list.push(uid);
  };
  for (const item of board.items.values()) {
    if (item.type !== "card" || !item.target) continue;
    const t = item.target;
    if (t.kind === "page") {
      add(`p:${t.title ?? ""}`, item.uid);
      if (t.uid) add(`u:${t.uid}`, item.uid);
    } else if (t.kind === "self") add(`u:${item.uid}`, item.uid);
    else if (t.uid) add(`u:${t.uid}`, item.uid);
  }
  return byKey;
}

// Strings under a card, with the string of the enclosing block (a bare `Attr::` parent labels its children).
function* descendants(content, budget) {
  const stack = [];
  for (let i = (Array.isArray(content) ? content.length : 0) - 1; i >= 0; i -= 1) stack.push([content[i], 1, null]);
  while (stack.length && budget.n > 0) {
    const [node, depth, parent] = stack.pop();
    const string = typeof node?.[":block/string"] === "string" ? node[":block/string"] : "";
    budget.n -= 1;
    yield { uid: node?.[":block/uid"], string, parent };
    const kids = node?.[":block/children"];
    if (depth >= MAX_DEPTH || !Array.isArray(kids)) continue;
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push([kids[i], depth + 1, string]);
  }
}

export function cardRefLinks(board) {
  if (!board?.items) return [];
  const index = cardIndex(board);
  if (!index.size) return [];
  const byKey = new Map();
  const note = (from, uid, string, parent) => {
    const refs = refsOf(string);
    if (!refs.pages.size && !refs.uids.length) return;
    let label = attrNameOf(string);
    if (label == null && isBareAttr(parent)) label = attrNameOf(parent);
    const isAttr = label != null;
    if (!isAttr) label = "mentions";
    const targets = new Set();
    for (const title of refs.pages) for (const uid of index.get(`p:${title}`) || []) targets.add(uid);
    for (const uid of refs.uids) for (const card of index.get(`u:${uid}`) || []) targets.add(card);
    for (const to of targets) {
      if (to === from) continue;
      const key = `${from}->${to}`;
      let link = byKey.get(key);
      if (!link) {
        link = { key, from, to, kind: "ref", labels: [], sources: [], color: "gray" };
        byKey.set(key, link);
      }
      if (isAttr) link.kind = "attr";
      if (!link.labels.includes(label)) link.labels.push(label);
      if (link.sources.length < MAX_SOURCES && !link.sources.some((s) => s.uid === uid)) link.sources.push({ uid, string });
    }
  };
  for (const item of board.items.values()) {
    if (item.type !== "card" || !item.target) continue;
    if (item.target.kind === "self") note(item.uid, item.uid, item.string, null);
    const budget = { n: MAX_STRINGS };
    for (const { uid, string, parent } of descendants(item.content, budget)) note(item.uid, uid, string, parent);
  }
  const out = [];
  for (const link of byKey.values()) {
    link.labels = [...link.labels.filter((l) => l !== "mentions"), ...link.labels.filter((l) => l === "mentions")];
    link.color = colorForLabel(link.labels[0]);
    out.push(link);
  }
  return out;
}

// parents: Map(source block uid -> its parent's uid) from the follow read; key: the follow source key. A card placed
// from the source links from the card of its parent block, when the board has one.
export function treeLinks(board, parents, key) {
  if (!board?.items || !(parents instanceof Map) || !parents.size || !key) return [];
  const byUid = new Map();
  for (const item of board.items.values()) {
    if (item.type !== "card" || item.target?.kind !== "block" || !item.target.uid) continue;
    if (!byUid.has(item.target.uid)) byUid.set(item.target.uid, []);
    byUid.get(item.target.uid).push(item.uid);
  }
  const out = [];
  const seen = new Set();
  for (const item of board.items.values()) {
    if (item.type !== "card" || item.src !== key || item.target?.kind !== "block") continue;
    const parent = parents.get(item.target.uid);
    if (!parent) continue;
    for (const from of byUid.get(parent) || []) {
      const k = `${from}->${item.uid}`;
      if (from === item.uid || seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, from, to: item.uid, kind: "tree", labels: [], sources: [], color: "gray" });
    }
  }
  return out;
}

export function mergeLinks(a, b) {
  const byKey = new Map();
  for (const link of [...(a || []), ...(b || [])]) {
    const have = byKey.get(link.key);
    if (!have) {
      byKey.set(link.key, { ...link, labels: [...(link.labels || [])], sources: [...(link.sources || [])] });
      continue;
    }
    if (RANK[link.kind] > RANK[have.kind]) have.kind = link.kind;
    for (const l of link.labels || []) if (!have.labels.includes(l)) have.labels.push(l);
    for (const s of link.sources || []) {
      if (have.sources.length >= MAX_SOURCES) break;
      if (!have.sources.some((x) => x.uid === s.uid && x.string === s.string)) have.sources.push(s);
    }
  }
  const out = [];
  for (const link of byKey.values()) {
    link.labels = [...link.labels.filter((l) => l !== "mentions"), ...link.labels.filter((l) => l === "mentions")];
    link.color = colorForLabel(link.labels[0]);
    out.push(link);
  }
  return out;
}
