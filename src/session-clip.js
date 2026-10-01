// Session clip: duplicate, paste, send to board and outline expansion. Registers itself with extendSession,
// so every session gets the methods. Each method is one transaction (one write per created or changed
// block, auto-fit at the end); the model helpers stay pure and this file only wires them to the session api.
import { boardPreview, boundsOf, buildBoard, containerAt, descendantsOf, findEdge, toRelative, topLevelOf } from "./model/board.js";
import { parsePastedText, planEdgeClones, planSubtreeClone, refCardStrings } from "./model/clipboard.js";
import { mindMapLayout } from "./model/layout.js";
import {
  DEFAULT_SIZES,
  PLEXUS_KEY,
  UNTITLED_BOARD,
  classifyString,
  edgeString,
  parseBoardTitle,
  readPlexus,
  semanticRef,
  serializeEdge,
  lookForNewString,
  serializeItemLayout,
} from "./model/schema.js";
import { capBulk, extendSession } from "./session.js";

const UID = ":block/uid";
const STR = ":block/string";
const KIDS = ":block/children";
const PROPS = ":block/props";

const STACK_GAP = 24;
const OUTLINE_CARD = { w: 240, h: 72 };
const OUTLINE_DEPTH = 3;
const OUTLINE_DIRECTIONS = ["right", "down", "balanced"];

function findNode(node, uid) {
  if (!node) return null;
  if (node[UID] === uid) return node;
  for (const c of node[KIDS] ?? []) {
    const hit = findNode(c, uid);
    if (hit) return hit;
  }
  return null;
}

const isEnhancedBoardNode = (node) => Boolean(node)
  && readPlexus(node[PROPS])?.v === 2
  && classifyString(node[STR]).kind === "board";

