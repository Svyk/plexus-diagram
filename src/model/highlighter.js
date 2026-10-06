// Colour-highlighter tags on a block string. No DOM and no props.
// The caller that already has a props fill keeps it and does not call fillFromTags.

const NAME = "[A-Za-z0-9_]+";

// Longer forms first so #bg-ch- is not swallowed by #bg-.
const BG_SRC = [
  `#\\[\\[bg-ch-${NAME}\\]\\]`,
  `#\\[\\[bg-${NAME}\\]\\]`,
  `#bg-ch-${NAME}`,
  `#bg-${NAME}`,
  `\\[\\[bg-ch-${NAME}\\]\\]`,
  `\\[\\[bg-${NAME}\\]\\]`,
].join("|");

const TAG_SRC = [
  `#\\[\\[bg-ch-(${NAME})\\]\\]`,
  `#\\[\\[bg-(${NAME})\\]\\]`,
  `#\\[\\[c:(${NAME})\\]\\]`,
  `#bg-ch-(${NAME})`,
  `#bg-(${NAME})`,
  `#c:(${NAME})`,
  `\\[\\[bg-ch-(${NAME})\\]\\]`,
  `\\[\\[bg-(${NAME})\\]\\]`,
].join("|");

// Light washes from the colour highlighter's defaults. Purple and pink are not
// in that stylesheet; grey is the same wash as gray.
const GRAY = "#dddddd";
const FALLBACK = {
  red: "#fcb8b8",
  orange: "#ffecd0",
  yellow: "#fff6b9",
  green: "#d3f8d5",
  blue: "#cee9ff",
  purple: "#e5d4fc",
  pink: "#ffd0ea",
  gray: GRAY,
  grey: GRAY,
  teal: "#39cccc",
};

function bgName(match) {
  return match[1] || match[2] || match[4] || match[5] || match[7] || match[8] || null;
}

function textName(match) {
  return match[3] || match[6] || null;
}

export function highlighterTags(string) {
  const out = { bg: null, text: null };
  if (typeof string !== "string" || !string) return out;
  // A plain note has neither marker. Building the tag expression is the whole cost.
  if (string.indexOf("#") === -1 && string.indexOf("[[") === -1) return out;
  const re = new RegExp(TAG_SRC, "g");
  let match = re.exec(string);
  while (match) {
    const bg = bgName(match);
    const text = textName(match);
    if (bg && out.bg == null) out.bg = bg;
    if (text && out.text == null) out.text = text;
    if (out.bg != null && out.text != null) break;
    match = re.exec(string);
  }
  return out;
}

function probed(probe, key) {
  const value = probe(key);
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

// probe(name) is the computed --cl-lh-<name> or --cl-dk-<name>. Non-empty wins.
// A probe that only reads custom properties is also asked for those variable names.
function fromProbe(probe, name) {
  if (typeof probe !== "function") return "";
  const direct = probed(probe, name);
  if (direct) return direct;
  const lower = name.toLowerCase();
  if (lower !== name) {
    const folded = probed(probe, lower);
    if (folded) return folded;
  }
  return probed(probe, `--cl-lh-${lower}`) || probed(probe, `--cl-dk-${lower}`);
}

export function fillFromTags(tags, probe) {
  const parsed = typeof tags === "string" || tags == null ? highlighterTags(tags) : tags;
  const name = typeof parsed?.bg === "string" ? parsed.bg : "";
  if (!name) return "";
  return fromProbe(probe, name) || FALLBACK[name.toLowerCase()] || "";
}

function bgSpans(string) {
  const out = [];
  const re = new RegExp(BG_SRC, "g");
  let match = re.exec(string);
  while (match) {
    out.push([match.index, match.index + match[0].length]);
    match = re.exec(string);
  }
  return out;
}

// Drop one token and a single bordering space so the neighbours stay one gap apart.
function dropSpan(string, start, end) {
  let a = start;
  let b = end;
  const before = a > 0 && string[a - 1] === " ";
  const after = b < string.length && string[b] === " ";
  if (before && after) b += 1;
  else if (before && b === string.length) a -= 1;
  else if (after && a === 0) b += 1;
  return string.slice(0, a) + string.slice(b);
}

// name null removes the first bg token. A name replaces that token with one
// #[[bg-<name>]] (bracket form, so an editor round-trip keeps it) and drops any
// later bg token. Appending happens only when the string has none.
export function rewriteBgTag(string, name) {
  const src = typeof string === "string" ? string : "";
  const spans = bgSpans(src);
  if (name == null) {
    if (!spans.length) return src;
    return dropSpan(src, spans[0][0], spans[0][1]);
  }
  if (typeof name !== "string" || !/^[A-Za-z0-9_]+$/.test(name)) return src;
  const token = `#[[bg-${name}]]`;
  if (!spans.length) {
    if (!src) return token;
    return /\s$/.test(src) ? src + token : `${src} ${token}`;
  }
  let next = src;
  for (let i = spans.length - 1; i >= 1; i -= 1) {
    next = dropSpan(next, spans[i][0], spans[i][1]);
  }
  return next.slice(0, spans[0][0]) + token + next.slice(spans[0][1]);
}
