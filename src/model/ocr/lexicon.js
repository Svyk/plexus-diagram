// Conservative word fixes for OCR text lines: case inside a word, and a dictionary word that
// differs only in letters the recogniser confuses at low confidence. Pure; the word list comes in
// as a Set (src/host/ocr-web.js loads it, SHA-checked, from assets/ocr).

import { segmentToken } from "../title-cap.js";

const LETTERS = /^[A-Za-z]+$/;
const LOW_CHAR = 0.9;
const MIN_LEN = 3;

// Letter pairs the PP-OCR rec model swaps in degraded or small type (lowercase).
const SWAPS = {
  a: ["e", "o", "s", "c"],
  e: ["a", "o", "c", "m"],
  o: ["a", "e", "c"],
  c: ["e", "o", "a"],
  i: ["l", "j"],
  l: ["i", "t"],
  t: ["l", "f"],
  f: ["t"],
  j: ["i"],
  n: ["m", "h", "u"],
  m: ["n", "e"],
  h: ["b", "n"],
  b: ["h"],
  u: ["n", "v"],
  v: ["u"],
  s: ["a"],
};
const MULTI = [["rn", "m"], ["m", "rn"], ["cl", "d"], ["d", "cl"], ["ri", "n"], ["vv", "w"]];

export function parseLexicon(text) {
  const set = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    const w = line.trim().toLowerCase();
    if (w) set.add(w);
  }
  return set;
}

// Letters only, not all upper, not all lower, not Capitalised: "NOtiFIABLE", "DISEASeS".
export function oddCase(word) {
  if (!LETTERS.test(word) || word.length < 2) return false;
  if (word === word.toUpperCase() || word === word.toLowerCase()) return false;
  if (word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()) return false;
  // CamelCase names ("BlendHouse") are written that way.
  if (/^(?:[A-Z][a-z]+){2,}$/.test(word)) return false;
  return true;
}

// The line's dominant case: "upper" when most of its words of 2+ letters are all capitals.
export function lineCase(words) {
  let upper = 0;
  let other = 0;
  for (const w of words) {
    const letters = String(w).replace(/[^A-Za-z]/g, "");
    if (letters.length < 2) continue;
    if (letters === letters.toUpperCase()) upper++;
    else other++;
  }
  return upper > other ? "upper" : "mixed";
}

export function normalizeCase(word, dominant = "mixed") {
  if (!oddCase(word)) return word;
  const ups = word.replace(/[^A-Z]/g, "").length;
  if (dominant === "upper" || ups >= 0.6 * word.length) return word.toUpperCase();
  if (word[0] === word[0].toUpperCase()) return word[0] + word.slice(1).toLowerCase();
  return word.toLowerCase();
}

