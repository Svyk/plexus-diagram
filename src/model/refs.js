// Linked-reference drawer. The label and the drag payload live here so the view
// and the tests share one function. Roam stays in the host.

export const LINKED_REF_CAP = 20;
const UID_RE = /^[A-Za-z0-9_-]{9}$/;

export function linkedRefLabel(count) {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return n === 1 ? "1 linked reference" : `${n} linked references`;
}

// A drag payload is a block ref. Anything that is not a Roam uid is not a card.
export function linkedRefCard(uid) {
  const s = String(uid ?? "");
  return UID_RE.test(s) ? `((${s}))` : null;
}
