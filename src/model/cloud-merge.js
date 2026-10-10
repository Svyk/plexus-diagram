// Merge local figures into a LlamaParse document. No network, no graph writes.
// `mergeCloudFigures` is the function the extension and tools/parse-bench/cloud-hybrid.mjs share.
//
// Figure `source` after a merge:
//   "llamaparse" — kept from LlamaParse on a page the local read did not cover
//                  with figure detection, and no local match
//   "hybrid"     — IoU ≥ 0.5 with a local figure; the box is the local box;
//                  the caption is the better of the two when both are non-empty
//                  (a description beats a bare "Fig. 1"; a longer complete caption
//                  beats a shorter one). An empty side keeps the other.
//   "local"      — a local figure LlamaParse missed
// On a page where figure detection ran, the figures are the local ones only.
// A LlamaParse figure with no local match is dropped there. Detection ran when
// the page was OCR'd (`doc.ocr` and the page is in `doc.ocr.pages` or `page.ocr`),
// or the page is a born-digital built-in page (`kind` "text" or "mixed"). A scan
// page of a plain built-in parse did not run it, so its LlamaParse figures stay.
// A layout figure (`image.layout`) that still says "llamaparse" and overlaps a table is dropped.
// No local document: the cloud document is returned unchanged.

import { iou, validateParse } from "./parse-schema.js";

const IOU_MATCH = 0.5;

function emptyBox(box) {
  return !box || box.length < 4 || box[2] - box[0] <= 0 || box[3] - box[1] <= 0;
}

function onTable(box, tableBox) {
  if (emptyBox(box) || emptyBox(tableBox)) return false;
  if (iou(box, tableBox) >= IOU_MATCH) return true;
  const area = (box[2] - box[0]) * (box[3] - box[1]);
  if (!(area > 0)) return false;
  const ix = Math.max(0, Math.min(box[2], tableBox[2]) - Math.max(box[0], tableBox[0]));
  const iy = Math.max(0, Math.min(box[3], tableBox[3]) - Math.max(box[1], tableBox[1]));
  return (ix * iy) / area >= 0.5;
}

function pagesOf(doc) {
  const set = new Set();
  for (const page of doc?.pages || []) if (Number.isInteger(page?.n)) set.add(page.n);
  for (const block of Object.values(doc?.blocks || {})) {
    if (Number.isInteger(block?.page)) set.add(block.page);
  }
  return [...set];
}

function blocksOf(doc, page, type) {
  const out = [];
  const blocks = doc?.blocks || {};
  for (const id of doc?.order || []) {
    const block = blocks[id];
    if (block?.type === type && block.page === page) out.push(block);
  }
  return out;
}

function pagePairs(cloud, local) {
  const cloudPages = pagesOf(cloud);
  const localPages = new Set(pagesOf(local));
  const pairs = [];
  for (const n of cloudPages) if (localPages.has(n)) pairs.push([n, n]);
  if (!pairs.length && cloudPages.length === 1 && localPages.size === 1) {
    pairs.push([cloudPages[0], [...localPages][0]]);
  }
  return pairs;
}

function captionBlock(doc, figure) {
  const id = figure?.caption;
  const block = id && doc?.blocks ? doc.blocks[id] : null;
  return block?.type === "caption" ? block : null;
}

function captionText(block) {
  return String(block?.text || "").replace(/\s+/g, " ").trim();
}

function captionScore(text) {
  const words = text.split(/\s+/).filter(Boolean);
  let score = Math.min(words.length, 28);
  if (/^(?:fig(?:ure)?s?|plates?|abb(?:ildung)?|tafeln?|tafel|taf)\b/i.test(text)) score += 6;
  if (words.length <= 2 && /^(?:fig(?:ure)?s?|plates?|abb(?:ildung)?|tafeln?|tafel|taf)\.?\s*(?:\d+[A-Za-z]?|[IVXLC]+)?[.:]?$/i.test(text)) score -= 4;
  if (words.length > 40) score -= 10;
  return score;
}

// The description beats a label, and the complete line beats a fragment of the same caption.
export function betterCaption(localText, cloudText) {
  const local = String(localText || "").replace(/\s+/g, " ").trim();
  const cloud = String(cloudText || "").replace(/\s+/g, " ").trim();
  if (!local) return cloud;
  if (!cloud) return local;
  const localScore = captionScore(local);
  const cloudScore = captionScore(cloud);
  if (localScore === cloudScore) return local.length >= cloud.length ? local : cloud;
  return localScore > cloudScore ? local : cloud;
}

