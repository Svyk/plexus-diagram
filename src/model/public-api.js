// ECO-2. Frozen window.PlexusDiagram. Reads go through the host.
// addCard is the only write, and only after the ref and v2 checks.
// Thumbnail width is capped. It is never doubled the way rasterizeSvg doubles a canvas.

import { buildBoard } from "./board.js";
import { isShowableCard } from "./deeplink.js";
import { regionsOf as regionList } from "./regions.js";
import { parseBoardTitle, readPlexus } from "./schema.js";

export const API_VERSION = 1;
export const API_EVENTS = Object.freeze(["change", "mount", "unmount"]);

const EVENTS = new Set(API_EVENTS);
const emitters = new WeakMap();
const DEFAULT_AT = 40;
const DEFAULT_MAX_WIDTH = 160;
const THUMB_STROKE = "#5c7080";
const EMPTY_BOUNDS = { x: 0, y: 0, w: 160, h: 160 };
const DIAGRAM_RE = "^\\{\\{(\\[\\[)?diagram";
// Same shape as the show-on-board ref query. host.q / fast.q returns rows, not a wrapper.
const REF_QUERY = `[:find ?board ?page ?card :in $ ?uid ?pat :where
 [?target :block/uid ?uid] [?cardblock :block/refs ?target] [?cardblock :block/uid ?card]
 [?cardblock :block/parents ?diagram] [?diagram :block/uid ?board] [?diagram :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?diagram :block/page ?p] [?p :block/uid ?page]]`;

const BLOCK_REF = /^\(\(([\w-]+)\)\)$/;

function pullBlock(host, uid) {
  const fn = typeof host?.pullBoard === "function" ? host.pullBoard : host?.pull;
  if (typeof fn !== "function") return null;
  return fn.call(host, uid);
}

function boardVersion(pulled) {
  if (!pulled || typeof pulled !== "object") return undefined;
  if (pulled.plexus && typeof pulled.plexus === "object" && !Array.isArray(pulled.plexus) && "v" in pulled.plexus) {
    return pulled.plexus.v;
  }
  return readPlexus(pulled[":block/props"] ?? pulled.props)?.v;
}

function blockString(pulled) {
  if (!pulled || typeof pulled !== "object") return "";
  if (typeof pulled[":block/string"] === "string") return pulled[":block/string"];
  if (typeof pulled.string === "string") return pulled.string;
  return "";
}

function boardTitle(pulled) {
  return parseBoardTitle(blockString(pulled)) || "Untitled board";
}

