// MEM-1. Provenance for one card or connection. No writes and no user ids.

const DAY_MS = 86400000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const HALO_PULL = "[:create/time :edit/time {:create/user [:user/display-name]} {:block/_refs [:create/time]}]";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ordinal(day) {
  const mod = day % 100;
  if (mod >= 11 && mod <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

export function formatMade(ms) {
  const n = finite(ms);
  if (n == null) return "";
  const date = new Date(n);
  return `${MONTHS[date.getMonth()]} ${ordinal(date.getDate())}, ${date.getFullYear()}`;
}

export function headerText({ created, board, section, userName } = {}) {
  const when = formatMade(created);
  const where = String(board || "").trim() || "Untitled board";
  let text = when ? `Made ${when} on ${where}` : `Made on ${where}`;
  const sec = String(section || "").trim();
  if (sec) text += ` › ${sec}`;
  const name = String(userName || "").trim();
  if (name) text += ` by ${name}`;
  return text;
}

// Other rows within 24 hours of this uid. At most 6. The subject is left out.
export function company(rows, uid) {
  const list = Array.isArray(rows) ? rows : [];
  const self = list.find((row) => row && row.uid === uid);
  const created = finite(self?.created);
  if (!self || created == null) return [];
  const out = [];
  for (const row of list) {
    if (!row || row.uid === uid) continue;
    const stamp = finite(row.created);
    if (stamp == null || Math.abs(stamp - created) > DAY_MS) continue;
    out.push(row.uid);
    if (out.length >= 6) break;
  }
  return out;
}

// Twelve buckets. Every finite time lands in one. An empty list is twelve zeros.
export function buckets(times) {
  const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const list = [];
  for (const value of times || []) {
    const n = finite(value);
    if (n != null) list.push(n);
  }
  if (!list.length) return counts;
  let min = list[0];
  let max = list[0];
  for (const n of list) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  const span = max - min;
  for (const n of list) {
    let index = span <= 0 ? 0 : Math.floor(((n - min) / span) * 12);
    if (index < 0) index = 0;
    if (index > 11) index = 11;
    counts[index] += 1;
  }
  return counts;
}

export function refsLine(times) {
  const list = [];
  for (const value of times || []) {
    const n = finite(value);
    if (n != null) list.push(n);
  }
  if (!list.length) return "Referenced 0 times";
  let min = list[0];
  let max = list[0];
  for (const n of list) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  const noun = list.length === 1 ? "time" : "times";
  return `Referenced ${list.length} ${noun}, first ${formatMade(min)}, last ${formatMade(max)}`;
}

// One unwatched pull. The display name is kept only when it is non-empty. The user uid is dropped.
export function readHaloPull(pulled) {
  const user = pulled?.[":create/user"];
  const name = user && typeof user[":user/display-name"] === "string" ? user[":user/display-name"].trim() : "";
  const raw = pulled?.[":block/_refs"];
  const refs = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const refTimes = [];
  for (const ref of refs) {
    const stamp = finite(ref?.[":create/time"]);
    if (stamp != null) refTimes.push(stamp);
  }
  return {
    created: finite(pulled?.[":create/time"]),
    edited: finite(pulled?.[":edit/time"]),
    userName: name,
    refTimes,
  };
}
