// A board traps overlays. .pxd-root clips overflow, and .pxd-world is transformed, so a
// z-index inside one card cannot paint above a sibling. Never move a node Roam's React
// owns. Body portals stay where Blueprint put them; extension.css is their band, and the
// top bar itself is raised while a board is up. An overlay rendered inside a card
// (inline popover, autocomplete) raises that card above its siblings until the overlay
// is gone. .pxd-root overflow:clip still cuts that popover at the board edge.
// Fullscreen is a fixed layer at z-index 40. CSS lifts body portals above it.

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

const TRIGGERS = [
  ".rm-block-ref",
  ".rm-page-ref",
  ".bp3-icon-calendar",
  "#find-or-create-input",
  ".rm-block__input",
  ".bp3-popover-target",
  ".bp3-menu",
];

const LIFT_FRAMES = 12;

// card element -> how many overlay hosts inside it are still open.
const raised = new Map();
let hostCard = new WeakMap();

const isHost = (node) => {
  if (!node || node.nodeType !== 1 || typeof node.matches !== "function") return false;
  for (const sel of HOSTS) {
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
  raised.set(card, (raised.get(card) || 0) + 1);
  try { card.classList.add("pxd-item--pop"); } catch { /* class */ }
  return true;
};

const releaseRaised = () => {
  for (const card of raised.keys()) {
    try { card.classList?.remove("pxd-item--pop"); } catch { /* gone */ }
  }
  raised.clear();
  hostCard = new WeakMap();
};

export function liftRoamOverlay(node, doc) {
  if (!doc?.body) return false;
  const host = overlayHost(node);
  if (!host) return false;
  return claim(host);
}

export function liftRoamOverlays(doc) {
  if (!doc?.querySelectorAll) return 0;
  const seen = new Set();
  const hosts = [];
  for (const sel of HOSTS) {
    let list = [];
    try { list = doc.querySelectorAll(sel) || []; } catch { list = []; }
    for (const node of list) {
      const host = overlayHost(node);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      hosts.push(host);
    }
  }
  let n = 0;
  for (const host of hosts) if (liftRoamOverlay(host, doc)) n += 1;
  return n;
}

const triggered = (target) => {
  if (!target || typeof target.closest !== "function") return false;
  for (const sel of TRIGGERS) {
    try { if (target.closest(sel)) return true; } catch { /* selector */ }
  }
  return false;
};

export function installRoamStack(doc) {
  if (!doc?.body || typeof doc.addEventListener !== "function") return () => {};
  let framesLeft = 0;
  let raf = 0;
  const view = doc.defaultView || globalThis;
  const pump = () => {
    raf = 0;
    try { liftRoamOverlays(doc); } catch { /* overlay */ }
    if (framesLeft <= 0) return;
    framesLeft -= 1;
    if (typeof view.requestAnimationFrame === "function") raf = view.requestAnimationFrame(pump) || 0;
  };
  const kick = () => {
    framesLeft = LIFT_FRAMES;
    if (raf) return;
    if (typeof view.requestAnimationFrame === "function") raf = view.requestAnimationFrame(pump) || 0;
    if (!raf) pump();
  };
  const onTrigger = (event) => {
    if (!triggered(event?.target)) return;
    kick();
  };
  doc.addEventListener("pointerover", onTrigger, true);
  doc.addEventListener("focusin", onTrigger, true);
  doc.addEventListener("pointerdown", onTrigger, true);
  let obs = null;
  const Observer = view.MutationObserver || globalThis.MutationObserver;
  if (typeof Observer === "function") {
    try {
      obs = new Observer(() => kick());
      obs.observe(doc.body, { childList: true });
    } catch { obs = null; }
  }
  return () => {
    try { doc.removeEventListener("pointerover", onTrigger, true); } catch { /* gone */ }
    try { doc.removeEventListener("focusin", onTrigger, true); } catch { /* gone */ }
    try { doc.removeEventListener("pointerdown", onTrigger, true); } catch { /* gone */ }
    try { obs?.disconnect?.(); } catch { /* gone */ }
    if (raf && typeof view.cancelAnimationFrame === "function") view.cancelAnimationFrame(raf);
    raf = 0;
    framesLeft = 0;
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
