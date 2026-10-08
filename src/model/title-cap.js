// Titles are cut on a word boundary at about 80 characters, with an ellipsis. Never mid-word.
export const TITLE_CAP = 80;

// Word list for title segmentation, set only from a lexicon already in Cache Storage.
let titleLexicon = null;
export function setTitleLexicon(words) {
  titleLexicon = words && typeof words.has === "function" ? words : null;
}

const SEG_MIN = 18;
const SEG_MAX_WORDS = 12;
const SEG_WORD_MIN = 4;
const FUNCTION_WORDS = new Set(["of", "the", "and", "in", "to", "for", "per", "on", "at", "by", "with", "from", "or", "an", "a"]);

// Revision of the title rules. Stored page titles carry the revision they were made with; an older
// one is read again (the first splitter cut real words such as "Supplementation").
export const TITLE_REV = 2;

// Split one run-together letter token ("Summaryofreportedcasesper") into pieces, conservatively:
// the token has 18+ letters and is no word, there are 3+ pieces, at least one is a function word, and
// every other piece is a dictionary word of 4+ letters. Fewest pieces, then longer ones.
// Returns the pieces in original case, or null.
export function segmentToken(token, lexicon) {
  const t = String(token || "");
  if (!lexicon || t.length < SEG_MIN || !/^\p{L}+$/u.test(t)) return null;
  const lower = t.toLowerCase();
  if (lexicon.has(lower)) return null;
  const n = lower.length;
  const best = new Array(n + 1).fill(null);
  best[0] = { count: 0, sq: 0, prev: -1 };
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - 24); j < i; j++) {
      if (!best[j]) continue;
      const len = i - j;
      const word = lower.slice(j, i);
      if (!(FUNCTION_WORDS.has(word) || (len >= SEG_WORD_MIN && lexicon.has(word)))) continue;
      const cand = { count: best[j].count + 1, sq: best[j].sq + len * len, prev: j };
      const cur = best[i];
      if (!cur || cand.count < cur.count || (cand.count === cur.count && cand.sq > cur.sq)) best[i] = cand;
    }
  }
  if (!best[n] || best[n].count < 3 || best[n].count > SEG_MAX_WORDS) return null;
  const out = [];
  for (let i = n; i > 0; i = best[i].prev) out.unshift(t.slice(best[i].prev, i));
  if (!out.some((piece) => FUNCTION_WORDS.has(piece.toLowerCase()))) return null;
  return out;
}

// Titles only: split run-together words (a text layer with no spaces). No lexicon, no change.
export function segmentTitle(text, lexicon = titleLexicon) {
  const clean = typeof text === "string" ? text : "";
  if (!lexicon || !clean) return clean;
  return clean.replace(/\S*\p{L}{18,}\S*/gu, (word) => {
    const runs = word.match(/\p{L}+|[^\p{L}]+/gu) || [];
    let split = false;
    const parts = runs.map((run) => {
      const pieces = /^\p{L}{18,}$/u.test(run) ? segmentToken(run, lexicon) : null;
      if (pieces) split = true;
      return pieces ? pieces.join(" ") : run;
    });
    if (!split) return word;
    // A split word's neighbours (letters beside a number) become separate words too.
    let out = "";
    for (let i = 0; i < parts.length; i++) {
      const prev = runs[i - 1];
      if (i && /^\p{L}/u.test(runs[i]) !== /^\p{L}/u.test(prev) && /\p{N}/u.test(/^\p{L}/u.test(runs[i]) ? prev : runs[i])) out += " ";
      out += parts[i];
    }
    return out;
  });
}

export function capTitle(text, cap = TITLE_CAP, lexicon = titleLexicon) {
  const clean = segmentTitle(typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "", lexicon);
  if (clean.length <= cap) return clean;
  const cut = clean.slice(0, cap + 1);
  const space = cut.lastIndexOf(" ");
  const head = (space > 0 ? cut.slice(0, space) : clean.slice(0, cap)).replace(/[\s,;:.\-–—]+$/, "");
  return `${head}…`;
}

