// PXD-12 session calls for the order of a source block's children. "Apply order to source" reorders the real sibling
// blocks of one parent to the board's reading order and writes nothing else (card positions stay). A section marked
// "Keep outline order" tidies its members again when the parent's children are reordered from outside Plexus.
// Nothing here writes on open or on a timer; unmarked sections have no watch.
import { byReadingPosition } from "./model/board.js";
import {
  SOURCE_ORDER_CHUNK,
  chunkMoves,
  chunkStates,
  orderChanged,
  orderSignature,
  outlineOrderByTarget,
  pickSourceParent,
  planSourceOrder,
} from "./model/source-order.js";
import { extendSession } from "./session.js";

const SETTLE_MS = 150;
const SIGNATURE_CAP = 400;
// An order Plexus wrote counts as its own only this long after its last write (or Cmd+Z): the same order made later
// in Roam is an outside change.
const OWN_ECHO_MS = 3000;

const isRefCard = (item) => item?.type === "card" && item.kind === "block" && item.target?.kind === "block" && typeof item.target.uid === "string" && item.target.uid;

extendSession((session, api) => {
  const { host } = api;
  const sorted = (kids) => (kids || []).slice().sort((a, b) => a.order - b.order);
  const kidsOf = (parentUid) => sorted(host.outlineKids?.([parentUid])?.get(parentUid));

  // Ref cards of the given items; a section stands for its direct members. [{ card, target }] in reading order.
  const refCardsOf = (uids) => {
    const board = api.board();
    if (!board) return [];
    const seen = new Set();
    const cards = [];
    const add = (id) => {
      const item = board.items.get(id);
      if (!item || seen.has(id)) return;
      seen.add(id);
      // A nested section's cards belong to that section, not to this one.
      if (item.type === "section") return;
      if (isRefCard(item)) cards.push({ card: id, target: item.target.uid });
    };
    for (const id of uids ?? []) {
      const item = board.items.get(id);
      if (item?.type === "section") { seen.add(id); for (const m of item.members) add(m); } else add(id);
    }
    const byCard = new Map(cards.map((c) => [c.card, c]));
    return byReadingPosition(cards.map((c) => c.card), board, api.rects()).map((id) => byCard.get(id));
  };

  const parentOf = (target) => {
    try { return host.blockLocation?.(target)?.parentUid || ""; } catch { return ""; }
  };

  function compute(uids) {
    const cards = refCardsOf(uids);
    const distinct = new Set(cards.map((c) => c.target));
    if (distinct.size < 2) return { reason: "Select at least two block cards to apply their order" };
    const rows = cards.map((c) => ({ target: c.target, parent: parentOf(c.target) }));
    const { parentUid } = pickSourceParent(rows);
    if (!parentUid) return { reason: "Those blocks have no parent to reorder" };
    const kids = kidsOf(parentUid);
    const plan = planSourceOrder(kids, rows.filter((r) => r.parent === parentUid).map((r) => r.target));
    const skippedCards = distinct.size - plan.targets.length;
    if (plan.targets.length < 2) return { reason: "Fewer than two of those blocks can be reordered here" };
    if (!plan.moves.length) return { reason: "The blocks are already in the board's order" };
    let parentLabel = "";
    try { parentLabel = host.blockLabel?.(parentUid) || ""; } catch { parentLabel = ""; }
    return { parentUid, parentLabel: parentLabel || "the parent block", plan, skippedCards, moveCount: plan.moves.length, count: plan.targets.length };
  }

  // Orders the plan passed (and passes back to, with Cmd+Z): an outside-change check ignores these.
  const own = new Map(); // parentUid -> Set(signature)
  const applying = new Set();
  const remember = (parentUid, orders) => {
    let set = own.get(parentUid);
    if (!set || set.size > SIGNATURE_CAP) own.set(parentUid, set = new Set());
    for (const o of orders) set.add(orderSignature(o));
  };

  // ---- watches on the source parents of marked sections ----
  const watches = new Map(); // parentUid -> { off, baseline, timer }
  let marked = new Map(); // sectionUid -> parentUid
  let markKey = "";

  const markedSections = () => {
    const board = api.board();
    const out = [];
    if (!board?.enhanced) return out;
    for (const item of board.items.values()) if (item.type === "section" && item.keepOrder === true) out.push(item);
    return out;
  };

  const retidy = (parentUid, next) => {
    for (const [sectionUid, p] of marked) {
      if (p !== parentUid) continue;
      const board = api.board();
      const section = board?.items.get(sectionUid);
      if (!section || section.keepOrder !== true) continue;
      const cards = section.members.map((m) => board.items.get(m)).filter(isRefCard).map((item) => ({ card: item.uid, target: item.target.uid }));
      if (cards.length < 2) continue;
      const order = outlineOrderByTarget(next, cards);
      void session.tidyItems([sectionUid], "outline", { order });
    }
  };

  const settle = (parentUid) => {
    const slot = watches.get(parentUid);
    if (!slot || api.isGone()) return;
    slot.timer = null;
    // An apply in flight: its own end state becomes the baseline.
    if (applying.has(parentUid)) return;
    const next = kidsOf(parentUid).map((k) => k.uid);
    const prev = slot.baseline;
    slot.baseline = next;
    if (!prev || !orderChanged(prev, next)) return;
    const ownWrite = Date.now() - (host.lastWriteAt?.() ?? -Infinity) < OWN_ECHO_MS;
    if (ownWrite && own.get(parentUid)?.has(orderSignature(next))) return;
    retidy(parentUid, next);
  };

  const watchParent = (parentUid) => {
    if (watches.has(parentUid)) return;
    const slot = { off: () => {}, baseline: kidsOf(parentUid).map((k) => k.uid), timer: null };
    slot.off = host.watchChildren?.(parentUid, () => {
      if (slot.timer != null) clearTimeout(slot.timer);
      slot.timer = setTimeout(() => settle(parentUid), SETTLE_MS);
    }) ?? (() => {});
    watches.set(parentUid, slot);
  };

  const dropParent = (parentUid) => {
    const slot = watches.get(parentUid);
    if (!slot) return;
    if (slot.timer != null) clearTimeout(slot.timer);
    try { slot.off(); } catch { /* already gone */ }
    watches.delete(parentUid);
  };

  // The watch set follows the marked sections. Reads parents only when a marked section or its ref members change.
  const resync = () => {
    if (api.isGone()) return;
    const board = api.board();
    const sections = markedSections();
    const key = sections.map((s) => `${s.uid}:${s.members.map((m) => (isRefCard(board.items.get(m)) ? board.items.get(m).target.uid : "")).join(",")}`).join("|");
    if (key === markKey) return;
    markKey = key;
    const next = new Map();
    for (const section of sections) {
      const cards = refCardsOf([section.uid]);
      const { parentUid } = pickSourceParent(cards.map((c) => ({ target: c.target, parent: parentOf(c.target) })));
      if (parentUid) next.set(section.uid, parentUid);
    }
    marked = next;
    const want = new Set(next.values());
    for (const parentUid of [...watches.keys()]) if (!want.has(parentUid)) dropParent(parentUid);
    for (const parentUid of want) watchParent(parentUid);
  };

  // Text edits inside cards change neither the marked sections nor their members.
  const offChange = session.on?.("change", (diff) => {
    const board = api.board();
    if (diff && !diff.structural && ![...(diff.dirty ?? [])].some((id) => board?.items.get(id)?.type === "section")) return;
    resync();
  });
  api.onDestroy?.(() => {
    try { offChange?.(); } catch { /* listeners already cleared */ }
    for (const parentUid of [...watches.keys()]) dropParent(parentUid);
  });
  if (api.board()) resync();

  Object.assign(session, {
    // Read-only. { parentUid, parentLabel, moveCount, count, skippedCards } or { reason } when there is nothing to do.
    sourceOrderPlan(uids) {
      const res = compute(uids);
      if (res.reason) return { reason: res.reason };
      const { parentUid, parentLabel, moveCount, count, skippedCards } = res;
      return { parentUid, parentLabel, moveCount, count, skippedCards };
    },

    // Moves the real blocks, 45 per transaction. One chunk is one native undo step; more go back in one custom step.
    // Resolves { moved, parentUid, skippedCards, chunks }.
    async applySourceOrder(uids) {
      const res = compute(uids);
      if (res.reason) return { moved: 0, parentUid: res.parentUid ?? null, skippedCards: 0, chunks: 0, reason: res.reason };
      const { parentUid, plan, skippedCards } = res;
      const chunks = chunkMoves(plan.moves, SOURCE_ORDER_CHUNK);
      const states = chunkStates(plan.current, chunks);
      remember(parentUid, [plan.current, ...states, plan.desired]);
      let done = 0;
      let reason;
      // Past one chunk Roam's own undo (50 entries) cannot walk back every move. Each chunk then carries a custom entry
      // that plans from the live children back to the original order (and forward again on redo): one Cmd+Z undoes the
      // whole apply, or what ran of it. The host clears its log after a custom undo, so the earlier chunks' entries go.
      const walk = async (state) => {
        for (const m of planSourceOrder(kidsOf(parentUid), state).moves) await host.moveBlock(m.uid, parentUid, m.order);
      };
      const customFor = (i) => (chunks.length > 1 ? { undo: () => walk(plan.current), redo: () => walk(states[i]) } : null);
      applying.add(parentUid);
      try {
        for (let i = 0; i < chunks.length; i++) {
          if (api.isGone()) break;
          await api.txn((t) => { for (const m of chunks[i]) t.move(m.uid, parentUid, m.order); }, customFor(i));
          // A failed write (the txn resolves either way) or any edit under the parent meanwhile, an added or deleted
          // sibling too: the next chunk's indexes no longer hold.
          if (orderSignature(kidsOf(parentUid).map((k) => k.uid)) !== orderSignature(states[i])) {
            reason = "Stopped: the blocks did not land where expected. Undo to go back.";
            break;
          }
          done += chunks[i].length;
        }
      } finally {
        applying.delete(parentUid);
      }
      const slot = watches.get(parentUid);
      if (slot) slot.baseline = kidsOf(parentUid).map((k) => k.uid);
      return { moved: done, parentUid, skippedCards, chunks: chunks.length, ...(reason ? { reason } : {}) };
    },
  });
});
