import { itemSig } from "./boardsnap.js";
import { itemLabel, plainText } from "./schema.js";

// One card's searchable text. Block-ref text comes from `resolve` (the idle build
// calls it once and caches; a keystroke must not).
function hayOf(item, resolve) {
  const bits = [item?.title, plainText(item?.string, 2000)];
  if (item?.kind === "block" && item.target?.uid) {
    let text = null;
    try { text = typeof resolve === "function" ? resolve(item.target.uid) : null; } catch { text = null; }
    if (typeof text === "string") bits.push(plainText(text, 2000));
  }
  if (item?.kind === "image") bits.push(itemLabel(item));
  const kids = Array.isArray(item?.content) ? item.content : [];
  for (const kid of kids) bits.push(plainText(kid?.[":block/string"] ?? kid?.string ?? "", 500));
  return bits.filter(Boolean).join("\n").toLowerCase();
}

function edgeText(edge) {
  return `${edge?.label || ""}\n${plainText(edge?.string, 500)}`.toLowerCase();
}

function edgeSig(edge) {
  return `${edge?.uid ?? ""}|${edge?.from ?? ""}|${edge?.to ?? ""}|${edge?.label ?? ""}|${edge?.string ?? ""}`;
}

// Hits on this board. `nested` is one level of child boards, each { parentUid, board }.
// A nested hit focuses the card on this board that holds that child.
export function findOnBoard(board, query, nested = [], resolve) {
  const q = String(query || "").trim().toLowerCase();
  if (!q || !board?.items) return [];
  const hits = [];
  for (const item of board.items.values()) {
    if (!hayOf(item, resolve).includes(q)) continue;
    hits.push({ uid: item.uid, focus: item.uid, kind: item.type === "section" ? "section" : "card" });
  }
  for (const edge of board.edges?.values?.() || []) {
    const label = edgeText(edge);
    if (!label.includes(q)) continue;
    hits.push({ uid: edge.uid, focus: edge.from, kind: "edge" });
  }
  for (const nest of nested || []) {
    if (!nest?.board || !nest.parentUid) continue;
    for (const hit of findOnBoard(nest.board, query, [], resolve)) {
      hits.push({ uid: hit.uid, focus: nest.parentUid, kind: "nested", via: nest.parentUid });
    }
  }
  return hits;
}

// The search field scans this cache. Slices stop at 8 ms. A keystroke never builds it.
export const HAY_SLICE_MS = 8;

const defaultNow = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