extendSession((session, api) => {
  const { host } = api;
  const gen = () => host.generateUid();

  // Plain card whose position is resolved against the current model: parent = the section at its center.
  function placeCard(t, string, x, y, { w, h, color } = {}, exclude) {
    const board = api.board();
    const rects = api.rects();
    const cw = w ?? DEFAULT_SIZES.card.w;
    const ch = h ?? DEFAULT_SIZES.card.h;
    const parent = containerAt(board, { x: x + cw / 2, y: y + ch / 2 }, { rects, exclude });
    const rel = toRelative(board, parent, { x, y }, rects);
    const layout = { x: rel.x, y: rel.y };
    if (w !== undefined) layout.w = w;
    if (h !== undefined) layout.h = h;
    if (color) layout.color = color;
    const look = lookForNewString(string, api.setting("default-card-look", "block"));
    if (look) layout.look = look;
    return t.create({ parent, string, plexus: serializeItemLayout(layout) });
  }

  // Clones `entries` ({uid, x, y}: world top-left of the copy) out of `src` ({board, node(uid)}) into this
  // board. Page, block, image and text cards become another card with the same string; notes, sections and
  // enhanced nested boards are cloned as a whole subtree. Connections between cloned items are cloned too.
  function cloneSet(t, src, entries, exclude) {
    const board = api.board();
    const rects = api.rects();
    const at = new Map(entries.map((e) => [e.uid, e]));
    const uidMap = new Map();
    const tops = [];
    for (const id of topLevelOf(src.board, entries.map((e) => e.uid))) {
      const e = at.get(id);
      const item = src.board.items.get(id);
      const node = src.node(id);
      if (!item || !node) continue;
      if (item.kind === "board" && !item.enhanced) continue;
      const parent = containerAt(board, { x: e.x + item.w / 2, y: e.y + item.h / 2 }, { rects, exclude });
      const rel = toRelative(board, parent, { x: e.x, y: e.y }, rects);
      const x = api.round1(rel.x);
      const y = api.round1(rel.y);
      const simple = item.type === "text" || ["page", "block", "image"].includes(item.kind);
      if (simple) {
        const plexus = { ...(readPlexus(node[PROPS]) ?? {}), x, y };
        delete plexus.pinned;
        const fresh = gen();
        uidMap.set(id, fresh);
        t.create({ parent, uid: fresh, string: node[STR] ?? "", plexus });
        tops.push(fresh);
        continue;
      }
      const patch = { x, y };
      if (item.type === "section") Object.assign(patch, { type: "section", w: item.w, h: item.h });
      const plan = planSubtreeClone(node, { genUid: gen, parentUid: parent, order: api.insertOrder(parent), plexusPatch: patch, uidMap });
      const oldOf = new Map([...uidMap].map(([o, n]) => [n, o]));
      for (const c of plan.creates) {
        const plexus = c.props?.[PLEXUS_KEY] ? { ...c.props[PLEXUS_KEY] } : null;
        if (plexus) {
          if (src.board.items.has(oldOf.get(c.uid))) delete plexus.pinned;
          if (plexus.type === "edge") {
            if (uidMap.has(plexus.from)) plexus.from = uidMap.get(plexus.from);
            if (uidMap.has(plexus.to)) plexus.to = uidMap.get(plexus.to);
          }
        }
        t.create({
          parent: c.parent,
          uid: c.uid,
          string: c.string,
          plexus: plexus && Object.keys(plexus).length ? plexus : undefined,
          order: c.order,
          open: c.open === false ? false : undefined,
        });
      }
      tops.push(plan.creates[0].uid);
    }
    const edges = [...src.board.edges.values()].filter((edge) => edge.valid && uidMap.has(edge.from) && uidMap.has(edge.to));
    if (edges.length) {
      const refs = new Map();
      for (const [old, fresh] of uidMap) {
        const it = src.board.items.get(old);
        refs.set(fresh, it && (it.kind === "page" || it.kind === "block") ? semanticRef(it) : `((${fresh}))`);
      }
      const containerUid = api.ensureContainer(t);
      for (const c of planEdgeClones(edges, uidMap, { genUid: gen, containerUid, refOfNew: (fresh) => refs.get(fresh) })) {
        t.create({ parent: c.parent, uid: c.uid, string: c.string, plexus: c.props[PLEXUS_KEY], order: "last" });
      }
    }
    return tops;
  }

  const stackAt = (list, x, y) => list.map((string, i) => ({ string, x, y: y + i * (DEFAULT_SIZES.card.h + STACK_GAP) }));

  // Ref cards to the right of a board's content, stacked below each other.
  const outlineOrigin = (preview) => (preview.bounds ? { x: preview.bounds.x + preview.bounds.w + 48, y: preview.bounds.y } : { x: 0, y: 0 });

  Object.assign(session, {
    // New top-level uids. asRef=true makes ref cards instead. The pinned flag is not copied.
    duplicateItems(uids, { dx = 24, dy = 24, asRef = false } = {}) {
      return api.txn((t) => {
        const board = api.board();
        const rects = api.rects();
        const top = topLevelOf(board, uids ?? []);
        if (!top.length) return [];
        const exclude = new Set(top);
        let made;
        if (asRef) {
          made = top.map((id) => {
            const r = rects.get(id);
            return placeCard(t, api.refOf(id), r.x + dx, r.y + dy, {}, exclude);
          });
        } else {
          const entries = top.map((id) => ({ uid: id, x: rects.get(id).x + dx, y: rects.get(id).y + dy }));
          made = cloneSet(t, { board, node: api.rawNode }, entries, exclude);
        }
        api.applyFit(t, made);
        return made;
      }).then((made) => made ?? []);
    },

    // A detached copy of the items (and their subtrees and the connections between them) as a synthetic board
    // tree. A cut puts it in the clipboard payload, so the paste no longer depends on the deleted blocks.
    snapshotItems(uids) {
      const board = api.board();
      if (!board) return null;
      const top = topLevelOf(board, uids ?? []);
      if (!top.length) return null;
      const set = new Set(top);
      for (const id of top) for (const d of descendantsOf(board, id)) set.add(d);
      const copy = (id) => JSON.parse(JSON.stringify(api.rawNode(id) ?? null));
      const nodes = top.map(copy).filter(Boolean);
      if (!nodes.length) return null;
      const edgeNodes = [...board.edges.values()].filter((e) => e.valid && set.has(e.from) && set.has(e.to)).map((e) => copy(e.uid)).filter(Boolean);
      if (edgeNodes.length) nodes.push({ [UID]: "plexus-cut-edges", [STR]: "Connections", [PROPS]: { [PLEXUS_KEY]: { type: "edges" } }, [KIDS]: edgeNodes });
      return { [UID]: session.uid, [STR]: "", [KIDS]: nodes };
    },

    // data comes from parseClipboard (the `plexus` payload or its `.data`). mode 'refs' makes ref cards,
    // 'clone' clones the copied items (from this board or, for another board, from its pulled tree). A payload
    // with a `snapshot` (a cut) is always cloned from the snapshot: the source blocks are gone.
    pasteItems(data, { x = 0, y = 0, mode = "refs" } = {}) {
      const payload = data?.kind === "plexus" ? data.data : data;
      if (!payload || !Array.isArray(payload.items) || !payload.items.length) return Promise.resolve([]);
      if (payload.snapshot && typeof payload.snapshot === "object") mode = "clone";
      return api.txn((t) => {
        let made;
        if (mode === "clone") {
          let src;
          if (payload.snapshot && typeof payload.snapshot === "object") {
            const board = buildBoard(payload.snapshot);
            if (!board) return [];
            src = { board, node: (id) => findNode(payload.snapshot, id) };
          } else if (payload.board === session.uid) src = { board: api.board(), node: api.rawNode };
          else {
            const pulled = host.pullBoard(payload.board);
            const board = pulled ? buildBoard(pulled) : null;
            if (!board) return [];
            src = { board, node: (id) => findNode(pulled, id) };
          }
          const bounds = payload.bounds ?? boundsOf(payload.items) ?? { x: 0, y: 0 };
          const entries = payload.items.map((i) => ({ uid: i.uid, x: x + (i.x - bounds.x), y: y + (i.y - bounds.y) }));
          made = cloneSet(t, src, entries);
        } else {
          made = capBulk(refCardStrings(payload, { x, y }), api.emit).map((c) => placeCard(t, c.string, c.x, c.y, { w: c.w, h: c.h, color: c.color }));
        }
        api.applyFit(t, made);
        return made;
      }).then((made) => made ?? []);
    },

    // text: raw clipboard text or the entries parsePastedText returned.
    pasteText(text, { x = 0, y = 0 } = {}) {
      const list = (Array.isArray(text) ? text : parsePastedText(text))
        .map((e) => (typeof e === "string" ? e : e?.string))
        .filter((s) => typeof s === "string" && s.trim() !== "");
      if (!list.length) return Promise.resolve([]);
      return api.txn((t) => {
        const made = capBulk(stackAt(list, x, y), api.emit).map((c) => placeCard(t, c.string, c.x, c.y));
        api.applyFit(t, made);
        return made;
      }).then((made) => made ?? []);
    },

    // Adds ref cards for the items to the right of the target board's content. Resolves {added, title} or null.
    sendToBoard(uids, targetUid) {
      const board = api.board();
      if (!board || !targetUid || targetUid === session.uid) return Promise.resolve(null);
      const top = topLevelOf(board, uids ?? []).filter((id) => id !== targetUid);
      if (!top.length) return Promise.resolve(null);
      const node = api.rawNode(targetUid);
      if (node) {
        if (!isEnhancedBoardNode(node)) return Promise.resolve(null);
        const origin = outlineOrigin(boardPreview({ uid: targetUid, string: node[STR], content: node[KIDS] ?? [] }));
        const title = parseBoardTitle(node[STR]) || UNTITLED_BOARD;
        return api.txn((t) => {
          for (const c of stackAt(top.map((id) => api.refOf(id)), origin.x, origin.y)) {
            t.create({ parent: targetUid, string: c.string, plexus: serializeItemLayout({ x: c.x, y: c.y }) });
          }
          return { added: top.length, title };
        }).then((res) => res ?? null);
      }
      const pulled = host.pullBoard(targetUid);
      if (!isEnhancedBoardNode(pulled)) return Promise.resolve(null);
      const target = buildBoard(pulled);
      const origin = outlineOrigin(boardPreview({ uid: targetUid, string: pulled[STR], content: pulled[KIDS] ?? [] }));
      const cards = stackAt(top.map((id) => api.refOf(id)), origin.x, origin.y);
      return api.queue.run(async () => {
        for (let i = 0; i < cards.length; i++) {
          await host.createBlock({
            parentUid: targetUid,
            order: target.containerIndex >= 0 ? target.containerIndex + i : "last",
            string: cards[i].string,
            props: { [PLEXUS_KEY]: serializeItemLayout({ x: cards[i].x, y: cards[i].y }) },
          });
        }
        return { added: cards.length, title: target.title || UNTITLED_BOARD };
      }).catch((err) => {
        console.error("[plexus session] sendToBoard", err);
        api.emit("toast", { message: "Couldn't send the cards to that board." });
        return null;
      });
    },

    // The source card's child blocks become a mind map of ref cards (blocks stay canonical in Roam) plus one
    // connection per parent -> child. Children that already have a card on this board are reused, not moved.
    expandOutline(cardUid, { direction = "right", max = 24 } = {}) {
      const none = { added: 0, edges: 0 };
      const board = api.board();
      const item = board?.items.get(cardUid);
      if (!item || item.type !== "card") return Promise.resolve(none);
      const plain = (list) => list.filter((n) => n?.uid).map((n) => ({ uid: n.uid, children: plain(n.children ?? []) }));
      const rawTree = (list) => list.filter((n) => n?.[UID]).map((n) => ({ uid: n[UID], children: rawTree(api.kidsOf(n)) }));
      let tree;
      if (item.kind === "note") tree = rawTree(api.kidsOf({ [KIDS]: item.content }));
      else if (item.kind === "block") tree = plain(host.pullTree(item.target.uid, OUTLINE_DEPTH, max) ?? []);
      else if (item.kind === "page") tree = plain(host.pagePreview(item.target.title, OUTLINE_DEPTH, max)?.blocks ?? []);
      else return Promise.resolve(none);

      // Depth <= 3 and at most `max` nodes; shallow levels win when the cap bites.
      const flat = [];
      const walk = (list, depth, parent) => {
        for (const n of list) {
          if (depth > OUTLINE_DEPTH || flat.some((f) => f.uid === n.uid)) continue;
          const entry = { uid: n.uid, depth, parent, at: flat.length };
          flat.push(entry);
          walk(n.children, depth + 1, n.uid);
        }
      };
      walk(tree, 1, null);
      const chosen = new Set([...flat].sort((a, b) => a.depth - b.depth || a.at - b.at).slice(0, Math.max(0, max)).map((f) => f.uid));
      const picked = flat.filter((f) => chosen.has(f.uid));
      if (!picked.length) return Promise.resolve(none);

      const rects = api.rects();
      const own = rects.get(cardUid);
      const onBoard = new Map();
      for (const it of board.items.values()) {
        if (it.uid !== cardUid && it.kind === "block" && !onBoard.has(it.target.uid)) onBoard.set(it.target.uid, it.uid);
      }
      const nodes = new Map(picked.map((f) => {
        const have = onBoard.get(f.uid);
        const r = have ? rects.get(have) : null;
        return [f.uid, { uid: f.uid, w: r?.w ?? OUTLINE_CARD.w, h: r?.h ?? OUTLINE_CARD.h, children: [] }];
      }));
      const root = { uid: cardUid, w: own.w, h: own.h, children: [] };
      for (const f of picked) (f.parent && nodes.has(f.parent) ? nodes.get(f.parent) : root).children.push(nodes.get(f.uid));
      const layout = mindMapLayout(root, { direction: OUTLINE_DIRECTIONS.includes(direction) ? direction : "right" });

      return api.txn((t) => {
        const cardOf = new Map();
        const refOfCard = new Map([[cardUid, api.refOf(cardUid)]]);
        const created = [];
        // A reused card stays where it is, so its descendants are laid out relative to where it really sits (its own
        // slot is ignored): shift is the slot -> actual offset each new card inherits from its nearest reused ancestor.
        const shift = new Map();
        for (const f of picked) {
          const p = layout.get(f.uid);
          const have = onBoard.get(f.uid);
          if (have) {
            const r = rects.get(have);
            shift.set(f.uid, r ? { dx: r.x - (own.x + p.x), dy: r.y - (own.y + p.y) } : { dx: 0, dy: 0 });
            cardOf.set(f.uid, have);
            refOfCard.set(have, api.refOf(have));
            continue;
          }
          const inherited = shift.get(f.parent) ?? { dx: 0, dy: 0 };
          shift.set(f.uid, inherited);
          const id = placeCard(t, `((${f.uid}))`, own.x + p.x + inherited.dx, own.y + p.y + inherited.dy, OUTLINE_CARD);
          cardOf.set(f.uid, id);
          refOfCard.set(id, `((${f.uid}))`);
          created.push(id);
        }
        let edges = 0;
        let container = null;
        for (const f of picked) {
          const from = f.parent && cardOf.has(f.parent) ? cardOf.get(f.parent) : cardUid;
          const to = cardOf.get(f.uid);
          if (from === to || findEdge(board, from, to)) continue;
          container ??= api.ensureContainer(t);
          t.create({
            parent: container,
            order: "last",
            string: edgeString({ srcRef: refOfCard.get(from), dstRef: refOfCard.get(to), dir: "one", label: "" }),
            plexus: serializeEdge({ from, to, dir: "one" }),
          });
          edges++;
        }
        api.applyFit(t, created);
        const skipped = flat.length - picked.length; // beyond the node cap (deeper than the depth limit is not counted)
        return skipped > 0 ? { added: created.length, edges, skipped, total: flat.length } : { added: created.length, edges };
      }).then((res) => res ?? none);
    },
  });
});