// The PDF's own Title field sometimes holds a cut-off first word of the heading ("NOTIFIABL").
export function isCutPrefix(title, heading) {
  const t = typeof title === "string" ? title.trim() : "";
  const h = typeof heading === "string" ? heading.replace(/\s+/g, " ").trim() : "";
  return t.length > 0 && h.length > t.length && h.toLowerCase().startsWith(t.toLowerCase()) && /\S/.test(h[t.length]);
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const JUNK_LINE_RES = [
  /^(?:notes?|sources?)\s*(?:[:.\-–—]|$)/i,
  /^[*†‡§¶•]/,
  /^rates?\s+less\s+than\b/i,
  /^\W*\d{1,4}\W*$/,
  /^page\s+\d+(\s+of\s+\d+)?$/i,
  /^\d{1,4}\s*\/\s*\d{1,4}$/,
  /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/,
  /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/,
  new RegExp(`^(?:\\d{1,2}\\s+)?(?:${MONTHS})\\.?\\s+(?:\\d{1,2},?\\s+)?\\d{4}$`, "i"),
  /\bcontents lists? available at\b/i,
  /\bjournal homepage\b/i,
  /\b(?:https?:\/\/|www\.)\S+/i,
  /\b[\w-]+\.(?:com|org|edu|gov|net|eu)\b/i,
  /\bdoi\b\s*[:.]?|\b10\.\d{4,9}\//i,
  /\bvol(?:ume)?\.?\s*\d+|\bissue\s+\d+|\bno\.\s*\d+\s*[,(]|\(\d{4}\)\s*\d{2,}/i,
  /^(?:©|copyright\b)|\ball rights reserved\b/i,
  /^(?:available online|received|accepted|revised|keywords?|abstract|article info|a r t i c l e)\b/i,
  /^L\s*\d+\/\d+$/,
];

// A line that is page furniture or journal chrome, never a paper title: dates, page numbers,
// volume/issue lines, URLs, DOIs, "Contents lists available at", "journal homepage".
export function isJunkTitleText(text) {
  const t = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!t) return true;
  return JUNK_LINE_RES.some((re) => re.test(t));
}

export function titleWordCount(text) {
  return String(text ?? "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function plainTitle(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

const CITATION_REST = /^[\s\d().,:;/–—-]*$/;

// `text` is a banner line of `line`: the same words (when `exact`), or the same words inside a line
// whose other text is only volume, year and page numbers (two groups or more). A journal name inside its running header
// ("Science of the Total Environment" in "Science of the Total Environment 877 (2023) 162730").
export function isBannerOf(text, line, { exact = true } = {}) {
  const a = plainTitle(text);
  const b = plainTitle(line);
  if (!a || !b) return false;
  if (a === b) return exact;
  const at = b.indexOf(a);
  if (at < 0) return false;
  const before = b[at - 1];
  const after = b[at + a.length];
  if ((before && /[\p{L}\p{N}]/u.test(before)) || (after && /[\p{L}\p{N}]/u.test(after))) return false;
  const rest = `${b.slice(0, at)} ${b.slice(at + a.length)}`;
  // Two number groups at least (volume and year, year and page): a lone page number is a running
  // header that repeats the real title.
  return (rest.match(/\d+/g) || []).length >= 2 && CITATION_REST.test(rest);
}

// A metadata Title that only repeats a banner of page 1 (a journal name, a running header) when the
// page has a title of its own. `lines`: running headers and page-1 line or block texts.
export function isMetaBanner(metaTitle, { pageTitle = "", lines = [] } = {}) {
  const meta = plainTitle(metaTitle);
  const page = plainTitle(pageTitle);
  if (!meta || !page || meta === page || page.startsWith(meta)) return false;
  for (const line of Array.isArray(lines) ? lines : []) {
    if (typeof line !== "string" || plainTitle(line) === page) continue;
    if (isBannerOf(meta, line)) return true;
  }
  return false;
}