export function createHayIndex({ resolve, now = defaultNow, sliceMs = HAY_SLICE_MS } = {}) {
  const itemHay = new Map();
  const edgeHay = new Map();
  const nestHay = new Map();
  const refCache = new Map();
  const pending = new Set();
  let resolveCalls = 0;
  let hayBuilds = 0;
  let sliceCalls = 0;
  let lastSliceMs = 0;
  let lastSliceBuilds = 0;
  let boardRef = null;
  let nestList = [];
  let nestOrder = [];
  let phase = "need";
  let scanned = false;
  let cursor = 0;
  let ids = [];
  let seenItems = new Set();
  let seenEdges = new Set();
  let structuralPending = false;
  let nestCursor = 0;
  let nestStage = "start";
  let nestIds = [];
  let nestEdgeIds = [];
  let nestItemCursor = 0;
  let nestEdgeCursor = 0;
  let nestKeyBuf = "";
  let nestRows = [];
  let nestParent = "";

  function resolveOnce(uid) {
    if (refCache.has(uid)) return refCache.get(uid);
    resolveCalls += 1;
    let text = null;
    try { text = typeof resolve === "function" ? resolve(uid) : null; } catch { text = null; }
    const out = typeof text === "string" ? text : null;
    refCache.set(uid, out);
    return out;
  }

  function writeItem(item) {
    if (!item?.uid) return;
    pending.delete(item.uid);
    const sig = itemSig(item);
    const prev = itemHay.get(item.uid);
    if (prev && prev.sig === sig) return;
    hayBuilds += 1;
    itemHay.set(item.uid, { sig, hay: hayOf(item, resolveOnce) });
  }

  function writeEdge(edge) {
    if (!edge?.uid) return;
    pending.delete(edge.uid);
    const sig = edgeSig(edge);
    const prev = edgeHay.get(edge.uid);
    if (prev && prev.sig === sig) return;
    hayBuilds += 1;
    edgeHay.set(edge.uid, { sig, hay: edgeText(edge) });
  }

  function consider(uid) {
    pending.delete(uid);
    const item = boardRef?.items?.get?.(uid);
    if (item) { writeItem(item); return; }
    if (itemHay.has(uid)) itemHay.delete(uid);
    const edge = boardRef?.edges?.get?.(uid);
    if (edge) { writeEdge(edge); return; }
    if (edgeHay.has(uid)) edgeHay.delete(uid);
  }

  function addDirty(dirty) {
    if (!dirty || typeof dirty[Symbol.iterator] !== "function" || typeof dirty === "string") return;
    for (const uid of dirty) if (uid) pending.add(uid);
  }

  function sweepMembership() {
    const live = new Set(boardRef?.items?.keys?.() || []);
    for (const uid of [...itemHay.keys()]) if (!live.has(uid)) itemHay.delete(uid);
    for (const uid of live) if (!itemHay.has(uid)) pending.add(uid);
    const liveE = new Set(boardRef?.edges?.keys?.() || []);
    for (const uid of [...edgeHay.keys()]) if (!liveE.has(uid)) edgeHay.delete(uid);
    for (const uid of liveE) if (!edgeHay.has(uid)) pending.add(uid);
    structuralPending = false;
  }

  function resetNestWalk() {
    nestCursor = 0;
    nestStage = "start";
    nestIds = [];
    nestEdgeIds = [];
    nestItemCursor = 0;
    nestEdgeCursor = 0;
    nestKeyBuf = "";
    nestRows = [];
    nestParent = "";
  }

  function ready() {
    return scanned && phase === "done" && pending.size === 0 && !structuralPending;
  }

  function note(board, nested = []) {
    boardRef = board || null;
    nestList = Array.isArray(nested) ? nested : [];
    nestOrder = [];
    for (const nest of nestList) {
      if (nest?.parentUid && nest?.board?.items) nestOrder.push(nest.parentUid);
    }
    pending.clear();
    structuralPending = false;
    seenItems = new Set();
    seenEdges = new Set();
    cursor = 0;
    ids = boardRef?.items ? [...boardRef.items.keys()] : [];
    resetNestWalk();
    phase = boardRef?.items ? "items" : "done";
    scanned = phase === "done";
  }

  // A board change. One edited card is refreshed here; a structural change is sliced.
  function touch(board, dirty, structural = false) {
    if (board) boardRef = board;
    if (!boardRef?.items) return;
    addDirty(dirty);
    if (structural || !dirty) structuralPending = true;
    if (!scanned || phase !== "done") return;
    if (structuralPending || pending.size > 4) {
      phase = "rescan";
      return;
    }
    while (pending.size) {
      const uid = pending.values().next().value;
      consider(uid);
    }
    phase = "done";
  }

  function advanceNest() {
    if (nestCursor >= nestList.length) {
      const live = new Set(nestOrder);
      for (const uid of [...nestHay.keys()]) if (!live.has(uid)) nestHay.delete(uid);
      phase = pending.size || structuralPending ? "rescan" : "done";
      return;
    }
    const nest = nestList[nestCursor];
    if (!nest?.board?.items || !nest.parentUid) {
      nestCursor += 1;
      nestStage = "start";
      return;
    }
    if (nestStage === "start") {
      nestParent = nest.parentUid;
      nestIds = [...nest.board.items.keys()];
      nestEdgeIds = [...(nest.board.edges?.keys?.() || [])];
      nestItemCursor = 0;
      nestEdgeCursor = 0;
      nestKeyBuf = "";
      nestRows = [];
      nestStage = "key-items";
      return;
    }
    if (nestStage === "key-items") {
      if (nestItemCursor < nestIds.length) {
        const item = nest.board.items.get(nestIds[nestItemCursor++]);
        if (item) nestKeyBuf += `${item.uid}:${itemSig(item)}\n`;
        return;
      }
      nestStage = "key-edges";
      return;
    }
    if (nestStage === "key-edges") {
      if (nestEdgeCursor < nestEdgeIds.length) {
        const edge = nest.board.edges.get(nestEdgeIds[nestEdgeCursor++]);
        if (edge) nestKeyBuf += `e:${edgeSig(edge)}\n`;
        return;
      }
      const prev = nestHay.get(nestParent);
      if (prev && prev.key === nestKeyBuf) {
        nestCursor += 1;
        nestStage = "start";
        return;
      }
      nestStage = "hay-items";
      nestItemCursor = 0;
      nestEdgeCursor = 0;
      return;
    }
    if (nestStage === "hay-items") {
      if (nestItemCursor < nestIds.length) {
        const item = nest.board.items.get(nestIds[nestItemCursor++]);
        if (item) {
          hayBuilds += 1;
          nestRows.push({ uid: item.uid, hay: hayOf(item, resolveOnce) });
        }
        return;
      }
      nestStage = "hay-edges";
      return;
    }
    if (nestStage === "hay-edges") {
      if (nestEdgeCursor < nestEdgeIds.length) {
        const edge = nest.board.edges.get(nestEdgeIds[nestEdgeCursor++]);
        if (edge) {
          hayBuilds += 1;
          nestRows.push({ uid: edge.uid, hay: edgeText(edge) });
        }
        return;
      }
      nestHay.set(nestParent, { key: nestKeyBuf, rows: nestRows });
      nestCursor += 1;
      nestStage = "start";
    }
  }

  function step(deadline) {
    sliceCalls += 1;
    if (!boardRef) return false;
    if (!boardRef.items) {
      phase = "done";
      scanned = true;
      lastSliceBuilds = 0;
      lastSliceMs = 0;
      return true;
    }
    if (ready()) return true;
    let starved = false;
    if (typeof deadline?.timeRemaining === "function") {
      try { starved = deadline.timeRemaining() <= 0; } catch { starved = false; }
    }
    const t0 = now();
    let checks = 0;
    const before = hayBuilds;
    const over = () => {
      checks += 1;
      lastSliceMs = now() - t0;
      if (starved && checks >= 1) return true;
      return lastSliceMs >= sliceMs;
    };
    let spins = 0;
    while (phase !== "done") {
      if (++spins > 100000) break;
      if (over()) {
        lastSliceBuilds = hayBuilds - before;
        return false;
      }
      if (phase === "items") {
        if (cursor >= ids.length) { phase = "item-drop"; continue; }
        const uid = ids[cursor++];
        const item = boardRef.items.get(uid);
        if (!item) continue;
        seenItems.add(uid);
        writeItem(item);
        continue;
      }
      if (phase === "item-drop") {
        for (const uid of [...itemHay.keys()]) if (!seenItems.has(uid)) itemHay.delete(uid);
        phase = "edges";
        cursor = 0;
        ids = [...(boardRef.edges?.keys?.() || [])];
        seenEdges = new Set();
        continue;
      }
      if (phase === "edges") {
        if (cursor >= ids.length) { phase = "edge-drop"; continue; }
        const uid = ids[cursor++];
        const edge = boardRef.edges?.get?.(uid);
        if (!edge) continue;
        seenEdges.add(uid);
        writeEdge(edge);
        continue;
      }
      if (phase === "edge-drop") {
        for (const uid of [...edgeHay.keys()]) if (!seenEdges.has(uid)) edgeHay.delete(uid);
        phase = "nests";
        resetNestWalk();
        continue;
      }
      if (phase === "nests") {
        advanceNest();
        continue;
      }
      if (phase === "rescan") {
        if (structuralPending) sweepMembership();
        if (!pending.size && !structuralPending) { phase = "done"; continue; }
        const uid = pending.values().next().value;
        if (uid == null) { phase = "done"; continue; }
        consider(uid);
        continue;
      }
      phase = "done";
    }
    if (phase === "done") scanned = true;
    lastSliceBuilds = hayBuilds - before;
    if (!lastSliceMs) lastSliceMs = now() - t0;
    return ready();
  }

  function find(board, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q || !board?.items) return [];
    const hits = [];
    for (const item of board.items.values()) {
      const row = itemHay.get(item.uid);
      if (!row || !row.hay.includes(q)) continue;
      hits.push({ uid: item.uid, focus: item.uid, kind: item.type === "section" ? "section" : "card" });
    }
    for (const edge of board.edges?.values?.() || []) {
      const row = edgeHay.get(edge.uid);
      if (!row || !row.hay.includes(q)) continue;
      hits.push({ uid: edge.uid, focus: edge.from, kind: "edge" });
    }
    for (const parentUid of nestOrder) {
      const pack = nestHay.get(parentUid);
      if (!pack) continue;
      for (const row of pack.rows) {
        if (!row.hay.includes(q)) continue;
        hits.push({ uid: row.uid, focus: parentUid, kind: "nested", via: parentUid });
      }
    }
    return hits;
  }

  return {
    note,
    touch,
    step,
    find,
    ready,
    blockText: resolveOnce,
    stats() {
      return { hayBuilds, resolveCalls, sliceCalls, lastSliceMs, lastSliceBuilds, ready: ready() };
    },
  };
}

// Idle slices on the shared budget. `partMs` is huge so the budget runs one slice per callback.
export function scheduleHayIndex(index, { budget = null, onReady = null } = {}) {
  if (!index || typeof budget?.run !== "function") return () => {};
  let stopped = false;
  const cancel = budget.run((deadline) => {
    if (stopped) return true;
    const done = index.step(deadline) === true;
    if (done && !stopped && typeof onReady === "function") {
      try { onReady(); } catch { /* listener */ }
    }
    return done;
  }, { partMs: 1e6, label: "search-hay" });
  return () => {
    stopped = true;
    try { cancel?.(); } catch { /* gone */ }
  };
}
