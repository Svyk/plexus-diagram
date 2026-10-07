// Schema → Roam markdown for data.block.fromMarkdown.
// One top-level bullet per block. Children indent by two spaces.
//
// ESCAPES is the rule table (§4.1). Checked 2026-10-07: `git -C ~/roam-grid log -5`
// (332fe54, 5390e7f, cc73ecd, 636942a, ec01941) and ~/roam-grid/docs have no
// measured fromMarkdown escaping table yet. The rules below are the design's.
// [[…]] ((…)) {{…}} #word and a leading word:: are wrapped in inline code,
// the wrap the design attributes to write_roam.py. When RG-1 lands a measured
// table, replace this object from it.

import { selectBlocks } from "./parse-schema.js";

export const ESCAPES = Object.freeze({
  whitespace: Object.freeze({
    cr: "",
    nbsp: " ",
    newline: " ",
  }),
  markers: Object.freeze([
    Object.freeze({ id: "bullet", re: /^- / }),
    Object.freeze({ id: "star", re: /^\* / }),
    Object.freeze({ id: "plus", re: /^\+ / }),
    Object.freeze({ id: "quote", re: /^> / }),
    Object.freeze({ id: "ordered", re: /^\d+\. / }),
    Object.freeze({ id: "fence", re: /^```/ }),
    Object.freeze({ id: "hash", re: /^#/ }),
  ]),
  placeholder: "⟦pxd-cell-N⟧",
  placeholderCap: 8,
  link: Object.freeze([
    Object.freeze({ id: "macro", re: /\{\{[\s\S]*?\}\}/g }),
    Object.freeze({ id: "page", re: /\[\[[\s\S]*?\]\]/g }),
    Object.freeze({ id: "block", re: /\(\([\s\S]*?\)\)/g }),
    Object.freeze({ id: "hash", re: /(^|\s)(#[A-Za-z0-9][\w/-]*)/g }),
    Object.freeze({ id: "attr", re: /^([^\s`][^:\n]{0,80}::)/ }),
  ]),
});

const SUPERSCRIPT = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};

export function flattenLine(text) {
  return String(text ?? "")
    .replace(/\r/g, ESCAPES.whitespace.cr)
    .replace(/\u00a0/g, ESCAPES.whitespace.nbsp)
    .replace(/\n/g, ESCAPES.whitespace.newline)
    .replace(/ {2,}/g, " ")
    .trim();
}

function wrapInline(match) {
  if (match.startsWith("`") && match.endsWith("`")) return match;
  return `\`${match}\``;
}

export function linkSafeText(text) {
  let out = String(text ?? "");
  for (const rule of ESCAPES.link) {
    if (rule.id === "hash") {
      out = out.replace(rule.re, (full, pre, word) => `${pre}\`${word}\``);
    } else if (rule.id === "attr") {
      out = out.replace(rule.re, (full, word) => `\`${word}\``);
    } else {
      out = out.replace(rule.re, (full) => wrapInline(full));
    }
  }
  return out;
}

function markerHit(line) {
  for (const rule of ESCAPES.markers) {
    const match = rule.re.exec(line);
    if (match && match.index === 0) return match[0];
  }
  return null;
}

function backtickMarker(line) {
  const marker = markerHit(line);
  if (!marker) return line;
  const rest = line.slice(marker.length);
  const shown = marker.trimEnd();
  return `\`${shown}\`${rest ? ` ${rest}` : ""}`;
}

function prepareLine(text, { linkSafe, markers }) {
  let line = flattenLine(text);
  if (linkSafe) line = linkSafeText(line);
  if (!markerHit(line)) return { text: line, dangerous: false, raw: line };
  if (markers === "backtick") return { text: backtickMarker(line), dangerous: false, raw: line };
  return { text: line, dangerous: true, raw: line };
}

function placeholderToken(n) {
  return ESCAPES.placeholder.replace("N", String(n));
}

