// Due chips read BT_attrDue:: off a card's children. The string is never rewritten.
import { attrNameOf } from "./schema.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAILY_RE = new RegExp(`^(${MONTHS.join("|")}) (\\d{1,2})(st|nd|rd|th), (\\d{4})$`);

export function parseRoamDay(title) {
  const m = DAILY_RE.exec(String(title ?? "").trim());
  if (!m) return null;
  const day = Number(m[2]);
  const suffix = day >= 11 && day <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  if (m[3] !== suffix || day < 1 || day > 31) return null;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return null;
  return { y: Number(m[4]), m: month + 1, d: day };
}

function childString(child) {
  return child?.[":block/string"] ?? child?.string ?? "";
}

function dayOf(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  return parseRoamDay(value);
}

function stamp(part) {
  return part.y * 10000 + part.m * 100 + part.d;
}

export function dueChip(content, today = new Date()) {
  let raw = null;
  let title = "";
  for (const child of content || []) {
    const text = String(childString(child));
    if (attrNameOf(text) !== "BT_attrDue") continue;
    raw = text;
    const rest = text.slice(text.indexOf("::") + 2).trim();
    const wiki = /^\[\[([\s\S]+)\]\]$/.exec(rest);
    title = (wiki ? wiki[1] : rest).trim();
    break;
  }
  if (raw == null || !title) return null;
  const due = parseRoamDay(title);
  const now = dayOf(today);
  return { text: title, overdue: Boolean(due && now && stamp(due) < stamp(now)), raw };
}
