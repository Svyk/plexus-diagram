// Suggestion lines between cards on one board. No Roam calls.

export const SUGGEST_CAP = 60;
export const SUGGEST_LIMIT = 300;

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DAILY_RE = new RegExp(`^(${MONTHS}) \\d{1,2}(?:st|nd|rd|th), \\d{4}$`);

const escapeReg = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function isDailyTitle(title) {
  return DAILY_RE.test(String(title ?? "").trim());
}

function boundary(title) {
  return new RegExp(`(^|[^A-Za-z0-9])(${escapeReg(title)})(?=$|[^A-Za-z0-9])`, "gi");
}

function linkRanges(text) {
  const ranges = [];
  const re = /\[\[[^\]]*\]\]/g;
  let match;
  while ((match = re.exec(text))) ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}

function inside(ranges, start, end) {
  return ranges.some(([a, b]) => start >= a && end <= b);
}

export function bareMention(text, title) {
  if (!title || String(title).trim().length < 4 || isDailyTitle(title)) return false;
  const src = String(text ?? "");
  const ranges = linkRanges(src);
  const re = boundary(title);
  let from = 0;
  while (from <= src.length) {
    re.lastIndex = from;
    const hit = re.exec(src);
    if (!hit) return false;
    const start = hit.index + hit[1].length;
    const end = start + hit[2].length;
    if (!inside(ranges, start, end)) return true;
    from = end > from ? end : from + 1;
  }
  return false;
}

export function linkMention(text, title) {
  const src = String(text ?? "");
  if (!bareMention(src, title)) return null;
  const ranges = linkRanges(src);
  const re = boundary(title);
  let from = 0;
  while (from <= src.length) {
    re.lastIndex = from;
    const hit = re.exec(src);
    if (!hit) return null;
    const start = hit.index + hit[1].length;
    const end = start + hit[2].length;
    if (!inside(ranges, start, end)) return `${src.slice(0, start)}[[${title}]]${src.slice(end)}`;
    from = end > from ? end : from + 1;
  }
  return null;
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function titlesOf(cards) {
  return cards
    .filter((card) => card.pageTitle && String(card.pageTitle).trim().length >= 4 && !isDailyTitle(card.pageTitle))
    .map((card) => ({ uid: card.uid, title: String(card.pageTitle).trim() }))
    .sort((a, b) => b.title.length - a.title.length || a.title.localeCompare(b.title));
}

export function suggestPairs(cards, { mode = "off", existing = new Set(), dismissed = new Set(), only = null, cap = SUGGEST_CAP, limit = SUGGEST_LIMIT } = {}) {
  if (mode !== "shared" && mode !== "both") return { pairs: [], tooMany: false };
  let list = (cards || []).filter((card) => card?.uid);
  if (only) list = list.filter((card) => only.has(card.uid));
  if (list.length > limit) return { pairs: [], tooMany: true };
  const found = new Map();
  const add = (a, b, reason, score) => {
    if (!a || !b || a === b) return;
    const key = pairKey(a, b);
    if (existing.has(key) || dismissed.has(key)) return;
    const prev = found.get(key);
    if (!prev || score > prev.score) found.set(key, { key, a, b, reason, score });
    else if (prev && score === prev.score && reason.startsWith("Both") && !prev.reason.startsWith("Both")) {
      found.set(key, { key, a, b, reason, score });
    }
  };
  if (mode === "both") {
    const titles = titlesOf(list);
    for (const card of list) {
      for (const other of titles) {
        if (other.uid === card.uid) continue;
        if (!bareMention(card.text, other.title)) continue;
        add(card.uid, other.uid, `Mentions '${other.title}' without a link`, 1);
      }
    }
  }
  const buckets = new Map();
  for (const card of list) {
    const names = new Set([...(card.refs || []), ...(card.attrs || [])].map((name) => String(name).trim()).filter(Boolean));
    for (const name of names) {
      if (!buckets.has(name)) buckets.set(name, []);
      buckets.get(name).push(card.uid);
    }
  }
  for (const [name, uids] of buckets) {
    const uniq = [...new Set(uids)];
    if (uniq.length < 2) continue;
    for (let i = 0; i < uniq.length; i += 1) {
      for (let j = i + 1; j < uniq.length; j += 1) {
        add(uniq[i], uniq[j], `Both reference [[${name}]]`, 2);
      }
    }
  }
  const pairs = [...found.values()].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, cap);
  return { pairs, tooMany: false };
}