function applyFootnoteRefs(text, refs) {
  if (!refs?.length) return text;
  let out = text;
  for (const ref of refs) {
    const mark = String(ref.mark ?? "");
    if (!mark) continue;
    const token = `[${mark}]`;
    if (out.includes(token)) continue;
    const sup = Object.keys(SUPERSCRIPT).find((ch) => SUPERSCRIPT[ch] === mark);
    if (sup && out.includes(sup)) {
      out = out.replace(sup, token);
      continue;
    }
    if (Number.isInteger(ref.at) && ref.at >= 0 && ref.at <= out.length) {
      out = `${out.slice(0, ref.at)}${token}${out.slice(ref.at)}`;
    } else {
      out += token;
    }
  }
  return out;
}

function bullet(depth, text) {
  return `${"  ".repeat(depth)}- ${text ?? ""}`;
}

function itemContent(item, ordered, numbered) {
  const marker = item.marker || (ordered ? "1." : "•");
  const text = item.text ?? "";
  if (ordered && numbered) {
    if (/^\d+\.$/.test(marker)) return marker === "1." ? `1. ${text}` : `1. ${marker} ${text}`;
    return `1. ${marker} ${text}`;
  }
  if (ordered) return `• ${marker} ${text}`;
  if (!marker || marker === "•" || marker === "-" || marker === "*") return `• ${text}`;
  return `• ${marker} ${text}`;
}

function headingPrefix(level) {
  if (level === 1) return "# ";
  if (level === 2) return "## ";
  if (level === 3) return "### ";
  return null;
}

export function toRoamMarkdown(doc, idsOrRange, options = {}) {
  const linkSafe = options.linkSafe !== false;
  const numbered = options.numbered === true;
  const footnotes = options.footnotes === "end" ? "end" : "inline";
  const blocks = selectBlocks(doc, idsOrRange);
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const folded = new Set();
  for (const block of blocks) {
    if (block.type === "caption" && block.for && byId.has(block.for)) folded.add(block.id);
  }

  const render = (markerMode) => {
    const lines = [];
    const placeholders = [];
    let serial = 0;
    const emittedNotes = new Set();
    const foldedHere = new Set(folded);

    // User text is escaped. prefix and suffix are structural and stay raw,
    // so a heading's "#" and a numbered "1. " are not treated as cell markers.
    const putUser = (depth, text, prefix = "", suffix = "") => {
      const prepared = prepareLine(text, { linkSafe, markers: markerMode });
      if (prepared.dangerous && markerMode === "placeholder") {
        serial += 1;
        const token = placeholderToken(serial);
        placeholders.push({ token, text: prepared.raw });
        lines.push(bullet(depth, `${prefix}${token}${suffix}`));
        return;
      }
      lines.push(bullet(depth, `${prefix}${prepared.text}${suffix}`));
    };
    const emitRaw = (depth, text) => {
      lines.push(bullet(depth, text));
    };

    const emitNote = (note) => {
      if (!note || emittedNotes.has(note.id)) return;
      emittedNotes.add(note.id);
      const mark = note.mark ?? "";
      putUser(0, note.text ?? "", `[${mark}] `);
    };

    const notesFor = (block) => {
      const refs = block.footnoteRefs || [];
      const notes = [];
      for (const ref of refs) {
        const note = ref.to ? byId.get(ref.to) : null;
        if (note?.type === "footnote") notes.push(note);
      }
      return notes;
    };

    for (const block of blocks) {
      if (foldedHere.has(block.id)) continue;
      if (block.type === "footnote") {
        if (footnotes === "end") continue;
        if (emittedNotes.has(block.id)) continue;
        emitNote(block);
        continue;
      }
      if (block.type === "heading") {
        const prefix = headingPrefix(block.level);
        if (prefix) putUser(0, block.text ?? "", prefix);
        else putUser(0, block.text ?? "", "**", "**");
      } else if (block.type === "para") {
        putUser(0, applyFootnoteRefs(block.text ?? "", block.footnoteRefs));
        if (footnotes === "inline") {
          for (const note of notesFor(block)) emitNote(note);
        }
      } else if (block.type === "list") {
        for (const item of block.items || []) {
          const depth = Number.isInteger(item.level) && item.level > 0 ? item.level : 0;
          const text = item.text ?? "";
          if (block.ordered === true && numbered) {
            const marker = item.marker || "1.";
            const body = marker === "1." ? text : `${marker} ${text}`;
            putUser(depth, body, "1. ");
          } else {
            putUser(depth, itemContent(item, block.ordered === true, false));
          }
        }
      } else if (block.type === "table") {
        emitTable(block, putUser, emitRaw, byId, foldedHere);
      } else if (block.type === "figure") {
        emitFigure(block, putUser, byId);
      } else if (block.type === "formula") {
        if (block.latex) {
          const number = block.number ? ` ${block.number}` : "";
          putUser(0, block.latex, "$$", `$$${number}`);
        } else {
          emitFigure(block, putUser, byId);
        }
      } else if (block.type === "caption") {
        putUser(0, block.text ?? "");
      } else if (block.type === "code") {
        const body = prepareLine(block.text ?? "", { linkSafe, markers: "backtick" }).text;
        emitRaw(0, `\`\`\`${body}\`\`\``);
      } else if (block.type === "scan") {
        emitRaw(0, `Scanned page ${block.page} (no text)`);
      }
    }
    if (footnotes === "end") {
      for (const block of blocks) {
        if (block.type === "footnote") emitNote(block);
      }
    }
    return { lines, placeholders };
  };

  let drafted = render("placeholder");
  if (drafted.placeholders.length > ESCAPES.placeholderCap) drafted = render("backtick");
  const markdown = drafted.lines.join("\n");
  return {
    markdown,
    placeholders: drafted.placeholders,
    blockEstimate: drafted.lines.length,
  };
}

