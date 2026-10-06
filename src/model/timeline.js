// MEM-3 memory lane, and the NAV-3 daily-notes spine. No Roam calls.
// Play is 700ms per month so two years finish under 20s.
import { pageTitleToDate } from "./resurface.js";

export const LANE_STEP_MS = 700;
const WEEK = 7 * 86400000;

export function timeIndex(items) {
  const events = [];
  for (const item of items || []) {
    if (!item?.uid || !Number.isFinite(item.time)) continue;
    events.push({ uid: item.uid, time: item.time, kind: item.kind || "card" });
  }
  events.sort((a, b) => a.time - b.time || String(a.uid).localeCompare(String(b.uid)));
  return events;
}

export function monthSteps(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || b.getTime() <= a.getTime()) {
    return [Number.isFinite(a.getTime()) ? a.getTime() : Date.now()];
  }
  const steps = [a.getTime()];
  let year = a.getFullYear();
  let month = a.getMonth();
  const endT = b.getTime();
  for (let i = 0; i < 600; i += 1) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    const t = new Date(year, month, 1).getTime();
    if (t >= endT) {
      steps.push(endT);
      break;
    }
    steps.push(t);
  }
  return steps;
}

export function playMs(start, end, stepMs = LANE_STEP_MS) {
  return Math.max(0, monthSteps(start, end).length - 1) * stepMs;
}

export function laneSets(index, t) {
  const future = [];
  const fresh = [];
  for (const event of index || []) {
    if (event.time > t) future.push(event.uid);
    else if (t - event.time <= WEEK) fresh.push(event.uid);
  }
  return { future, fresh };
}

export function edgeHidden(edges, itemFuture, t) {
  const late = new Set(itemFuture || []);
  const out = [];
  for (const edge of edges || []) {
    if (!edge?.uid) continue;
    const own = Number.isFinite(edge.time) && edge.time > t;
    if (own || late.has(edge.from) || late.has(edge.to)) out.push(edge.uid);
  }
  return out;
}

