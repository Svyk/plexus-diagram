// A board traps overlays. .pxd-root clips overflow, and .pxd-world is transformed, so a
// z-index inside one card cannot paint above a sibling. Never move a node Roam's React
// owns. Body portals stay where Blueprint put them; extension.css is their band, and the
// top bar itself is raised while a board is up. An overlay rendered inside a card
// (inline popover, autocomplete) raises that card above its siblings until the overlay
// is gone. .pxd-root overflow:clip still cuts that popover at the board edge.
// Fullscreen is a fixed layer at z-index 19, under a portal whose inline z-index is 20.
// Nothing here listens for pointer movement. A pan must not walk the document.
// The body observer reads added and removed nodes only, and only while
// body.pxd-has-board is set.

import { notedSpeedFlags } from "../settings.js";

const HOSTS = [
  ".bp3-portal",
  ".bp3-overlay",
  ".bp3-popover",
  ".rm-find-or-create-wrapper",
  ".rm-autocomplete__wrapper",
  ".rm-autocomplete__results",
  ".bp3-datepicker",
  ".rm-date-picker",
  ".bp3-menu",
  ".bp3-context-menu",
];

// card element -> how many overlay hosts inside it are still open.
const raised = new Map();
let hostCard = new WeakMap();
const liveHosts = new Set();

// UX4 B4: Roam wraps every active block textarea in .rm-autocomplete__wrapper, so it is not an overlay. Lifting the
// card on it unclipped every page-card editor for the whole edit, and a long page painted over the board. The
// results list inside it is the overlay. Off (flag editClip): the 3.35.0 host list.
const wrapperIsHost = () => {
  try { return notedSpeedFlags().editClip === false; } catch { return false; }
};

const isHost = (node) => {
  if (!node || node.nodeType !== 1 || typeof node.matches !== "function") return false;
  for (const sel of HOSTS) {
    if (sel === ".rm-autocomplete__wrapper" && !wrapperIsHost()) continue;
    try { if (node.matches(sel)) return true; } catch { /* selector */ }
  }
  return false;
};

export function overlayHost(node) {
  let host = null;
  let cur = node?.nodeType === 1 ? node : node?.parentElement;
  while (cur && cur.nodeType === 1) {
    if (isHost(cur)) host = cur;
    cur = cur.parentElement;
  }
  return host;
}

const trappedInBoard = (node) => {
  if (!node || typeof node.closest !== "function") return false;
  try { return Boolean(node.closest(".pxd-root, .pxd-mount")); } catch { return false; }
};

const claim = (host) => {
  if (!host || hostCard.has(host) || !trappedInBoard(host)) return false;
  let card = null;
  try { card = host.closest?.(".pxd-item") || null; } catch { card = null; }
  if (!card || card === host) return false;
  hostCard.set(host, card);
  liveHosts.add(host);
  raised.set(card, (raised.get(card) || 0) + 1);
  try { card.classList.add("pxd-item--pop"); } catch { /* class */ }
  return true;
};

const unclaim = (host) => {
  const card = hostCard.get(host);
  if (!card) return;
  hostCard.delete(host);
  liveHosts.delete(host);
  const next = (raised.get(card) || 1) - 1;
  if (next > 0) {
    raised.set(card, next);
    return;
  }
  raised.delete(card);
  try { card.classList?.remove("pxd-item--pop"); } catch { /* gone */ }
};

const releaseRaised = () => {
  for (const card of raised.keys()) {
    try { card.classList?.remove("pxd-item--pop"); } catch { /* gone */ }
  }
  raised.clear();
  liveHosts.clear();
  hostCard = new WeakMap();
};

export function liftRoamOverlay(node, doc) {
  if (!doc?.body) return false;
  const host = overlayHost(node);
  if (!host) return false;
  return claim(host);
}

const hostsInside = (node) => {
  if (!node || typeof node.querySelectorAll !== "function") return [];
  const out = [];
  for (const sel of HOSTS) {
    if (sel === ".rm-autocomplete__wrapper" && !wrapperIsHost()) continue;
    let list = [];
    try { list = node.querySelectorAll(sel) || []; } catch { list = []; }
    for (const hit of list) out.push(hit);
  }
  return out;
};

// The added node only. A portal Blueprint appends to the body is not inside a card.
// A wrapper appended inside a card is, and the host may be a child of that wrapper.
const considerAdded = (node, doc) => {
  if (!node || node.nodeType !== 1) return;
  if (isHost(node)) liftRoamOverlay(node, doc);
  if (!trappedInBoard(node)) return;
  for (const hit of hostsInside(node)) liftRoamOverlay(hit, doc);
};

// remove() clears parentElement before the record is delivered, so closest() cannot
// find the card. The host set is the only way back.
const considerRemoved = (node) => {
  if (!node || node.nodeType !== 1 || liveHosts.size === 0) return;
  const hit = [];
  for (const host of liveHosts) {
    if (host === node || node.contains?.(host)) hit.push(host);
  }
  for (const host of hit) unclaim(host);
};

export function installRoamStack(doc) {
  if (!doc?.body || typeof doc.addEventListener !== "function") return () => {};
  let obs = null;
  const view = doc.defaultView || globalThis;
  const Observer = view.MutationObserver || globalThis.MutationObserver;
  const onMut = (records) => {
    if (!doc.body?.classList?.contains?.("pxd-has-board")) return;
    for (const rec of records || []) {
      for (const node of rec.removedNodes || []) considerRemoved(node);
      for (const node of rec.addedNodes || []) considerAdded(node, doc);
    }
  };
  if (typeof Observer === "function") {
    try {
      obs = new Observer(onMut);
      obs.observe(doc.body, { childList: true, subtree: true });
    } catch { obs = null; }
  }
  return () => {
    try { obs?.disconnect?.(); } catch { /* gone */ }
    releaseRaised();
  };
}

export function syncBoardClass(doc, on) {
  const list = doc?.body?.classList;
  if (!list) return;
  const present = Boolean(on);
  if (typeof list.toggle === "function") {
    list.toggle("pxd-has-board", present);
    return;
  }
  if (present) list.add?.("pxd-has-board");
  else list.remove?.("pxd-has-board");
}