// One [[Page]] or one ((uid)). Prose, empty, and a second ref are null.
export function parseAddRef(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const pages = s.match(/\[\[/g)?.length ?? 0;
  const blocks = s.match(/\(\(/g)?.length ?? 0;
  if (pages + blocks !== 1) return null;
  if (BLOCK_REF.test(s)) return s;
  if (pages !== 1 || !s.startsWith("[[") || !s.endsWith("]]")) return null;
  const title = s.slice(2, -2).trim();
  if (!title || title.includes("[[") || title.includes("]]")) return null;
  return s;
}

// The ref may sit in a child bullet or a Connections block. The card is the board child that holds it.
// Undefined when that child is not a placed card (an edge, a section). Unchanged when the tree does not hold the uid.
function cardFor(pulled, uid) {
  const kids = (node) => (Array.isArray(node?.[":block/children"]) ? node[":block/children"] : []);
  const holds = (node) => node?.[":block/uid"] === uid || kids(node).some(holds);
  for (const top of kids(pulled)) {
    if (!holds(top)) continue;
    return isShowableCard(readPlexus(top[":block/props"])) ? top[":block/uid"] : undefined;
  }
  return uid;
}

// rows are [boardUid, pageUid, cardUid]. card is row[2]. row[1] is the page and is never the card.
// A repeated board keeps the card from its first row. pull results stay only when plexus.v is 2.
export function boardsFromRefRows(rows, pull) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    const boardUid = Array.isArray(row) ? row[0] : null;
    if (!boardUid || seen.has(boardUid)) continue;
    seen.add(boardUid);
    let card = typeof row[2] === "string" && row[2] ? row[2] : undefined;
    let pulled = null;
    try {
      pulled = typeof pull === "function" ? pull(boardUid) : null;
    } catch {
      pulled = null;
    }
    if (boardVersion(pulled) !== 2) continue;
    if (card !== undefined) card = cardFor(pulled, card);
    const item = { uid: boardUid, title: boardTitle(pulled) };
    if (card !== undefined) item.card = card;
    out.push(item);
  }
  return out;
}

// Width is at most maxWidth. A zero side is null. Never scale by 2.
export function fitThumbSize(naturalW, naturalH, maxWidth) {
  const w = Number(naturalW);
  const h = Number(naturalH);
  const max = Number(maxWidth);
  if (!(w > 0) || !(h > 0) || !(max > 0)) return null;
  const width = Math.min(w, max);
  return { width, height: h * (width / w) };
}

export function thumbStroke(color) {
  if (typeof color !== "string") return THUMB_STROKE;
  const s = color.trim();
  if (!s || s.toLowerCase() === "currentcolor") return THUMB_STROKE;
  return s;
}

export function boardBounds(rects) {
  const empty = { x: EMPTY_BOUNDS.x, y: EMPTY_BOUNDS.y, w: EMPTY_BOUNDS.w, h: EMPTY_BOUNDS.h };
  if (!Array.isArray(rects) || rects.length === 0) return empty;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  let n = 0;
  for (const rect of rects) {
    if (!rect) continue;
    const x = Number(rect.x);
    const y = Number(rect.y);
    const w = Number(rect.w);
    const h = Number(rect.h);
    if (![x, y, w, h].every(Number.isFinite)) continue;
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x + w);
    y2 = Math.max(y2, y + h);
    n += 1;
  }
  if (!n) return empty;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function fire(win, type, detail, Ctor) {
  try {
    const C = Ctor ?? win.CustomEvent ?? globalThis.CustomEvent;
    if (typeof win.dispatchEvent !== "function" || typeof C !== "function") return;
    win.dispatchEvent(new C(type, { detail }));
  } catch {
    // A missing CustomEvent must not block install or unload.
  }
}

export function createPublicApi({ host, version, addCard: addCardFn, openBoard, thumbnail: thumbnailFn, tablesFromPdf: tablesFn, capabilities: capList } = {}) {
  const capabilities = Object.freeze(Array.isArray(capList) ? capList.map(String) : []);
  const buckets = new Map();

  function emit(type, detail) {
    const bag = buckets.get(type);
    if (!bag) return;
    for (const cb of [...bag]) {
      try {
        cb(detail);
      } catch {
        // Listener throws stay inside the listener.
      }
    }
  }

  const api = {
    apiVersion: API_VERSION,
    version: String(version ?? ""),
    capabilities,
    isAvailable() {
      try {
        const name = host?.graphName?.();
        return typeof name === "string" && name.length > 0;
      } catch {
        return false;
      }
    },
    boardsOn(pageUid) {
      let listed = [];
      try {
        const rows = host?.listBoards?.();
        listed = Array.isArray(rows) ? rows : [];
      } catch {
        listed = [];
      }
      return listed
        .filter((row) => row && row.pageUid === pageUid)
        .map((row) => ({ uid: row.uid, title: row.title || "Untitled board" }));
    },
    boardsWith(targetUid) {
      let rows = [];
      try {
        const found = host?.q?.(REF_QUERY, targetUid, DIAGRAM_RE);
        rows = Array.isArray(found) ? found : [];
      } catch {
        return [];
      }
      return boardsFromRefRows(rows, (uid) => pullBlock(host, uid));
    },
    cardsOf(boardUid) {
      const board = buildBoard(pullBlock(host, boardUid));
      if (!board?.items) return [];
      const out = [];
      for (const item of board.items.values()) {
        if (item?.type !== "card") continue;
        out.push({
          uid: item.uid,
          kind: item.kind,
          title: item.title ?? "",
          rect: { x: item.x, y: item.y, w: item.w, h: item.h },
          parent: item.parentUid ?? null,
        });
      }
      return out;
    },
    regionsOf(ownerUid) {
      let regions = [];
      try {
        regions = regionList(pullBlock(host, ownerUid)) || [];
      } catch {
        regions = [];
      }
      return regions.map((region) => ({
        uid: region.uid,
        kind: region.kind,
        caption: region.caption ?? "",
      }));
    },
    viewsOf(boardUid) {
      const board = buildBoard(pullBlock(host, boardUid));
      return board?.views ?? [];
    },
    thumbnail(boardUid, opts) {
      const maxWidth = Number.isFinite(opts?.maxWidth) && opts.maxWidth > 0 ? opts.maxWidth : DEFAULT_MAX_WIDTH;
      const next = { ...(opts && typeof opts === "object" ? opts : {}), maxWidth };
      if (typeof thumbnailFn !== "function") return undefined;
      return thumbnailFn(boardUid, next);
    },
    open(boardUid, opts) {
      if (typeof openBoard !== "function") return undefined;
      return openBoard(boardUid, opts);
    },
    async addCard(boardUid, opts) {
      const string = parseAddRef(opts?.ref);
      if (!string) throw new Error("Bad ref");
      let pulled = null;
      try {
        pulled = pullBlock(host, boardUid);
      } catch {
        pulled = null;
      }
      if (boardVersion(pulled) !== 2) throw new Error("Not a board");
      const at = opts?.at;
      const x = Number.isFinite(at?.x) ? at.x : DEFAULT_AT;
      const y = Number.isFinite(at?.y) ? at.y : DEFAULT_AT;
      const made = await addCardFn(boardUid, string, x, y);
      const uid = made && typeof made === "object" ? made.uid : made;
      emit("change", { boardUid, uid });
      return { uid };
    },
    async tablesFromPdf(opts) {
      if (typeof tablesFn !== "function") throw new Error("PDF tables are not available");
      return tablesFn(opts && typeof opts === "object" ? opts : {});
    },
    addEventListener(type, cb) {
      if (!EVENTS.has(type) || typeof cb !== "function") return;
      let bag = buckets.get(type);
      if (!bag) {
        bag = new Set();
        buckets.set(type, bag);
      }
      bag.add(cb);
    },
    removeEventListener(type, cb) {
      buckets.get(type)?.delete(cb);
    },
    spec() {
      return {
        apiVersion: API_VERSION,
        events: [...API_EVENTS],
        capabilities: [...capabilities],
        methods: Object.keys(api).filter((key) => typeof api[key] === "function").sort(),
      };
    },
    help() {
      return "PlexusDiagram apiVersion 1. Listeners: change, mount, unmount. spec() lists the methods.";
    },
  };
  const frozen = Object.freeze(api);
  emitters.set(frozen, emit);
  return frozen;
}

// The host fires mount, unmount and change through this. The frozen api has no emit method of its own.
export function emitPublicEvent(api, type, detail) {
  if (!EVENTS.has(type)) return;
  emitters.get(api)?.(type, detail);
}

export function installPublicApi(api, { win = globalThis.window ?? globalThis, CustomEventCtor } = {}) {
  const target = win ?? globalThis;
  if (target.PlexusDiagram != null && target.PlexusDiagram !== api) return false;
  target.PlexusDiagram = api;
  fire(target, "plexus-diagram:ready", { apiVersion: API_VERSION }, CustomEventCtor);
  return true;
}

// Delete the global only when it is still this object. Always fire unload.
export function uninstallPublicApi(api, { win = globalThis.window ?? globalThis, CustomEventCtor } = {}) {
  const target = win ?? globalThis;
  let ours = false;
  try {
    ours = target.PlexusDiagram === api;
    if (ours) delete target.PlexusDiagram;
  } catch {
    ours = false;
  }
  fire(target, "plexus-diagram:unload", { apiVersion: API_VERSION }, CustomEventCtor);
  return ours;
}
