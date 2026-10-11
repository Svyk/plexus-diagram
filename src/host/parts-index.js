// Lazy in-memory index of parsed-PDF parts. Docs come from the parse cache, one per PDF url found in the graph.
// Rebuilt after invalidate() (the panel calls it on open); a doc that did not change is not re-indexed.

import { parsedDocTitle, pdfFileTitle } from "../model/pdf.js";
import { buildPartsIndex } from "../model/parts-search.js";
import { restorableByUrl } from "./parse-store.js";

// Same options the reader uses for the plain built-in parse.
const PLAIN_OPTIONS = Object.freeze({ ocr: "none", formula: false, tables: "builtin" });

export function createPartsIndex({ store, listPdfs, plainOptions = PLAIN_OPTIONS } = {}) {
  const perDoc = new Map();
  let rows = null;
  let building = null;
  let epoch = 0;

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
      try { doc = await restorableByUrl(store, pdf.url, { plainOptions }); } catch { doc = null; }
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
    if (mine === epoch) rows = out;
    return out;
  };

  return {
    async get() {
      if (rows) return rows;
      if (!building) building = build().finally(() => { building = null; });
      return building;
    },
    invalidate() {
      epoch += 1;
      rows = null;
    },
    size: () => (rows ? rows.length : 0),
  };
}