export function previewLayout(items) {
  const layout = new Map();
  for (const item of items || []) {
    if (!item?.uid || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    layout.set(item.uid, { x: item.x, y: item.y, w: item.w, h: item.h });
  }
  return { layout, writes: 0 };
}

// NAV-3. One datalog batch for referring blocks on daily pages.
// Tuple order from timelineQuery: [cardUid, blockUid, pageTitle, pageUid, time].
// groupTimeline also accepts { cardUid, blockUid, pageTitle, pageUid, time }.
// The day is the page title (pageTitleToDate), not the block's create time.

export const TIMELINE_DAY_CAP = 365;
export const DAILY_TITLE_PATTERN = "^(January|February|March|April|May|June|July|August|September|October|November|December) \\d{1,2}(?:st|nd|rd|th), \\d{4}$";

const TIMELINE_QUERY = "[:find ?card ?ref ?title ?page ?time :in $ [?card ...] ?pat :where [?c :block/uid ?card] [?b :block/refs ?c] [?b :block/uid ?ref] [?b :block/page ?pg] [?pg :node/title ?title] [?pg :block/uid ?page] [(get-else $ ?b :create/time 0) ?time] [(re-pattern ?pat) ?re] [(re-find ?re ?title)]]";

export function timelineQuery(uids) {
  const ids = [];
  const seen = new Set();
  for (const uid of uids || []) {
    const id = String(uid ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { query: TIMELINE_QUERY, args: [ids, DAILY_TITLE_PATTERN] };
}

function asRow(row) {
  if (!row) return null;
  if (Array.isArray(row)) {
    const cardUid = row[0] == null ? "" : String(row[0]).trim();
    if (!cardUid) return null;
    return {
      cardUid,
      blockUid: row[1] == null ? "" : String(row[1]),
      pageTitle: row[2] == null ? "" : String(row[2]),
      pageUid: row[3] == null ? "" : String(row[3]),
      time: Number.isFinite(row[4]) ? row[4] : null,
    };
  }
  const cardUid = String(row.cardUid ?? row.uid ?? row.card ?? "").trim();
  if (!cardUid) return null;
  return {
    cardUid,
    blockUid: row.blockUid == null ? "" : String(row.blockUid),
    pageTitle: String(row.pageTitle ?? row.title ?? ""),
    pageUid: row.pageUid == null ? "" : String(row.pageUid),
    time: Number.isFinite(row.time) ? row.time : null,
  };
}

function timelineRows(rows) {
  const out = [];
  for (const row of rows || []) {
    const next = asRow(row);
    if (next) out.push(next);
  }
  return out;
}

export function groupTimeline(rows) {
  const byDate = new Map();
  for (const row of timelineRows(rows)) {
    const date = pageTitleToDate(row.pageTitle);
    if (date == null) continue;
    let day = byDate.get(date);
    if (!day) {
      day = {
        date,
        title: row.pageTitle.trim(),
        pageUid: row.pageUid,
        count: 0,
        cardUids: new Set(),
        time: Number.isFinite(row.time) ? row.time : -Infinity,
      };
      byDate.set(date, day);
    }
    day.count += 1;
    day.cardUids.add(row.cardUid);
    const stamp = Number.isFinite(row.time) ? row.time : -Infinity;
    if (row.pageUid && stamp >= day.time) {
      day.pageUid = row.pageUid;
      day.title = row.pageTitle.trim();
      day.time = stamp;
    }
  }
  const days = [...byDate.values()].sort((a, b) => b.date - a.date || a.title.localeCompare(b.title));
  const years = [];
  for (const day of days.slice(0, TIMELINE_DAY_CAP)) {
    const year = new Date(day.date).getFullYear();
    let bucket = years[years.length - 1];
    if (!bucket || bucket.year !== year) {
      bucket = { year, days: [] };
      years.push(bucket);
    }
    bucket.days.push({
      date: day.date,
      title: day.title,
      pageUid: day.pageUid,
      count: day.count,
      cardUids: day.cardUids,
    });
  }
  return years;
}

function mentionMap(rows, which) {
  const map = new Map();
  for (const row of timelineRows(rows)) {
    const date = pageTitleToDate(row.pageTitle);
    if (date == null) continue;
    const prev = map.get(row.cardUid);
    if (prev == null) map.set(row.cardUid, date);
    else map.set(row.cardUid, which === "first" ? Math.min(prev, date) : Math.max(prev, date));
  }
  return map;
}

export function firstMention(rows) {
  return mentionMap(rows, "first");
}

export function lastMention(rows) {
  return mentionMap(rows, "last");
}

function isoDate(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(String(text ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date.getTime();
}

function cleanAttr(value) {
  return String(value ?? "").trim().replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
}

function blobsOf(item) {
  const blobs = [];
  if (item?.string) blobs.push(String(item.string));
  if (item?.title) blobs.push(String(item.title));
  for (const kid of item?.content || item?.children || []) {
    const text = kid?.[":block/string"] ?? kid?.string ?? "";
    if (text) blobs.push(String(text));
  }
  return blobs;
}

function attributeDate(item) {
  if (!item) return null;
  if (Number.isFinite(item.date)) return item.date;
  if (Number.isFinite(item.attributeDate)) return item.attributeDate;
  const titled = pageTitleToDate(item.title);
  if (titled != null) return titled;
  for (const blob of blobsOf(item)) {
    const attr = /(?:^|\n)\s*(?:Date|Due)::\s*([^\n]+)/i.exec(blob);
    if (!attr) continue;
    const value = cleanAttr(attr[1]);
    const daily = pageTitleToDate(value);
    if (daily != null) return daily;
    const iso = isoDate(value);
    if (iso != null) return iso;
  }
  for (const blob of blobsOf(item)) {
    const iso = isoDate(blob);
    if (iso != null) return iso;
  }
  return null;
}

export function dateSource(item, rows, mode) {
  const kind = String(mode ?? "").trim().toLowerCase();
  if (kind === "attribute" || kind === "date attribute") return attributeDate(item);
  const which = kind === "first" || kind === "first mention" ? "first"
    : kind === "last" || kind === "last mention" ? "last"
      : "";
  if (!which) return null;
  const uid = String(item?.uid ?? item?.cardUid ?? "").trim();
  if (!uid) return null;
  const map = which === "first" ? firstMention(rows) : lastMention(rows);
  return map.get(uid) ?? null;
}
