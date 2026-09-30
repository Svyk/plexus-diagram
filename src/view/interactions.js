// Pointer / keyboard state machine for the board (spec 3.3). No DOM: the view normalizes
// events into { type, screen, world, target, ... } and this controller calls `actions`.
//
// actions (all optional unless noted):
//   board() rects() viewport() size()                      — model + view state (required)
//   setViewport(vp) fitAll() fitSelection(uids)
//   onSelection({ items, edge, link }) onTool(tool, locked) onHover(uid|null)
//   setGesturing(bool) showMarquee(rect|null, kind) showGuides(list) previewMove(uids, dx, dy)
//   previewRects(list) showTempWire({ from, fromSide, point }|null)
//   commitMove(uids, dx, dy) commitRects(list) createCard({x,y}) createText({x,y})
//   createSection({rect}) wrapInSection(uids) deleteItems(uids, opts) deleteEdges(uids)
//   createBoard({rect}) moveIntoBoard(uids, boardUid, dx, dy) openBoard(uid) popBoard() → true when it went up a level
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
//   closeQuickLook() exitPresent() exitFocus()             — each returns true when it closed something (Escape chain)
//   fitHeight(uid)  fitSection(uid)  resetSize(uids)       — double-click on a bottom / corner grip (a section fits its contents)
// Keydown events may carry tabOwned:false (focus is not on the board itself); Tab is then left to Roam and the browser.
// Escape order: gesture, quick look, presentation, edit, focus, selection, popBoard, fullscreen.

import { DEFAULT_BOARD_CARD, DEFAULT_SIZES, MIN_SIZES } from "../model/schema.js";
import { descendantsOf, findEdge, hitTest, itemsInRect, outlineOrder, topLevelOf, boundsOf } from "../model/board.js";
import { nearestInDirection, nearestSide, snapMove, zoomAt } from "../model/geometry.js";

