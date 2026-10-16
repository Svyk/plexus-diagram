// Lazy in-memory index of parsed-PDF parts. Docs come from the parse cache, one per PDF url found in the graph.
// Rebuilt after invalidate() (the panel calls it on open); a doc that did not change is not re-indexed.

import { parsedDocTitle, pdfFileTitle } from "../model/pdf.js";
import { buildPartsIndex, schedulePartsIndex } from "../model/parts-search.js";
import { readableParse, subscribeParseStored } from "./parse-store.js";

// Same options the reader uses for the plain built-in parse.
const PLAIN_OPTIONS = Object.freeze({ ocr: "none", formula: false, tables: "builtin" });

// One parse-store listener for all live indexes; it detaches when the last index is disposed.
const live = new Set();
let offStored = null;

function attach(index) {
  live.add(index);
  if (!offStored) {
    offStored = subscribeParseStored((info) => { for (const one of [...live]) one.parseStored(info); });
  }
}

function detach(index) {
  live.delete(index);
  if (!live.size && offStored) { offStored(); offStored = null; }
}

export function createPartsIndex({ store, listPdfs, plainOptions = PLAIN_OPTIONS, budget = null, now } = {}) {
  const perDoc = new Map();
  let rows = null;
  let building = null;
  let epoch = 0;
  let stopIndex = null;
  const changed = new Set();

  const build = async () => {
    const mine = epoch;
    const pdfs = [];
    const seen = new Set();
    let listed = [];
    try { listed = (await Promise.resolve(listPdfs?.())) || []; } catch { listed = []; }
    for (const pdf of listed) {
      if (!pdf?.url || seen.has(pdf.url)) continue;
      seen.add(pdf.url);
      pdfs.push(pdf);
    }
    const out = [];
    for (const pdf of pdfs) {
      let doc = null;
      try { doc = await readableParse(store, pdf.url, { plainOptions }); } catch { doc = null; }
      if (!doc?.sha256) continue;
      const key = `${doc.sha256}|${doc.engine}|${doc.optsHash || ""}|${doc.parseRev || 0}|${pdf.uid}`;
      let part = perDoc.get(key);
      if (!part) {
        const docTitle = parsedDocTitle(doc) || pdfFileTitle(pdf.url) || pdf.pageTitle || "PDF";
        part = buildPartsIndex(doc, { url: pdf.url, docTitle, pdfUid: pdf.uid });
        perDoc.set(key, part);
      }
      out.push(...part);
    }
    if (mine === epoch) {
      rows = out;
      try { stopIndex?.(); } catch { /* gone */ }
      // The gram index fills in idle slices. get() does not build it, so a keystroke cannot either.
      stopIndex = schedulePartsIndex(out, {
        budget,
        now,
        onReady: () => {
          if (mine !== epoch) return;
          for (const fn of [...changed]) { try { fn({}); } catch { /* listener */ } }
        },
      });
    }
    return out;
  };

  const index = {
    async get() {
      if (rows) return rows;
      if (!building) building = build().finally(() => { building = null; });
      return building;
    },
    invalidate() {
      epoch += 1;
      rows = null;
      try { stopIndex?.(); } catch { /* gone */ }
      stopIndex = null;
    },
    size: () => (rows ? rows.length : 0),
    // A parse was just stored: drop that sha's cached rows and the merged rows; the next get() rebuilds.
    parseStored({ sha256 } = {}) {
      if (sha256) for (const key of [...perDoc.keys()]) if (key.startsWith(`${sha256}|`)) perDoc.delete(key);
      index.invalidate();
      for (const fn of [...changed]) { try { fn({ sha256 }); } catch { /* listener */ } }
    },
    onChange(fn) {
      changed.add(fn);
      return () => { changed.delete(fn); };
    },
    dispose() {
      try { stopIndex?.(); } catch { /* gone */ }
      stopIndex = null;
      detach(index);
      changed.clear();
    },
  };
  attach(index);
  return index;
}