function applyCasing(model, word) {
  if (model === model.toUpperCase() && model.length > 1) return word.toUpperCase();
  if (model[0] === model[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

// Candidates within OCR-confusion distance: up to two single-letter swaps at low-confidence
// positions, or one multi-letter swap (rn/m, cl/d) touching a low-confidence position.
function candidates(lower, low, maxSwaps) {
  const out = new Set();
  const positions = [];
  for (let i = 0; i < lower.length; i++) if (low[i] && SWAPS[lower[i]]) positions.push(i);
  const swapAt = (s, i) => (SWAPS[s[i]] || []).map((ch) => s.slice(0, i) + ch + s.slice(i + 1));
  for (const i of positions) {
    for (const one of swapAt(lower, i)) {
      out.add(one);
      if (maxSwaps < 2) continue;
      for (const j of positions) if (j > i) for (const two of swapAt(one, j)) out.add(two);
    }
  }
  for (const [from, to] of MULTI) {
    let at = lower.indexOf(from);
    while (at >= 0) {
      let touches = false;
      for (let k = at; k < at + from.length; k++) if (low[k]) touches = true;
      if (touches) out.add(lower.slice(0, at) + to + lower.slice(at + from.length));
      at = lower.indexOf(from, at + 1);
    }
  }
  out.delete(lower);
  return out;
}

// One token (punctuation around it is kept). `confs` are per-letter confidences aligned with the
// token's letters, or null (then `conf`, the word's mean, must be low and one swap is allowed).
// Returns the corrected token or the token unchanged.
export function correctWord(token, { lexicon, confs = null, conf = 1, keep = null } = {}) {
  if (!lexicon || !lexicon.size) return token;
  const m = /^([^A-Za-z0-9]*)([A-Za-z]+)([^A-Za-z0-9]*)$/.exec(token);
  if (!m) return token;
  const [, lead, core, tail] = m;
  if (core.length < MIN_LEN) return token;
  const lower = core.toLowerCase();
  if (lexicon.has(lower)) return token;
  if (keep && keep.has(lower)) return token;
  let low;
  let maxSwaps;
  if (confs && confs.length === core.length) {
    low = confs.map((c) => c < LOW_CHAR);
    maxSwaps = 2;
  } else {
    if (conf >= LOW_CHAR) return token;
    low = new Array(core.length).fill(true);
    maxSwaps = 1;
  }
  if (!low.some(Boolean)) return token;
  const hits = [...candidates(lower, low, maxSwaps)].filter((w) => lexicon.has(w));
  if (hits.length !== 1) return token;
  return lead + applyCasing(core, hits[0]) + tail;
}

// Alphabetic token (3+ letters) not in the list; digits mixed into letters ("1,000live", "O.00");
// odd case; punctuation inside letters.
export function suspiciousWord(token, { lexicon = null, keep = null } = {}) {
  const t = String(token || "");
  // A footnote mark on a word ("Kleshchev1", "1Quality", "Boyd1,2") is not a misread.
  const marked = /^\d{1,2}[A-Za-z]{3,}[^A-Za-z0-9]*$/.test(t) || /^[^A-Za-z0-9]*[A-Za-z]{3,}\d{1,2}(?:,\d{1,2})*[^A-Za-z0-9]*$/.test(t);
  if (/[A-Za-z]/.test(t) && /\d/.test(t) && !marked) return true;
  const core = (marked ? t.replace(/\d/g, "") : t).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
  // Punctuation inside letters: two words run together ("(EM)programs", "Portland<Food").
  if (/[A-Za-z][^A-Za-z0-9\-'’.&/]+[A-Za-z]/.test(core)) return true;
  if (oddCase(core)) return true;
  if (!lexicon || !lexicon.size || !LETTERS.test(core) || core.length < MIN_LEN) return false;
  const lower = core.toLowerCase();
  return !lexicon.has(lower) && !(keep && keep.has(lower));
}

// Capitalised (or CamelCase) words seen 2+ times across the text lines: proper-noun-looking,
// never corrected.
export function properNouns(words) {
  const count = new Map();
  for (const w of words) {
    const core = String(w).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    if (core.length < MIN_LEN || !/^(?:[A-Z][a-z]+)+$/.test(core)) continue;
    const k = core.toLowerCase();
    count.set(k, (count.get(k) || 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n >= 2).map(([k]) => k));
}

export function cleanWord(token, lexicon) {
  const core = String(token || "").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
  return Boolean(lexicon && core.length >= MIN_LEN && LETTERS.test(core) && lexicon.has(core.toLowerCase()));
}

// Two words the page pass ran together ("Environmentalmonitoring"): split only when the read was
// doubtful (`low`) and the token is no word, and only where both halves (4+ letters each) are in the
// list and exactly one split works, or the conservative title rule holds. Returns the tokens.
export function splitJoined(token, lexicon, { low = false } = {}) {
  if (!low) return [token];
  const m = /^([^A-Za-z0-9]*)([A-Za-z]+)([^A-Za-z0-9]*)$/.exec(String(token || ""));
  if (!m || !lexicon || !lexicon.size) return [token];
  const [, lead, core, tail] = m;
  if (core.length < 10 || !/^[A-Z]?[a-z]+$/.test(core) || lexicon.has(core.toLowerCase())) return [token];
  const lower = core.toLowerCase();
  const cuts = [];
  for (let i = 4; i <= lower.length - 4; i++) if (lexicon.has(lower.slice(0, i)) && lexicon.has(lower.slice(i))) cuts.push(i);
  if (cuts.length === 1) return [lead + core.slice(0, cuts[0]), core.slice(cuts[0]) + tail];
  const pieces = segmentToken(core, lexicon);
  if (!pieces) return [token];
  return pieces.map((piece, i) => (i === 0 ? lead : "") + piece + (i === pieces.length - 1 ? tail : ""));
}