export const TOOL_KEYS = { v: "select", h: "hand", n: "card", t: "text", g: "section", w: "board", c: "connect" };
export const TOOLS = ["select", "hand", "card", "text", "section", "board", "connect"];
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
    call("showGuides", []);
    call("showTempWire", null);
    call("onHover", null);
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

  const beginConnect = (uid, side, world) => {
    begin({ kind: "connect", from: uid, fromSide: side, start: world });
    call("showTempWire", { from: uid, fromSide: side, point: world });
  };

  // ------------------------------------------------------------------ pointer
  const onPointerDown = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return;
    if (ev.button === 2) return;
    if (state.gesture) return;
    const editing = editingUid();
    if (editing) {
      if (t.kind === "item" && t.uid === editing && t.part !== "header") return; // editor owns the pointer
      if (!(t.kind === "item" && t.uid === editing)) call("exitEdit");
    }
    const panRequested = ev.button === 1 || state.space || state.tool === "hand";
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
        if (ev.shift && !dup) { // Alt+Shift means duplicate-as-reference, not a selection toggle
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
        begin({ kind: "move", uids, dup, asRef: dup && Boolean(ev.shift), start: ev.screen, target: t.uid, deferred, bounds: movingBounds(uids), others: setting("snap-guides", true) ? otherRects(uids) : [] });
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
    if (state.tool === "card" || state.tool === "text") {
      begin({ kind: "place", tool: state.tool, start: ev.world });
      return;
    }
    begin({ kind: "marquee", start: ev.world, base: ev.shift ? new Set(state.selection) : new Set(), shift: ev.shift });
  };

  const onPointerMove = (ev) => {
    const g = state.gesture;
    if (!g) return;
    if (g.kind === "connect") {
      const b = board();
      const r = rects();
      call("showTempWire", { from: g.from, fromSide: g.fromSide, point: ev.world });
      const hit = b && r ? hitTest(b, ev.world, r, { sectionInterior: true }) : null;
      const hover = hit && hit.uid !== g.from ? hit.uid : null;
      if (hover !== state.hover) { state.hover = hover; call("onHover", hover); }
      if (!g.moved && Math.hypot(ev.world.x - g.start.x, ev.world.y - g.start.y) * zoom() >= DRAG_THRESHOLD_PX) g.moved = true;
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
      if (g.bounds && g.others.length) {
        const moving = { x: g.bounds.x + dx, y: g.bounds.y + dy, w: g.bounds.w, h: g.bounds.h };
        const snap = snapMove(moving, g.others, SNAP_PX / z);
        dx += snap.dx;
        dy += snap.dy;
        guides = snap.guides;
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
      const r = rects();
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
    if (g.kind === "marquee") {
      const rect = normRect(g.start, ev.world);
      g.rect = rect;
      call("showMarquee", rect, "select");
      const b = board();
      const r = rects();
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
          const d = DEFAULT_SIZES[g.tool];
          const at = { x: g.start.x - d.w / 2, y: g.start.y - d.h / 2 };
          end();
          const p = g.tool === "text" ? call("createText", at) : call("createCard", at);
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
        break;
      case "resize":
        if (g.moved && g.rect) call("commitRects", [g.rect]);
        break;
      case "connect": {
        const hit = b && r ? hitTest(b, ev.world, r, { sectionInterior: true }) : null;
        end();
        if (hit && hit.uid === g.from) {
          selectItems([g.from]);
        } else if (hit) {
          const existing = findEdge(b, g.from, hit.uid);
          if (existing) {
            selectEdge(existing.uid);
          } else {
            const toSide = nearestSide(r.get(hit.uid), ev.world);
            Promise.resolve(call("addEdge", { from: g.from, to: hit.uid, fromSide: g.fromSide, toSide }))
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
    const b = board();
    if (t.kind === "item" && t.uid) {
      const item = b?.items.get(t.uid);
      if (!item) return;
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
    call("setViewport", zoomAt(vp(), { x: s.width / 2, y: s.height / 2 }, factor));
  };
  const zoomTo = (z) => {
    const s = call("size") || { width: 0, height: 0 };
    const v = vp();
    call("setViewport", zoomAt(v, { x: s.width / 2, y: s.height / 2 }, z / (v.zoom || 1)));
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
    const r = rects();
    const from = lastSelected();
    if (!b || !r || !from || !b.items.has(from)) return;
    const parent = b.items.get(from).parentUid;
    const candidates = [];
    for (const [uid, item] of b.items) if (item.parentUid === parent && (uid === from || !state.selection.has(uid))) candidates.push(uid);
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
    if (call("exitPresent")) return true;
    if (isEditing()) { call("exitEdit"); return true; }
    if (call("exitFocus")) return true;
    if (clearSelection()) return true;
    if (call("popBoard")) return true;
    if (call("isFullscreen")) { call("setFullscreen", false); return true; }
    return false;
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
      if (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown" || ev.code === "Space" || key === " ") { call("presentNext"); return true; }
      if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") { call("presentPrev"); return true; }
    }
    if (ev.code === "Space" || key === " ") {
      if (!state.space) { state.space = true; call("setSpace", true); }
      return true;
    }
    if (key === "Escape") return escape();
    if (setting("enable-shortcuts", true) === false) return false;
    const b = board();
    if (mod) {
      const k = key.toLowerCase();
      if (k === "a") { if (b) selectItems([...b.items.keys()]); return true; }
      if (k === "g") { if (state.selection.size) call("wrapInSection", [...state.selection]); return true; }
      if (k === "d" && !ev.alt) {
        if (!state.selection.size) return false;
        call("duplicateItems", [...state.selection], { dx: 24, dy: 24, asRef: false });
        return true;
      }
      if (k === "enter" && ev.alt) { call("foldSelection"); return true; }
      if (k === "z") { if (ev.shift) call("redo"); else call("undo"); return true; }
      if (k === "=" || k === "+") { zoomBy(1.2); return true; }
      if (k === "-" || k === "_") { zoomBy(1 / 1.2); return true; }
      return false;
    }
    if (ev.shift) {
      if (ev.code === "Digit1" || key === "!") { call("fitAll"); return true; }
      if (ev.code === "Digit2" || key === "@") { if (state.selection.size) call("fitSelection", [...state.selection]); return true; }
      if (ev.code === "Digit0" || key === ")") { zoomTo(1); return true; }
    }
    if (key === "Delete" || key === "Backspace") return deleteSelection(ev.shift);
    if (key === "Enter") {
      if (state.selection.size === 1) {
        const uid = [...state.selection][0];
        const item = b?.items.get(uid);
        if (item?.kind === "board" || (item && call("isBoardCard", uid))) call("openBoard", uid);
        else if (item?.type === "section") call("renameSection", uid);
        else call("enterEdit", uid);
        return true;
      }
      return false;
    }
    if (key.startsWith("Arrow")) {
      if (!state.selection.size) return false;
      if (ev.alt) {
        const dir = key === "ArrowLeft" ? "left" : key === "ArrowRight" ? "right" : key === "ArrowUp" ? "up" : key === "ArrowDown" ? "down" : null;
        if (dir) selectNearest(dir, ev.shift);
        return true;
      }
      const step = ev.shift ? 10 : 1;
      const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
      const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
      const uids = movingSet();
      if (uids.length) call("commitMove", uids, dx, dy);
      return true;
    }
    if (key === "Tab" && !ev.alt) return ev.tabOwned === false ? false : selectOutline(ev.shift);
    if (ev.alt) return false;
    const lower = key.toLowerCase();
    if (TOOL_KEYS[lower]) { setTool(TOOL_KEYS[lower]); return true; }
    if (lower === "l") { call("cycleLinks"); return true; }
    if (key === "/") { call("openSearch"); return true; }
    if (lower === "f") { call("toggleFocus"); return true; }
    if (lower === "q") { call("quickLook"); return true; }
    if (lower === "p") { call("present"); return true; }
    if (lower === "m") {
      if (state.selection.size !== 1) return false;
      const uid = lastSelected();
      const item = b?.items.get(uid);
      if (!item || item.type !== "card" || item.kind === "board") return false;
      call("expandOutline", uid);
      return true;
    }
    return false;
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
    cancel: onPointerCancel,
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