function captionFor(block, byId) {
  if (block.caption && typeof block.caption === "string" && !byId.has(block.caption)) return block.caption;
  for (const other of byId.values()) {
    if (other.type === "caption" && other.for === block.id) return other.text ?? "";
  }
  return "";
}

function emitFigure(block, putUser, byId) {
  const caption = captionFor(block, byId) || block.text || "";
  const url = block.image?.url || block.url || "";
  const kind = block.type === "formula" ? "formula" : "figure";
  const page = block.page != null ? `, p. ${block.page}` : "";
  if (url) {
    putUser(0, caption, "![", `](${url})`);
    return;
  }
  if (caption) putUser(0, caption, "", ` (${kind}${page})`);
  else putUser(0, `${block.type === "formula" ? "Formula" : "Figure"} (${kind}${page})`);
}

function emitTable(block, putUser, emitRaw, byId, folded) {
  emitRaw(0, "{{[[table]]}}");
  const rows = Number.isInteger(block.rows) ? block.rows : 0;
  const cols = Number.isInteger(block.cols) ? block.cols : 0;
  const covered = new Set();
  const at = new Map();
  for (const cell of block.cells || []) {
    const rs = cell.rowSpan ?? 1;
    const cs = cell.colSpan ?? 1;
    at.set(`${cell.r}:${cell.c}`, cell);
    for (let dr = 0; dr < rs; dr += 1) {
      for (let dc = 0; dc < cs; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        covered.add(`${cell.r + dr}:${cell.c + dc}`);
      }
    }
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const key = `${r}:${c}`;
      const text = covered.has(key) ? "" : (at.get(key)?.text ?? "");
      putUser(1 + c, text);
    }
  }
  const caption = captionFor(block, byId);
  if (caption) {
    if (typeof block.caption === "string" && byId.has(block.caption)) folded.add(block.caption);
    putUser(1, caption);
  }
}

// Grid inserts have no second updateString pass, so a leading marker is backticked.
export function escapeForGrid(text) {
  return prepareLine(text, { linkSafe: true, markers: "backtick" }).text;
}
