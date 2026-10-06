// MEM-8. Strength and dust. No Roam calls and no stored scores.
//
// Strength, track-opens off (weights sum to 1):
//   score = 0.60 * refsNorm + 0.25 * sharedNorm + 0.15 * recencyNorm
//   refsNorm   = min(refs, 12) / 12     references to either end
//   sharedNorm = min(shared, 3) / 3     boards both ends share
//   recencyNorm = exp(-ln2 * ageDays / 180) from the newest edit; missing edit is 0
//
// track-opens on (still sums to 1; parent passes the setting):
//   score = 0.50 * refsNorm + 0.20 * sharedNorm + 0.15 * recencyNorm + 0.15 * opensNorm
//   opensNorm = min(opens, 10) / 10     sum of the two ends' open counts
//
// Dust uses a 30-day month and a 365-day year. 6 months is 180 days.
// A card is dusty when its newest edit or create is at least that old.
// Missing times are not dusty.

export const STRENGTH_WEIGHTS = Object.freeze({
  refs: 0.6,
  shared: 0.25,
  recency: 0.15,
  opens: 0.15,
});

export const REFS_CAP = 12;
export const SHARED_CAP = 3;
export const OPENS_CAP = 10;
export const RECENCY_HALF_LIFE_DAYS = 180;

const DAY = 86400000;

export const DUST_PERIODS = Object.freeze({
  "6m": 180 * DAY,
  "6 months": 180 * DAY,
  "1y": 365 * DAY,
  "1 year": 365 * DAY,
  "2y": 730 * DAY,
  "2 years": 730 * DAY,
});

const OPEN_PREFIX = "plexus-diagram:opens:";

function clamp01(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function normCount(value, cap) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !(cap > 0)) return 0;
  return Math.min(n, cap) / cap;
}

function recencyNorm(editTime, now) {
  if (!Number.isFinite(editTime) || !Number.isFinite(now)) return 0;
  const days = Math.max(0, now - editTime) / DAY;
  return Math.exp((-Math.LN2 * days) / RECENCY_HALF_LIFE_DAYS);
}

export function strengthScore(components = {}, { trackOpens = false, now = components?.now ?? Date.now() } = {}) {
  const refs = normCount(components?.refs, REFS_CAP);
  const shared = normCount(components?.shared, SHARED_CAP);
  const recency = recencyNorm(components?.editTime ?? components?.edit, now);
  if (trackOpens !== true) return clamp01(0.6 * refs + 0.25 * shared + 0.15 * recency);
  const opens = normCount(components?.opens, OPENS_CAP);
  return clamp01(0.5 * refs + 0.2 * shared + 0.15 * recency + 0.15 * opens);
}

// Width 1..4, opacity .5..1. Score 0 is the thin faint stroke. Score 1 is width 4.
export function strokeFor(score) {
  const s = clamp01(score);
  return {
    width: Math.round(1 + s * 3),
    opacity: 0.5 + s * 0.5,
  };
}

export function dustLimit(period) {
  if (Number.isFinite(period) && period > 0) return period;
  const key = String(period ?? "").trim().toLowerCase();
  return DUST_PERIODS[key] ?? null;
}

function stampsOf(item) {
  return {
    edit: item?.editTime ?? item?.edit,
    create: item?.createTime ?? item?.create,
    now: Number.isFinite(item?.now) ? item.now : Date.now(),
  };
}

export function dustAge(editTime, createTime, now) {
  const stamps = [editTime, createTime].filter((n) => Number.isFinite(n));
  if (!stamps.length || !Number.isFinite(now)) return null;
  return Math.max(0, now - Math.max(...stamps));
}

export function dusty(item, period) {
  const limit = dustLimit(period);
  if (limit == null) return false;
  const times = stampsOf(item);
  const age = dustAge(times.edit, times.create, times.now);
  return age != null && age >= limit;
}

function ageParts(ms) {
  const days = Math.max(0, Math.round(Number(ms) / DAY));
  if (days <= 0) return { n: 0, unit: "today" };
  if (days < 30) return { n: days, unit: "day" };
  if (days < 365) return { n: Math.max(1, Math.round(days / 30)), unit: "month" };
  return { n: Math.max(1, Math.round(days / 365)), unit: "year" };
}

export function ageLabel(ms) {
  if (!Number.isFinite(ms)) return "";
  const part = ageParts(ms);
  if (part.unit === "today") return "today";
  const word = part.n === 1 ? part.unit : `${part.unit}s`;
  return `${part.n} ${word}`;
}

function countPhrase(value, one, many) {
  const n = Number(value);
  const v = Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  return `${v} ${v === 1 ? one : many}`;
}

export function explain(components = {}) {
  const refs = countPhrase(components?.refs, "ref", "refs");
  const shared = countPhrase(components?.shared, "shared board", "shared boards");
  const edit = components?.editTime ?? components?.edit;
  const now = Number.isFinite(components?.now) ? components.now : Date.now();
  let when = "not edited";
  if (Number.isFinite(edit)) {
    const part = ageParts(Math.max(0, now - edit));
    when = part.unit === "today" ? "edited today" : `edited ${part.n} ${part.n === 1 ? part.unit : `${part.unit}s`} ago`;
  }
  return `${refs}, ${shared}, ${when}`;
}

export function edgeOpens(store, from, to) {
  if (typeof store?.get !== "function") return 0;
  return store.get(from) + store.get(to);
}

// Device-local open counts. Off until the parent turns track-opens on.
export function createOpenStore({ storage = globalThis.localStorage, graph = "", enabled = false } = {}) {
  const key = `${OPEN_PREFIX}${graph}`;
  let on = enabled === true;
  const read = () => {
    try {
      const raw = storage?.getItem?.(key);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  const write = (data) => {
    try { storage?.setItem?.(key, JSON.stringify(data)); } catch { /* quota or private mode */ }
  };
  return {
    key,
    get enabled() { return on; },
    setEnabled(value) { on = value === true; },
    get(uid) {
      const n = Number(read()[uid]);
      return Number.isFinite(n) && n > 0 ? n : 0;
    },
    bump(uid) {
      if (!uid) return 0;
      const current = this.get(uid);
      if (!on) return current;
      const data = read();
      const next = current + 1;
      data[uid] = next;
      write(data);
      return next;
    },
    dispose() {},
  };
}