function clampConf(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function idFactory(blocks) {
  const used = new Set(Object.keys(blocks));
  return (prefix) => {
    let n = 1;
    while (used.has(`${prefix}${n}`)) n += 1;
    const id = `${prefix}${n}`;
    used.add(id);
    return id;
  };
}

function insertAfter(order, id, extra) {
  const at = order.indexOf(id);
  if (at < 0) return order.concat(extra);
  return order.slice(0, at + 1).concat(extra, order.slice(at + 1));
}

function insertOnPage(order, blocks, page, extra) {
  let at = -1;
  for (let i = 0; i < order.length; i += 1) {
    if (blocks[order[i]]?.page === page) at = i;
  }
  if (at < 0) return order.concat(extra);
  return order.slice(0, at + 1).concat(extra, order.slice(at + 1));
}

function dropFigure(blocks, order, id) {
  const fig = blocks[id];
  if (!fig) return order;
  const capId = fig.caption;
  delete blocks[id];
  let next = order.filter((item) => item !== id);
  if (capId && blocks[capId]?.for === id && !Object.values(blocks).some((block) => block && block.caption === capId)) {
    delete blocks[capId];
    next = next.filter((item) => item !== capId);
  }
  return next;
}

function matchFigures(cloudFigs, localFigs) {
  const pairs = new Map();
  const used = new Set();
  const open = new Set(cloudFigs);
  for (;;) {
    let best = null;
    for (const cloud of open) {
      for (const local of localFigs) {
        if (used.has(local)) continue;
        const score = iou(cloud.bbox, local.bbox);
        if (score >= IOU_MATCH && (!best || score > best.score)) best = { cloud, local, score };
      }
    }
    if (!best) break;
    pairs.set(best.cloud, best.local);
    open.delete(best.cloud);
    used.add(best.local);
  }
  return { pairs, used };
}

function pageByN(doc, n) {
  for (const page of doc?.pages || []) if (page?.n === n) return page;
  return null;
}

// Figure detection ran for this local page. An OCR read covers a page listed in
// `doc.ocr.pages` or stamped `page.ocr`. A built-in parse also detects figures
// on born-digital text and mixed pages. A scan page of a plain built-in parse does not.
function figureDetectionRan(localDoc, pageN) {
  const page = pageByN(localDoc, pageN);
  if (localDoc?.ocr && (ocrPageListed(localDoc, pageN) || page?.ocr)) return true;
  const kind = page?.kind;
  return kind === "text" || kind === "mixed";
}

function ocrPageListed(doc, n) {
  const pages = doc?.ocr?.pages;
  return Array.isArray(pages) && pages.includes(n);
}

function isOcrRead(doc) {
  if (!doc) return false;
  const mode = doc.options?.ocr;
  if (mode && mode !== "none") return true;
  if (doc.ocr?.pages?.length) return true;
  if (doc.ocr?.source) return true;
  return (doc.pages || []).some((page) => page?.ocr);
}

function localTier(row) {
  const doc = row?.doc;
  if (!doc) return -1;
  const engine = row.engine || doc.engine;
  if (engine === "cloud" || doc.engine === "cloud") return -1;
  if (doc.ocr?.source === "helper") return 3;
  if (isOcrRead(doc)) return 2;
  if (engine === "builtin") return 1;
  return -1;
}

// Helper OCR, else an in-browser (or unstamped) OCR read, else the built-in parse.
// Newest `at` wins inside a tier. Cloud rows are ignored.
export function bestLocalDoc(rows) {
  let best = null;
  let tier = -1;
  let at = -Infinity;
  for (const row of rows || []) {
    const rank = localTier(row);
    if (rank < 0) continue;
    const when = Number(row.at);
    const stamp = Number.isFinite(when) ? when : 0;
    if (rank > tier || (rank === tier && stamp >= at)) {
      best = row.doc;
      tier = rank;
      at = stamp;
    }
  }
  return best;
}

export async function localParseForCloud(store, sha, current) {
  let rows = [];
  try {
    if (sha && typeof store?.listParses === "function") rows = (await store.listParses(sha)) || [];
  } catch { rows = []; }
  if (current && current.engine !== "cloud") {
    rows = rows.concat([{ engine: current.engine || "builtin", doc: current, at: Number.MAX_SAFE_INTEGER }]);
  }
  return bestLocalDoc(rows);
}

export function mergeCloudFigures(cloudDoc, localDoc) {
  if (!cloudDoc || typeof cloudDoc !== "object") return cloudDoc;
  if (!localDoc || typeof localDoc !== "object" || (!localDoc.blocks && !localDoc.order)) return cloudDoc;
  const blocks = {};
  for (const [id, block] of Object.entries(cloudDoc.blocks || {})) {
    blocks[id] = block?.image ? { ...block, image: { ...block.image } } : { ...block };
  }
  let order = [...(cloudDoc.order || [])];
  const nextId = idFactory(blocks);

  for (const [cloudPage, localPage] of pagePairs(cloudDoc, localDoc)) {
    const cloudFigs = order.map((id) => blocks[id]).filter((block) => block?.type === "figure" && block.page === cloudPage);
    const localFigs = blocksOf(localDoc, localPage, "figure").filter((block) => !emptyBox(block.bbox));
    const { pairs, used } = matchFigures(cloudFigs, localFigs);
    for (const [cloud, local] of pairs) {
      cloud.bbox = local.bbox.slice();
      cloud.source = "hybrid";
      const localCap = captionBlock(localDoc, local);
      const localText = captionText(localCap);
      const cloudText = cloud.caption && blocks[cloud.caption] ? captionText(blocks[cloud.caption]) : "";
      const text = betterCaption(localText, cloudText);
      if (!text) continue;
      const useLocal = text === localText && localText !== "";
      if (cloud.caption && blocks[cloud.caption]) {
        if (useLocal) {
          blocks[cloud.caption] = {
            ...blocks[cloud.caption],
            text,
            bbox: localCap.bbox || blocks[cloud.caption].bbox,
          };
        }
      } else {
        const id = nextId("c");
        blocks[id] = {
          id,
          type: "caption",
          page: cloud.page,
          bbox: localCap.bbox || cloud.bbox,
          text,
          for: cloud.id,
          confidence: clampConf(localCap.confidence, cloud.confidence ?? 0.9),
          engine: "cloud",
        };
        cloud.caption = id;
        order = insertAfter(order, cloud.id, [id]);
      }
    }
    const added = [];
    for (const local of localFigs) {
      if (used.has(local)) continue;
      const id = nextId("f");
      const localCap = captionBlock(localDoc, local);
      const text = captionText(localCap);
      const figure = {
        id,
        type: "figure",
        page: cloudPage,
        bbox: local.bbox.slice(),
        caption: null,
        image: local.image ? { ...local.image } : { kind: "crop", source: "local" },
        confidence: clampConf(local.confidence, 0.9),
        engine: "cloud",
        source: "local",
      };
      blocks[id] = figure;
      added.push(id);
      if (text) {
        const capId = nextId("c");
        blocks[capId] = {
          id: capId,
          type: "caption",
          page: cloudPage,
          bbox: localCap.bbox || figure.bbox,
          text,
          for: id,
          confidence: clampConf(localCap.confidence, figure.confidence),
          engine: "cloud",
        };
        figure.caption = capId;
        added.push(capId);
      }
    }
    if (added.length) order = insertOnPage(order, blocks, cloudPage, added);
    if (figureDetectionRan(localDoc, localPage)) {
      for (const cloud of cloudFigs) {
        if (pairs.has(cloud)) continue;
        order = dropFigure(blocks, order, cloud.id);
      }
    }
  }

  for (const id of order) {
    const fig = blocks[id];
    if (fig?.type === "figure" && !fig.source) fig.source = "llamaparse";
  }

  const tables = Object.values(blocks).filter((block) => block?.type === "table");
  for (const id of [...order]) {
    const fig = blocks[id];
    if (fig?.type !== "figure" || fig.source !== "llamaparse" || !fig.image?.layout) continue;
    if (!tables.some((table) => table.page === fig.page && onTable(fig.bbox, table.bbox))) continue;
    order = dropFigure(blocks, order, id);
  }

  const doc = { ...cloudDoc, blocks, order };
  const check = validateParse(doc);
  if (!check.ok) {
    const error = new Error(`cloud merge schema: ${check.errors.join(",")}`);
    error.code = "schema";
    error.errors = check.errors;
    throw error;
  }
  return doc;
}
