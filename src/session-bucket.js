// PXD-10 session calls for a bound section: the binding lives in the section's plexus (`bucket`). Binding writes
// nothing to cards. A card moved into or out of a bound section gets the tag / attribute written onto its real block
// inside the move's own transaction (one undo, echoes go through the ledger). Unbound sections change nothing.
import { descendantsOf } from "./model/board.js";
import { attrsOfKids, bindingKey, bindingLabel, chunk, planBucketAdd, planChainChange, readBinding } from "./model/bucket.js";
import { extendSession } from "./session.js";

const STR = ":block/string";
const KIDS = ":block/children";
const UID = ":block/uid";

extendSession((session, api) => {
  const { host } = api;
  const boardUid = session.uid;

  // Bindings of the bound sections above a parent, innermost first.
  const chainOf = (parentUid) => {
    const board = api.board();
    const out = [];
    let at = parentUid;
    for (let n = 0; at && at !== boardUid && n < 64; n++) {
      const item = board?.items.get(at);
      if (!item) break;
      if (item.type === "section") {
        const b = readBinding(api.rawPlexus(at));
        if (b) out.push(b);
      }
      at = item.parentUid;
    }
    return out;
  };

  // The block a card writes to and what it holds now. Cards only; page cards, boards, sections, text, edges and
  // PDF page cards have no target.
  const targetOf = (id) => {
    const item = api.board()?.items.get(id);
    if (!item || item.type !== "card") return null;
    const target = item.target;
    if (target?.kind === "self") {
      const node = api.rawNode(item.uid);
      if (!node) return null;
      const kids = api.kidsOf(node);
      return { uid: item.uid, string: String(node[STR] ?? node.string ?? ""), kids };
    }
    if (target?.kind === "block" && target.uid && !target.page) {
      let string = null;
      try { string = host.blockString?.(target.uid); } catch { string = null; }
      if (typeof string !== "string") return null;
      let kids = [];
      try {
        const node = host.pullTree?.(target.uid, 1, 500);
        kids = Array.isArray(node) ? node : Array.isArray(node?.[KIDS]) ? node[KIDS] : [];
      } catch { kids = []; }
      return { uid: target.uid, string, kids };
    }
    return null;
  };

  const rowOf = (target) => ({ uid: target.uid, string: target.string, attrs: attrsOfKids(target.kids) });

  const kidString = (target, uid) => {
    const kid = target.kids.find((k) => (k[UID] ?? k.uid) === uid);
    return String(kid?.[STR] ?? kid?.string ?? "");
  };

  // Emits one plan through the txn and pushes its inverse.
  const emitPlan = (t, plan, target, undo) => {
    if (plan.op === "string") {
      const prev = plan.uid === target.uid ? target.string : kidString(target, plan.uid);
      t.string(plan.uid, plan.string);
      undo.push({ op: "string", uid: plan.uid, string: prev });
    } else if (plan.op === "create") {
      const id = t.create({ parent: plan.parent, string: plan.string, order: "last" });
      undo.push({ op: "delete", uid: id });
    } else if (plan.op === "delete") {
      const at = target.kids.findIndex((k) => (k[UID] ?? k.uid) === plan.uid);
      t.del(plan.uid);
      undo.push({ op: "create", uid: plan.uid, parent: target.uid, order: at >= 0 ? at : "last", string: kidString(target, plan.uid) });
    }
  };

  const cardsUnder = (id) => {
    const board = api.board();
    const item = board?.items.get(id);
    if (!item) return [];
    if (item.type === "section") return [...descendantsOf(board, id)].filter((d) => board.items.get(d)?.type === "card");
    return item.type === "card" ? [id] : [];
  };

  api.onMoveItems((t, moves, track) => {
    const seen = new Set();
    for (const m of moves) {
      const before = chainOf(m.from);
      const after = chainOf(m.to);
      if (!before.length && !after.length) continue;
      for (const id of cardsUnder(m.uid)) {
        const target = targetOf(id);
        if (!target || seen.has(target.uid)) continue;
        seen.add(target.uid);
        for (const plan of planChainChange(before, after, rowOf(target))) emitPlan(t, plan, target, track.undo);
      }
    }
  });

  session.sectionBinding = (id) => {
    if (api.board()?.items.get(id)?.type !== "section") return null;
    return readBinding(api.rawPlexus(id));
  };

  // binding null unbinds. Layout writes keep the key: itemPlexus carries keys it does not know.
  session.bindSection = (id, binding) => {
    if (api.board()?.items.get(id)?.type !== "section") return Promise.resolve(false);
    const base = api.itemPlexus(id, {});
    const current = readBinding(base);
    if (binding ? current && bindingKey(current) === bindingKey(binding) : !base.bucket) return Promise.resolve(false);
    const { bucket: _gone, ...rest } = base;
    const next = binding ? { ...rest, bucket: binding.kind === "tag" ? { kind: "tag", tag: binding.tag } : { kind: "attr", name: binding.name, value: binding.value } } : rest;
    return api.txn((t) => { t.props(id, next); return true; }).then((ok) => ok === true);
  };

  // Tags every card in the bound section (and the sections inside it). Chunks of 45 writes, one transaction each.
  session.writeSectionToGraph = async (id) => {
    const binding = session.sectionBinding(id);
    if (!binding) return 0;
    const jobs = [];
    const seen = new Set();
    for (const cid of cardsUnder(id)) {
      const target = targetOf(cid);
      if (!target || seen.has(target.uid)) continue;
      seen.add(target.uid);
      const plan = planBucketAdd(binding, rowOf(target));
      if (plan) jobs.push({ plan, target });
    }
    const label = bindingLabel(binding);
    if (!jobs.length) {
      api.emit("toast", { message: seen.size ? `Every card already has ${label}` : "No cards to tag" });
      return 0;
    }
    let written = 0;
    for (const part of chunk(jobs)) {
      await api.txn((t) => { for (const { plan, target } of part) emitPlan(t, plan, target, []); });
      written += part.length;
    }
    api.emit("toast", { message: `Tagged ${written} card${written === 1 ? "" : "s"} with ${label}` });
    return written;
  };
});
