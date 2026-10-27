// PXD-12: the board's reading order written back to the real sibling blocks of one source block, and the way back
// (a section that keeps the outline order). Pure: no host, no session.

// Roam's undo holds 50 changes; one chunk is one undo step.
export const SOURCE_ORDER_CHUNK = 45;

// A task's due attribute is a child of the task. It is never moved and never a target.
export const isDueChild = (string) => /^\s*BT_attrDue::/.test(String(string ?? ""));

// cards: [{ target, parent }] in board reading order (parent is the target's Roam parent, "" when unknown).
// The parent with the most cards wins; a tie goes to the parent of the first card. Resolves { parentUid, skipped }.
export function pickSourceParent(cards) {
  const seen = new Set();
  const list = [];
  for (const c of cards || []) {
    if (!c?.target || seen.has(c.target)) continue;
    seen.add(c.target);
    list.push(c);
  }
  const counts = new Map();
  for (const c of list) if (c.parent) counts.set(c.parent, (counts.get(c.parent) || 0) + 1);
  let parentUid = "";
  let best = 0;
  for (const c of list) {
    const n = c.parent ? counts.get(c.parent) : 0;
    if (n > best) { best = n; parentUid = c.parent; }
  }
  return { parentUid, skipped: parentUid ? list.filter((c) => c.parent !== parentUid).length : list.length };
}

// kids: [{ uid, string }] in outline order. targets: uids in board reading order.
// The slots held by target children are refilled with the targets in board order; every other child keeps its place.
// moves: [{ uid, order }] in sequence. Only target blocks move: up to index `order`, or to "last" to get out of the way of
// a sibling that keeps its place. Roam reads a numeric order before removal and this fixture after it; both agree on
// up moves and on "last", so the plan never moves a block down by index.
export function planSourceOrder(kids, targets) {
  const current = (kids || []).map((k) => k.uid);
  const movable = new Set((kids || []).filter((k) => !isDueChild(k.string)).map((k) => k.uid));
  const wanted = [];
  const taken = new Set();
  for (const uid of targets || []) {
    if (!movable.has(uid) || taken.has(uid)) continue;
    taken.add(uid);
    wanted.push(uid);
  }
  const desired = [];
  let next = 0;
  for (const uid of current) desired.push(taken.has(uid) ? wanted[next++] : uid);
  const moves = [];
  const sim = current.slice();
  for (let i = 0; i < desired.length;) {
    if (sim[i] === desired[i]) { i++; continue; }
    const uid = taken.has(desired[i]) ? desired[i] : sim[i];
    const order = uid === desired[i] ? i : "last";
    applyMove(sim, { uid, order });
    moves.push({ uid, order });
  }
  return { current, desired, moves, targets: wanted };
}

function applyMove(list, { uid, order }) {
  list.splice(list.indexOf(uid), 1);
  if (order === "last") list.push(uid);
  else list.splice(order, 0, uid);
}

export function chunkMoves(moves, size = SOURCE_ORDER_CHUNK) {
  const out = [];
  for (let i = 0; i < moves.length; i += size) out.push(moves.slice(i, i + size));
  return out;
}

// The children order after each chunk, starting from `current`: the states an apply passes through.
export function chunkStates(current, chunks) {
  const sim = current.slice();
  const out = [];
  for (const chunk of chunks) {
    for (const m of chunk) applyMove(sim, m);
    out.push(sim.slice());
  }
  return out;
}

// True when uids present in both lists changed their relative order. Adds and deletes alone are not a reorder.
export function orderChanged(prev, next) {
  const a = prev || [];
  const b = next || [];
  const inB = new Set(b);
  const inA = new Set(a);
  const x = a.filter((u) => inB.has(u));
  const y = b.filter((u) => inA.has(u));
  return x.length !== y.length || x.some((u, i) => u !== y[i]);
}

export const orderSignature = (uids) => (uids || []).join("\u0000");

// Card uids in the order of their targets among the parent's children. Cards whose target is not there are left out
// (the tidy appends them in reading order). cards: [{ card, target }].
export function outlineOrderByTarget(childUids, cards) {
  const index = new Map((childUids || []).map((u, i) => [u, i]));
  return (cards || [])
    .filter((c) => index.has(c.target))
    .map((c, i) => ({ card: c.card, at: index.get(c.target), i }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map((c) => c.card);
}
