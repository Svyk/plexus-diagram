// Pointer / keyboard state machine for the board (spec 3.3). No DOM: the view normalizes
// events into { type, screen, world, target, ... } and this controller calls `actions`.
//
// actions (all optional unless noted):
//   board() rects() viewport() size()                      — model + view state (required)
//   setViewport(vp) fitAll() fitSelection(uids)
//   onSelection({ items, edge, link }) onTool(tool, locked) onHover(uid|null)
//   setGesturing(bool) showMarquee(rect|null, kind) showLasso(points|null) showGuides(list) previewMove(uids, dx, dy)
//   previewRects(list) showTempWire({ from, fromSide, point }|null)
//   commitMove(uids, dx, dy) commitRects(list) createCard({x,y}) createText({x,y})
//   createSection({rect}) wrapInSection(uids) deleteItems(uids, opts) deleteEdges(uids)
//   createBoard({rect}) moveIntoBoard(uids, boardUid, dx, dy) openBoard(uid) popBoard() → true when it went up a level
//   historyBack() historyForward() — Cmd/Ctrl+[ and Cmd/Ctrl+] through boards opened in place
//   addEdge({from,to,fromSide,toSide}) undo() redo()
//   enterEdit(uid) exitEdit() isEditing() editingUid() autocompleteOpen()
//   renameSection(uid) editLabel(edgeUid) openBlock(uid)
//   toast({message, action}) openSearch() cycleLinks() isFullscreen() setFullscreen(bool)
//   setSpace(bool)
//
// 1.2 actions (all optional):
//   openMenu({ kind, uid, screen, world, selection })      — right-click; kind is 'canvas'|'card'|'section'|'text'|
//                                                            'edge'|'link'|'multi' (board cards are 'card'); uid is null
//                                                            for 'canvas'; selection is the item uid list after the hit
//   showGhosts([{x,y,w,h}]|null)                           — alt-drag duplicate preview (originals stay put); null clears
//   duplicateItems(uids, { dx, dy, asRef })                — Alt-drag drop (asRef when Shift was held) and Cmd/Ctrl+D (24, 24, false)
//   cancelPreview()                                        — every gesture end/cancel: reset grown-section previews
//   foldSelection()  toggleFocus()  quickLook()  present()  expandOutline(uid)   — Cmd/Ctrl+Alt+Enter, F, Q, P, M
//   presentActive() presentNext() presentPrev()            — presentation state / paging keys
//   closeOverlay() overlayEscapeRecent()                   — Gallery/Timeline/Graph close; true for 600ms after an overlay, search or popover closed
//   closeQuickLook() exitPresent() exitFocus()             — each returns true when it closed something (Escape chain)
//   fitHeight(uid)  fitSection(uid)  resetSize(uids)       — double-click on a bottom / corner grip (a section fits its contents)
// Keydown events may carry tabOwned:false (focus is not on the board itself); Tab is then left to Roam and the browser.
// Escape order: gesture, quick look, presentation, edit, focus, selection, popBoard, fullscreen.

import { DEFAULT_BOARD_CARD, DEFAULT_SIZES, MIN_SIZES, STICKY_SIZE } from "../model/schema.js";
import { descendantsOf, findEdge, hitTest, itemsInPolygon, itemsInRect, outlineOrder, topLevelOf, boundsOf } from "../model/board.js";
import { GRID_PITCH, nearestInDirection, nearestSide, snapMove, snapToGrid, zoomAt } from "../model/geometry.js";
import { SHORTCUTS, findShortcut } from "./shortcuts.js";

export const TOOL_KEYS = Object.fromEntries(SHORTCUTS.filter((row) => row.letter).map((row) => [row.letter, row.tool]));
export const TOOLS = ["select", "hand", "card", "text", "sticky", "shape", "section", "board", "connect"];
const SHAPE_PLACE = { w: 160, h: 100 };
export const DRAG_THRESHOLD_PX = 4;
export const SNAP_PX = 6;
const STICKY_TOOLS = new Set(["select", "hand"]);

function normRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function createInteractions({ actions, settings } = {}) {
  const a = actions || {};
  const call = (name, ...args) => (typeof a[name] === "function" ? a[name](...args) : undefined);
  const setting = (key, def) => {
    const v = typeof settings?.get === "function" ? settings.get(key) : settings?.[key];
    return v === undefined || v === null ? def : v;
  };

  const state = {
    tool: "select",
    locked: false,
    selection: new Set(),
    edge: null,
    link: null,
    gesture: null,
    space: false,
    hover: null,
  };

  const board = () => call("board");
  const rects = () => call("rects");
  const hitRects = () => call("hitRects") || rects();
  const vp = () => call("viewport") || { x: 0, y: 0, zoom: 1 };
  const zoom = () => vp().zoom || 1;

  const emitSelection = () => {
    call("onSelection", { items: [...state.selection], edge: state.edge, link: state.link });
  };
  const selectItems = (uids) => {
    state.selection = new Set(uids);
    state.edge = null;
    state.link = null;
    emitSelection();
  };
  const selectEdge = (uid) => {
    state.selection = new Set();
    state.edge = uid;
    state.link = null;
    emitSelection();
  };
  const selectLink = (key) => {
    state.selection = new Set();
    state.edge = null;
    state.link = key;
    emitSelection();
  };
  const clearSelection = () => {
    if (!state.selection.size && !state.edge && !state.link) return false;
    selectItems([]);
    return true;
  };

  const setTool = (tool, lock = false) => {
    if (!TOOLS.includes(tool)) return;
    state.tool = tool;
    state.locked = Boolean(lock) && !STICKY_TOOLS.has(tool);
    call("onTool", state.tool, state.locked);
  };
  const afterToolUse = () => {
    if (!state.locked && !STICKY_TOOLS.has(state.tool)) setTool("select");
  };

  const begin = (g) => {
    state.gesture = { moved: false, ...g };
    call("setGesturing", true);
  };
  const end = () => {
    const moved = Boolean(state.gesture?.moved);
    state.gesture = null;
    call("showMarquee", null);
    call("showLasso", null);
    call("showGuides", []);
    call("showTempWire", null);
    call("onHover", null);
    call("clearBlockTarget");
    call("showGhosts", null);
    call("cancelPreview");
    call("setGesturing", false, { moved });
  };

  const isPinned = (uid) => Boolean(board()?.items.get(uid)?.pinned);
  // Pinned items never move; a duplicate (dup) may still start from them.
  const movingSet = (dup = false) => {
    const b = board();
    if (!b) return [];
    const uids = dup ? [...state.selection] : [...state.selection].filter((u) => !isPinned(u));
    return topLevelOf(b, uids);
  };
  const movingBounds = (uids) => {
    const r = rects();
    return boundsOf(uids.map((u) => r.get(u)).filter(Boolean));
  };
  const otherRects = (uids) => {
    const b = board();
    const r = rects();
    const skip = new Set(uids);
    for (const u of uids) for (const d of descendantsOf(b, u)) skip.add(d);
    const out = [];
    for (const uid of b.items.keys()) if (!skip.has(uid) && r.get(uid)) out.push(r.get(uid));
    return out;
  };

  const editingUid = () => call("editingUid") ?? null;
  const isEditing = () => Boolean(call("isEditing"));

  // BA-2: the page-card row (or title header) under the pointer lights up while an arrow end is dragged over it.
  // Returns the descriptor for the card the hit test chose, or null.
  const blockTargetFor = (ev, uid) => {
    const item = uid ? board()?.items.get(uid) : null;
    if (!item || item.kind !== "page") { call("clearBlockTarget"); return null; }
    const bt = call("blockTarget", ev.client || null);
    return bt && bt.uid === uid ? bt : null;
  };
  // An arrow already ending on this row of this card, if any (a re-drop on the same spot selects it).
  const sameEdge = (b, from, to, fromBlock, toBlock) => {
    for (const e of b.edges.values()) {
      if (e.from === from && e.to === to && (e.fromBlock ?? "") === (fromBlock ?? "") && (e.toBlock ?? "") === (toBlock ?? "")) return e;
    }
    return null;
  };

  const beginConnect = (uid, side, world) => {
    begin({ kind: "connect", from: uid, fromSide: side, start: world });
    call("showTempWire", { from: uid, fromSide: side, point: world });
  };

  // ------------------------------------------------------------------ pointer
  // A click on a page card's title opens the page after a short wait, so a double-click (rename) cancels it.
  let openTimer = null;
  const cancelOpen = () => { if (openTimer) { clearTimeout(openTimer); openTimer = null; } };
  const OPEN_DELAY_MS = 300;

  const onPointerDown = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return;
    cancelOpen();
    if (ev.button === 2) return;
    if (state.gesture) return;
    const editing = editingUid();
    if (editing) {
      if (t.kind === "item" && t.uid === editing && t.part !== "header") return; // editor owns the pointer
      if (!(t.kind === "item" && t.uid === editing)) call("exitEdit");
    }
    // RF-5: with the Hand tool a press on a resize grip resizes; Space and the middle button still pan over it.
    const handGrip = state.tool === "hand" && !state.space && ev.button === 0 && t.kind === "grip";
    const panRequested = ev.button === 1 || state.space || (state.tool === "hand" && !handGrip);
    if (panRequested) {
      begin({ kind: "pan", start: ev.screen, vp0: { ...vp() } });
      return;
    }
    if (ev.button !== 0) return;
    const b = board();
    const r = rects();
    switch (t.kind) {
      case "port":
        if (t.uid) beginConnect(t.uid, t.side || "right", ev.world);
        return;
      case "grip": {
        if (!t.uid || !r?.get(t.uid) || isPinned(t.uid)) return;
        if (!state.selection.has(t.uid)) selectItems([t.uid]);
        begin({ kind: "resize", uid: t.uid, part: t.part || "corner", start: ev.world, rect0: { ...r.get(t.uid) } });
        return;
      }
      case "edge-marker":
        if (t.uid) { selectEdge(t.uid); call("revealBlockEnd", t.uid, t.end); }
        return;
      case "edge-end": {
        const edge = t.uid ? b?.edges.get(t.uid) : null;
        if (!edge || (t.end !== "from" && t.end !== "to")) return;
        const other = t.end === "from" ? edge.to : edge.from;
        begin({ kind: "edge-end", edge: t.uid, end: t.end, other, start: ev.world });
        call("showTempWire", { from: other, fromSide: "auto", point: ev.world });
        return;
      }
      case "edge":
      case "label":
        if (t.uid) selectEdge(t.uid);
        return;
      case "link":
        if (t.key || t.uid) selectLink(t.key || t.uid);
        return;
      case "item":
      case "section-title":
      case "section-border": {
        if (!t.uid || !b?.items.has(t.uid)) return;
        if (state.tool === "connect") {
          beginConnect(t.uid, nearestSide(r.get(t.uid), ev.world), ev.world);
          return;
        }
        if (state.tool !== "select") break; // creation tools treat items as empty space
        let deferred = false;
        const dup = Boolean(ev.alt);
        // Cmd/Ctrl-click adds (React Flow multiSelectionKey). Shift-click does the same.
        // Alt+Shift stays duplicate-as-reference.
        const pageItem = b.items.get(t.uid)?.kind === "page";
        const kidKind = b.items.get(t.uid)?.kind;
        const rowItem = pageItem || ((kidKind === "note" || kidKind === "block") && Boolean(b.items.get(t.uid)?.kids));
        const pageHeader = pageItem && t.part === "header";
        const multi = !dup && (ev.meta || ev.ctrl || (ev.shift && !pageHeader));
        if (multi) {
          const next = new Set(state.selection);
          if (next.has(t.uid)) next.delete(t.uid); else next.add(t.uid);
          selectItems(next);
        } else if (!state.selection.has(t.uid)) {
          selectItems([t.uid]);
        } else if (state.selection.size > 1) {
          deferred = true; // click (no drag) on a multi-selected item narrows to it on up
        } else if (state.edge || state.link) {
          selectItems([t.uid]);
        }
        if (!state.selection.has(t.uid)) return;
        const uids = movingSet(dup);
        begin({ kind: "move", uids, dup, multi, asRef: dup && Boolean(ev.shift), start: ev.screen, target: t.uid, deferred, pageHeader, pageRow: rowItem && t.part === "body" ? (t.row || "") : "", bounds: movingBounds(uids), others: setting("snap-guides", true) ? otherRects(uids) : [] });
        return;
      }
      default:
        break;
    }
    // empty space (or an item under a creation tool)
    if (state.tool === "section") {
      begin({ kind: "section-draw", start: ev.world });
      return;
    }
    if (state.tool === "board") {
      begin({ kind: "board-draw", start: ev.world });
      return;
    }
    if (state.tool === "card" || state.tool === "text" || state.tool === "sticky" || state.tool === "shape") {
      begin({ kind: "place", tool: state.tool, start: ev.world });
      return;
    }
    // Alt on an item is duplicate. Alt on empty space, in the select tool, is the freeform lasso.
    if (state.tool === "select" && ev.alt) {
      begin({
        kind: "lasso",
        start: ev.world,
        points: [{ x: ev.world.x, y: ev.world.y }],
        base: ev.shift ? new Set(state.selection) : new Set(),
        shift: Boolean(ev.shift),
      });
      return;
    }
    begin({ kind: "marquee", start: ev.world, base: ev.shift ? new Set(state.selection) : new Set(), shift: ev.shift });
  };

  const onPointerMove = (ev) => {
    const g = state.gesture;
    if (!g) return;
    if (g.kind === "connect") {
      const b = board();
      const r = hitRects();
      call("showTempWire", { from: g.from, fromSide: g.fromSide, point: ev.world });
      const hit = b && r ? hitTest(b, ev.world, r, { sectionInterior: true }) : null;
      const hover = hit && hit.uid !== g.from ? hit.uid : null;
      if (hover !== state.hover) { state.hover = hover; call("onHover", hover); }
      if (!g.moved && Math.hypot(ev.world.x - g.start.x, ev.world.y - g.start.y) * zoom() >= DRAG_THRESHOLD_PX) g.moved = true;
      blockTargetFor(ev, hover);
      return;
    }
    if (g.kind === "edge-end") {
      const b = board();
      const r = hitRects();
      call("showTempWire", { from: g.other, fromSide: "auto", point: ev.world });
      const hit = b && r ? hitTest(b, ev.world, r, { sectionInterior: true }) : null;
      const hover = hit && hit.uid !== g.other ? hit.uid : null;
      if (hover !== state.hover) { state.hover = hover; call("onHover", hover); }
      if (!g.moved && Math.hypot(ev.world.x - g.start.x, ev.world.y - g.start.y) * zoom() >= DRAG_THRESHOLD_PX) g.moved = true;
      blockTargetFor(ev, hover);
      return;
    }
    const sdx = ev.screen.x - (g.start.x ?? 0);
    const sdy = ev.screen.y - (g.start.y ?? 0);
    if (g.kind === "pan") {
      if (!g.moved && Math.hypot(sdx, sdy) < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      call("setViewport", { x: g.vp0.x + sdx, y: g.vp0.y + sdy, zoom: g.vp0.zoom });
      return;
    }
    if (g.kind === "move") {
      if (!g.moved && Math.hypot(sdx, sdy) < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      const z = zoom();
      let dx = sdx / z;
      let dy = sdy / z;
      let guides = [];
      // Alt while the drag is moving turns both snaps off. Alt at pointer-down is still duplicate.
      if (!ev.alt && g.bounds) {
        const threshold = SNAP_PX / z;
        if (g.others.length) {
          const moving = { x: g.bounds.x + dx, y: g.bounds.y + dy, w: g.bounds.w, h: g.bounds.h };
          const snap = snapMove(moving, g.others, threshold);
          dx += snap.dx;
          dy += snap.dy;
          guides = snap.guides;
        }
        if (setting("snap-grid", false)) {
          const moving = { x: g.bounds.x + dx, y: g.bounds.y + dy, w: g.bounds.w, h: g.bounds.h };
          const grid = snapToGrid(moving, GRID_PITCH, threshold);
          if (!guides.some((line) => line.x1 === line.x2)) dx += grid.dx;
          if (!guides.some((line) => line.y1 === line.y2)) dy += grid.dy;
        }
      }
      g.dx = dx;
      g.dy = dy;
      if (g.dup) {
        const r0 = rects();
        call("showGhosts", g.uids.map((u) => r0?.get(u)).filter(Boolean).map((q) => ({ x: q.x + dx, y: q.y + dy, w: q.w, h: q.h })));
      } else if (g.uids.length) {
        call("previewMove", g.uids, dx, dy);
      }
      call("showGuides", guides);
      const b = board();
      const r = hitRects();
      if (b && r && !g.dup && g.uids.length) {
        if (!g.exclude) {
          g.exclude = new Set(g.uids);
          for (const u of g.uids) for (const d of descendantsOf(b, u)) g.exclude.add(d);
        }
        const hit = hitTest(b, ev.world, r, { exclude: g.exclude });
        const drop = hit?.part === "body" && (b.items.get(hit.uid)?.kind === "board" && b.items.get(hit.uid)?.enhanced) ? hit.uid : null;
        if (drop !== (g.drop ?? null)) { g.drop = drop; call("onHover", drop); }
      }
      return;
    }
    // world-space gestures
    const wdx = ev.world.x - g.start.x;
    const wdy = ev.world.y - g.start.y;
    if (!g.moved && Math.hypot(wdx, wdy) * zoom() < DRAG_THRESHOLD_PX) return;
    g.moved = true;
    if (g.kind === "lasso") {
      const last = g.points[g.points.length - 1];
      const dx = ev.world.x - last.x;
      const dy = ev.world.y - last.y;
      if (dx * dx + dy * dy >= 0.25) g.points.push({ x: ev.world.x, y: ev.world.y });
      call("showLasso", g.points);
      const b = board();
      const r = hitRects();
      if (b && r) {
        const hits = g.points.length >= 3 ? itemsInPolygon(b, g.points, r) : [];
        const next = new Set(g.base);
        hits.forEach((u) => next.add(u));
        state.selection = next;
        state.edge = null;
        state.link = null;
        emitSelection();
      }
      return;
    }
    if (g.kind === "marquee") {
      const rect = normRect(g.start, ev.world);
      g.rect = rect;
      call("showMarquee", rect, "select");
      const b = board();
      const r = hitRects();
      if (b && r) {
        const hits = itemsInRect(b, rect, r, { mode: "contain" });
        const next = new Set(g.base);
        hits.forEach((u) => next.add(u));
        state.selection = next;
        state.edge = null;
        state.link = null;
        emitSelection();
      }
      return;
    }
    if (g.kind === "section-draw" || g.kind === "board-draw") {
      g.rect = normRect(g.start, ev.world);
      call("showMarquee", g.rect, g.kind === "board-draw" ? "board" : "section");
      return;
    }
    if (g.kind === "resize") {
      const b = board();
      const item = b?.items.get(g.uid);
      if (!item) return;
      const min = MIN_SIZES[item.type] || MIN_SIZES.card;
      const r0 = g.rect0;
      const next = { uid: g.uid, x: r0.x, y: r0.y, w: r0.w, h: r0.h };
      if (g.part === "corner" || g.part === "right") next.w = Math.max(min.w, r0.w + wdx);
      if (g.part === "corner" || g.part === "bottom") next.h = Math.max(min.h, r0.h + wdy);
      g.rect = next;
      call("previewRects", [next]);
    }
  };

  const onPointerUp = (ev) => {
    const g = state.gesture;
    if (!g) return;
    const b = board();
    const r = rects();
    switch (g.kind) {
      case "pan":
        break;
      case "marquee":
      case "lasso":
        if (!g.moved && !g.shift) clearSelection();
        break;
      case "section-draw": {
        const d = DEFAULT_SIZES.section;
        const rect = g.moved && g.rect && g.rect.w >= MIN_SIZES.section.w && g.rect.h >= MIN_SIZES.section.h
          ? g.rect
          : { x: g.start.x - d.w / 2, y: g.start.y - d.h / 2, w: d.w, h: d.h };
        end();
        Promise.resolve(call("createSection", { rect })).then((uid) => { if (uid) selectItems([uid]); }).catch(() => {});
        afterToolUse();
        return;
      }
      case "board-draw": {
        const d = DEFAULT_BOARD_CARD;
        const rect = g.moved && g.rect && g.rect.w >= MIN_SIZES.card.w && g.rect.h >= MIN_SIZES.card.h
          ? g.rect
          : { x: g.start.x - d.w / 2, y: g.start.y - d.h / 2, w: d.w, h: d.h };
        end();
        Promise.resolve(call("createBoard", { rect })).then((uid) => { if (uid) selectItems([uid]); }).catch(() => {});
        afterToolUse();
        return;
      }
      case "place": {
        if (!g.moved) {
          let p;
          if (g.tool === "sticky") {
            p = call("createText", { x: g.start.x - STICKY_SIZE.w / 2, y: g.start.y - STICKY_SIZE.h / 2, w: STICKY_SIZE.w, h: STICKY_SIZE.h, look: "sticky" });
          } else if (g.tool === "shape") {
            p = call("createText", { x: g.start.x - SHAPE_PLACE.w / 2, y: g.start.y - SHAPE_PLACE.h / 2, w: SHAPE_PLACE.w, h: SHAPE_PLACE.h, shape: "rectangle" });
          } else {
            const d = DEFAULT_SIZES[g.tool];
            const at = { x: g.start.x - d.w / 2, y: g.start.y - d.h / 2 };
            p = g.tool === "text" ? call("createText", at) : call("createCard", at);
          }
          end();
          Promise.resolve(p).then((uid) => { if (uid) { selectItems([uid]); call("enterEdit", uid); } }).catch(() => {});
          afterToolUse();
          return;
        }
        break;
      }
      case "move":
        if (g.moved && g.dup) {
          call("duplicateItems", g.uids, { dx: g.dx || 0, dy: g.dy || 0, asRef: Boolean(g.asRef) });
        } else if (g.moved && g.drop) {
          call("moveIntoBoard", g.uids, g.drop, g.dx || 0, g.dy || 0);
        } else if (g.moved) {
          if (g.uids.length) call("commitMove", g.uids, g.dx || 0, g.dy || 0);
        } else if (g.deferred) {
          selectItems([g.target]);
        }
        if (!g.moved && !g.dup && !ev.alt && g.pageHeader && !ev.meta && !ev.ctrl && g.target) {
          // PG-2: click opens the page in the main window, Shift-click in the right sidebar.
          const sidebar = Boolean(ev.shift);
          const target = g.target;
          cancelOpen();
          openTimer = setTimeout(() => { openTimer = null; call("openPage", target, { sidebar }); }, OPEN_DELAY_MS);
        } else if (!g.moved && !g.dup && g.pageRow && !ev.shift && !ev.alt && !ev.meta && !ev.ctrl && editingUid() !== g.target) {
          // PG-3: a click on a page card row edits that block.
          call("enterEdit", g.target, { row: g.pageRow });
        }
        break;
      case "resize":
        if (g.moved && g.rect) call("commitRects", [g.rect]);
        break;
      case "edge-end": {
        const hr = hitRects();
        const hit = b && hr ? hitTest(b, ev.world, hr, { sectionInterior: true }) : null;
        const bt = hit && hit.uid !== g.other ? blockTargetFor(ev, hit.uid) : null;
        end();
        const edge = b?.edges.get(g.edge);
        if (g.moved && edge && hit && hit.uid !== g.other) {
          const key = g.end === "from" ? "from" : "to";
          const blockKey = g.end === "from" ? "fromBlock" : "toBlock";
          const nextBlock = bt?.row || undefined;
          const sameCard = hit.uid === edge[key];
          if (!sameCard || (edge[blockKey] ?? "") !== (nextBlock ?? "")) {
            const next = { from: edge.from, to: edge.to, fromBlock: edge.fromBlock, toBlock: edge.toBlock, [key]: hit.uid, [blockKey]: nextBlock };
            if (!sameEdge(b, next.from, next.to, next.fromBlock, next.toBlock)) {
              const patch = { [blockKey]: nextBlock };
              if (!sameCard) { patch[key] = hit.uid; patch[key === "from" ? "fromSide" : "toSide"] = nearestSide(hr.get(hit.uid), ev.world); }
              call("updateEdge", g.edge, patch);
            }
          }
        }
        afterToolUse();
        return;
      }
      case "connect": {
        const hr = hitRects();
        const hit = b && hr ? hitTest(b, ev.world, hr, { sectionInterior: true }) : null;
        const bt = hit && hit.uid !== g.from ? blockTargetFor(ev, hit.uid) : null;
        end();
        if (hit && hit.uid === g.from) {
          selectItems([g.from]);
        } else if (hit) {
          const toBlock = bt?.row || undefined;
          const existing = sameEdge(b, g.from, hit.uid, undefined, toBlock);
          if (existing) {
            selectEdge(existing.uid);
          } else {
            const toSide = nearestSide(hr.get(hit.uid), ev.world);
            Promise.resolve(call("addEdge", { from: g.from, to: hit.uid, fromSide: g.fromSide, toSide, ...(toBlock ? { toBlock } : {}) }))
              .then((uid) => { if (uid) selectEdge(uid); }).catch(() => {});
          }
        } else if (g.moved) {
          const d = DEFAULT_SIZES.card;
          const at = { x: ev.world.x, y: ev.world.y - d.h / 2 };
          Promise.resolve(call("createCard", at)).then(async (uid) => {
            if (!uid) return;
            await call("addEdge", { from: g.from, to: uid, fromSide: g.fromSide, toSide: "auto" });
            selectItems([uid]);
            call("enterEdit", uid);
          }).catch(() => {});
        }
        afterToolUse();
        return;
      }
      default:
        break;
    }
    end();
  };

  const onPointerCancel = () => {
    if (!state.gesture) return;
    const g = state.gesture;
    if (g.kind === "move" && !g.dup && g.uids.length) call("previewMove", g.uids, 0, 0);
    if (g.kind === "resize") call("previewRects", []);
    end();
  };

  const onDblClick = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return;
    cancelOpen();
    const b = board();
    if (t.kind === "item" && t.uid) {
      const item = b?.items.get(t.uid);
      if (!item) return;
      if (item.kind === "page" && t.part === "header") { selectItems([t.uid]); call("renamePage", t.uid); return; }
      if (item.kind === "board" || call("isBoardCard", t.uid)) call("openBoard", t.uid);
      else if (editingUid() !== t.uid) { selectItems([t.uid]); call("enterEdit", t.uid); }
      return;
    }
    if (t.kind === "grip") {
      if (t.uid && b?.items.has(t.uid) && !isPinned(t.uid)) {
        if (t.part === "bottom") call(b.items.get(t.uid).type === "section" ? "fitSection" : "fitHeight", t.uid);
        else if (t.part === "corner" || !t.part) call("resetSize", [t.uid]);
      }
      return;
    }
    // The bottom connection port sits on the middle of the bottom grip, so the natural double-click target
    // (the middle of the bottom edge) lands on it: it means the same as the grip beside it.
    if (t.kind === "port" && t.side === "bottom") {
      if (t.uid && b?.items.has(t.uid) && !isPinned(t.uid)) call(b.items.get(t.uid).type === "section" ? "fitSection" : "fitHeight", t.uid);
      return;
    }
    if (t.kind === "section-title" && t.uid) { selectItems([t.uid]); call("renameSection", t.uid); return; }
    if ((t.kind === "label" || t.kind === "edge") && t.uid) { selectEdge(t.uid); call("editLabel", t.uid); return; }
    if (t.kind === "section-border" || t.kind === "port" || t.kind === "link") return;
    if (state.tool !== "select") return;
    const d = DEFAULT_SIZES.card;
    Promise.resolve(call("createCard", { x: ev.world.x - d.w / 2, y: ev.world.y - d.h / 2 }))
      .then((uid) => { if (uid) { selectItems([uid]); call("enterEdit", uid); } }).catch(() => {});
  };

  const onContextMenu = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return false;
    const b = board();
    const editing = editingUid();
    if (editing && t.kind === "item" && t.uid === editing && t.part !== "header") return false; // editor keeps its native menu
    let kind = "canvas";
    let uid = null;
    if ((t.kind === "item" || t.kind === "section-title" || t.kind === "section-border") && t.uid && b?.items.has(t.uid)) {
      const item = b.items.get(t.uid);
      uid = t.uid;
      if (editing && editing !== uid) call("exitEdit");
      if (state.selection.has(uid) && state.selection.size > 1) kind = "multi";
      else {
        if (!state.selection.has(uid) || state.edge || state.link) selectItems([uid]);
        kind = item.type === "section" ? "section" : item.type === "text" ? "text" : "card";
      }
    } else if ((t.kind === "edge" || t.kind === "label") && t.uid) {
      kind = "edge";
      uid = t.uid;
      if (state.edge !== uid) selectEdge(uid);
    } else if (t.kind === "link" && (t.key || t.uid)) {
      kind = "link";
      uid = t.key || t.uid;
      if (state.link !== uid) selectLink(uid);
    }
    call("openMenu", { kind, uid, screen: ev.screen, world: ev.world, selection: [...state.selection] });
    return true;
  };

  const onWheel = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return false;
    const editing = editingUid();
    if (editing && t.kind === "item" && t.uid === editing) return false; // editor scrolls itself
    const v = vp();
    const pinch = Boolean(ev.ctrl || ev.meta);
    const wheelMode = setting("wheel", "pan");
    if (pinch || wheelMode === "zoom") {
      const factor = Math.exp(-(ev.deltaY || 0) * (pinch ? 0.01 : 0.002));
      call("setViewport", zoomAt(v, ev.screen, factor));
    } else {
      call("setViewport", { x: v.x - (ev.deltaX || 0), y: v.y - (ev.deltaY || 0), zoom: v.zoom });
    }
    return true;
  };

  // ------------------------------------------------------------------ keyboard
  const zoomBy = (factor) => {
    const s = call("size") || { width: 0, height: 0 };
    call("animateViewport", zoomAt(vp(), { x: s.width / 2, y: s.height / 2 }, factor));
  };
  const zoomTo = (z) => {
    const s = call("size") || { width: 0, height: 0 };
    const v = vp();
    call("animateViewport", zoomAt(v, { x: s.width / 2, y: s.height / 2 }, z / (v.zoom || 1)));
  };

  const deleteSelection = (withContents) => {
    if (state.edge) {
      const uid = state.edge;
      selectItems([]);
      call("deleteEdges", [uid]);
      call("toast", { message: "Connection deleted", action: { label: "Undo", run: () => call("undo") } });
      return true;
    }
    if (!state.selection.size) return false;
    const b = board();
    const all = [...state.selection];
    const blocked = (u) => isPinned(u) || (Boolean(withContents) && Boolean(b) && [...descendantsOf(b, u)].some(isPinned));
    const uids = all.filter((u) => !blocked(u));
    const kept = all.filter(blocked);
    if (kept.length) call("toast", { message: "Pinned items were not deleted. Unpin first." });
    if (!uids.length) return true;
    selectItems(kept);
    call("deleteItems", uids, { withContents: Boolean(withContents) });
    call("toast", { message: "Deleted", action: { label: "Undo", run: () => call("undo") } });
    return true;
  };

  const lastSelected = () => {
    let last = null;
    for (const u of state.selection) last = u;
    return last;
  };
  const selectNearest = (dir, add) => {
    const b = board();
    const r = hitRects();
    const from = lastSelected();
    if (!b || !r || !from || !b.items.has(from)) return;
    const parent = b.items.get(from).parentUid;
    const candidates = [];
    for (const [uid, item] of b.items) {
      if (uid !== from && !r.get(uid)) continue;
      if (item.parentUid === parent && (uid === from || !state.selection.has(uid))) candidates.push(uid);
    }
    const next = nearestInDirection(r, from, dir, { candidates });
    if (!next) return;
    selectItems(add ? [...state.selection, next] : [next]);
  };
  const selectOutline = (back) => {
    const b = board();
    if (!b) return false;
    const order = outlineOrder(b);
    if (!order.length) return false;
    const from = lastSelected();
    const i = from ? order.indexOf(from) : -1;
    let next;
    if (i < 0) next = back ? order[order.length - 1] : order[0];
    else next = order[(i + (back ? order.length - 1 : 1)) % order.length];
    selectItems([next]);
    return true;
  };

  const escape = () => {
    if (state.gesture) { onPointerCancel(); return true; }
    if (call("closeQuickLook")) return true;
    if (call("closeOverlay")) return true;
    if (call("exitPresent")) return true;
    if (isEditing()) { call("exitEdit"); return true; }
    if (call("exitFocus")) return true;
    if (clearSelection()) return true;
    if (call("popBoard")) return true;
    // BUG-6: the Escape that just closed Search, a popover or an overlay never also leaves fullscreen.
    if (call("overlayEscapeRecent")) return true;
    if (call("isFullscreen")) { call("setFullscreen", false); return true; }
    return false;
  };

  const runShortcut = (row, ev) => {
    const key = ev.key || "";
    const b = board();
    switch (row.action) {
      case "tool": setTool(row.tool); return true;
      case "space":
        if (!state.space) { state.space = true; call("setSpace", true); }
        return true;
      case "escape": return escape();
      case "presentNext": call("presentNext"); return true;
      case "presentPrev": call("presentPrev"); return true;
      case "selectAll": if (b) selectItems([...b.items.keys()]); return true;
      case "wrap": if (state.selection.size) call("wrapInSection", [...state.selection]); return true;
      case "duplicate":
        if (!state.selection.size) return false;
        call("duplicateItems", [...state.selection], { dx: 24, dy: 24, asRef: false });
        return true;
      case "fold": call("foldSelection"); return true;
      case "undo": call("undo"); return true;
      case "redo": call("redo"); return true;
      case "search": call("openSearch"); return true;
      case "zoomIn": zoomBy(1.2); return true;
      case "zoomOut": zoomBy(1 / 1.2); return true;
      case "back": call("historyBack"); return true;
      case "forward": call("historyForward"); return true;
      case "fitAll": call("fitAll"); return true;
      case "fitSelection": if (state.selection.size) call("fitSelection", [...state.selection]); return true;
      case "zoomReset": zoomTo(1); return true;
      case "delete": return deleteSelection(ev.shift);
      case "renamePage": {
        if (state.selection.size !== 1) return false;
        const uid = [...state.selection][0];
        const item = b?.items.get(uid);
        if (item?.kind !== "page") return false;
        call("renamePage", uid);
        return true;
      }
      case "enter": {
        if (state.selection.size !== 1) return false;
        const uid = [...state.selection][0];
        const item = b?.items.get(uid);
        if (item?.kind === "board" || (item && call("isBoardCard", uid))) call("openBoard", uid);
        else if (item?.type === "section") call("renameSection", uid);
        else call("enterEdit", uid);
        return true;
      }
      case "nearest": {
        if (!state.selection.size) return false;
        const dir = key === "ArrowLeft" ? "left" : key === "ArrowRight" ? "right" : key === "ArrowUp" ? "up" : key === "ArrowDown" ? "down" : null;
        if (dir) selectNearest(dir, ev.shift);
        return true;
      }
      case "nudge": {
        if (!state.selection.size) return false;
        const step = ev.shift ? 10 : 1;
        const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
        const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
        const uids = movingSet();
        if (uids.length) call("commitMove", uids, dx, dy);
        return true;
      }
      case "outline": return ev.tabOwned === false ? false : selectOutline(ev.shift);
      case "links": call("cycleLinks"); return true;
      case "info": call("openInfo"); return true;
      case "focus": call("toggleFocus"); return true;
      case "quickLook": call("quickLook"); return true;
      case "present": call("present"); return true;
      case "help": call("toggleShortcuts"); return true;
      case "expand": {
        if (state.selection.size !== 1) return false;
        const uid = lastSelected();
        const item = b?.items.get(uid);
        if (!item || item.type !== "card" || item.kind === "board") return false;
        call("expandOutline", uid);
        return true;
      }
      default: return false;
    }
  };

  const onKeyDown = (ev) => {
    const key = ev.key || "";
    const mod = Boolean(ev.meta || ev.ctrl);
    if (ev.inputFocused) {
      // Roam editor / input owns the keyboard. Only Esc leaves edit mode, and only when
      // Roam's autocomplete is closed.
      if (key === "Escape" && isEditing() && !call("autocompleteOpen")) { call("exitEdit"); return true; }
      return false;
    }
    if (call("presentActive") && !mod && !ev.alt) {
      const present = findShortcut(ev, "present");
      if (present) return runShortcut(present, ev);
    }
    const always = findShortcut(ev, "always");
    if (always) return runShortcut(always, ev);
    if (setting("enable-shortcuts", true) === false) return false;
    const row = findShortcut(ev, "normal");
    if (!row) return false;
    return runShortcut(row, ev);
  };

  const onKeyUp = (ev) => {
    if (ev.code === "Space" || ev.key === " ") {
      if (state.space) { state.space = false; call("setSpace", false); }
      return true;
    }
    return false;
  };

  const handle = (ev) => {
    switch (ev?.type) {
      case "pointerdown": return onPointerDown(ev);
      case "pointermove": return onPointerMove(ev);
      case "pointerup": return onPointerUp(ev);
      case "pointercancel": return onPointerCancel(ev);
      case "dblclick": return onDblClick(ev);
      case "contextmenu": return onContextMenu(ev);
      case "wheel": return onWheel(ev);
      case "keydown": return onKeyDown(ev);
      case "keyup": return onKeyUp(ev);
      default: return undefined;
    }
  };

  return {
    handle,
    setTool,
    getTool: () => state.tool,
    isLocked: () => state.locked,
    select: selectItems,
    selectEdge,
    selectLink,
    clearSelection,
    getSelection: () => ({ items: [...state.selection], edge: state.edge, link: state.link }),
    deleteSelection,
    escape,
    isGesturing: () => Boolean(state.gesture),
    gestureKind: () => state.gesture?.kind ?? null,
    cancel: () => { cancelOpen(); onPointerCancel(); },
    // Model changed under us: drop selection entries that no longer exist.
    reconcile() {
      const b = board();
      if (!b) return;
      let changed = false;
      for (const u of [...state.selection]) if (!b.items.has(u)) { state.selection.delete(u); changed = true; }
      if (state.edge && !b.edges.has(state.edge)) { state.edge = null; changed = true; }
      if (changed) emitSelection();
    },
  };
}
