// Roam paints [[ / (( / slash menus as a screen-space popover. Inside a zoomed board that
// popover either sits in the scaled world (clipped by overflow, grown by the zoom) or keeps the
// position it computed before the zoom. While a card editor is focused, pin the menu to the
// anchor's screen box and take it out of the board.
//
// A date picker is portaled to the document. Blueprint places it with a transform, and that
// transform ignores the board's scale, so the calendar misses the button. Clear those ancestor
// transforms and pin the one calendar Blueprint actually positioned.

const MENU_SELECTOR = ".rm-autocomplete__results, .bp3-datepicker, .rm-date-picker";
const claimed = new WeakSet();
let menuSerial = 0;
const menuIdentity = new WeakMap();

const computedTransform = (node) => {
  if (!node) return "";
  const view = node.ownerDocument?.defaultView || globalThis;
  const cs = view.getComputedStyle?.(node);
  if (!cs) return node.style?.transform || "";
  if (typeof cs.transform === "string" && cs.transform) return cs.transform;
  const raw = typeof cs.getPropertyValue === "function" ? cs.getPropertyValue("transform") : "";
  return raw || "";
};

// A translation means Blueprint positioned this portal. An identity matrix is just a
// containing block on an idle picker and is not one we should grab.
const portalShift = (menu) => {
  let node = menu?.parentElement;
  const stop = menu?.ownerDocument?.body;
  while (node && node !== stop) {
    const tf = computedTransform(node);
    const parts = /matrix\(([^)]+)\)/.exec(tf || "");
    if (parts) {
      const n = parts[1].split(",").map((s) => Number(s.trim()));
      const x = n[4] || 0;
      const y = n[5] || 0;
      if (Math.abs(x) > 1 || Math.abs(y) > 1) return { x, y };
    }
    node = node.parentElement;
  }
  return null;
};

const releaseAncestorTransforms = (menu) => {
  let node = menu?.parentElement;
  const stop = menu?.ownerDocument?.body;
  while (node && node !== stop) {
    if (computedTransform(node) && computedTransform(node) !== "none") {
      node.style?.setProperty?.("transform", "none", "important");
    }
    // Blueprint's portal covers the window. A cleared transform leaves that layer
    // catching wheels and clicks meant for the board. The calendar itself stays clickable.
    if (typeof node.matches === "function" && node.matches(".bp3-overlay, .bp3-transition-container, .bp3-portal")) {
      node.style?.setProperty?.("pointer-events", "none", "important");
    }
    node = node.parentElement;
  }
  menu?.style?.setProperty?.("pointer-events", "auto", "important");
};

const pin = (menu, left, top) => {
  const style = menu?.style;
  if (!style?.setProperty) return;
  style.setProperty("position", "fixed", "important");
  style.setProperty("transform", "none", "important");
  style.setProperty("margin", "0", "important");
  style.setProperty("zoom", "1", "important");
  style.setProperty("z-index", "4000", "important");
  style.setProperty("left", `${Math.round(left)}px`, "important");
  style.setProperty("top", `${Math.round(top)}px`, "important");
};

export function placeEditorMenus(doc, anchor) {
  if (!doc || !anchor || typeof anchor.getBoundingClientRect !== "function") return 0;
  const box = anchor.getBoundingClientRect();
  if (!box || !((box.width || 0) > 0 || (box.height || 0) > 0)) return 0;
  const view = doc.defaultView || globalThis;
  const viewW = Number(view.innerWidth) || 0;
  const viewH = Number(view.innerHeight) || 0;
  const anchorIsField = typeof anchor.matches === "function"
    && (anchor.matches("textarea") || anchor.matches(".rm-block__input"));
  const anchorInBoard = Boolean(anchor.closest?.(".pxd-root"));
  let placed = 0;
  let nearest = null;
  let nearestD = Infinity;

  const pinAtAnchor = (menu) => {
    const width = Number(menu.offsetWidth) || Number(menu.getBoundingClientRect?.().width) || 320;
    const height = Number(menu.offsetHeight) || Number(menu.getBoundingClientRect?.().height) || 0;
    let left = box.left;
    let top = box.bottom + 2;
    if (viewW && left + width > viewW - 8) left = Math.max(8, viewW - width - 8);
    if (viewH && height && top + height > viewH - 8) top = Math.max(8, box.top - height - 2);
    pin(menu, left, top);
    placed += 1;
  };

  for (const menu of doc.querySelectorAll?.(MENU_SELECTOR) || []) {
    if (!menu || menu === anchor) continue;
    const pageMenu = typeof menu.matches === "function" && menu.matches(".rm-autocomplete__results");
    const inBoard = Boolean(menu.closest?.(".pxd-root"));
    if (pageMenu) {
      if (!anchorIsField) continue;
      if (inBoard && doc.body) doc.body.append(menu);
      pinAtAnchor(menu);
      continue;
    }
    if (inBoard) {
      if (doc.body) doc.body.append(menu);
      releaseAncestorTransforms(menu);
      pinAtAnchor(menu);
      continue;
    }
    if (!anchorInBoard) continue;
    const overlay = menu.closest?.(".bp3-overlay");
    const overlayOpen = !overlay
      || overlay.classList?.contains?.("bp3-overlay-open")
      || String(overlay.className || "").includes("bp3-overlay-open");
    if (!overlayOpen) {
      claimed.delete(menu);
      continue;
    }
    if (!claimed.has(menu) && !portalShift(menu)) continue;
    if (claimed.has(menu)) {
      nearest = menu;
      nearestD = 0;
      break;
    }
    const own = menu.getBoundingClientRect?.();
    const d = own ? Math.hypot((own.left || 0) - box.left, (own.top || 0) - box.top) : Infinity;
    if (d < nearestD) {
      nearest = menu;
      nearestD = d;
    }
  }
  if (nearest && (claimed.has(nearest) || nearestD < 900)) {
    claimed.add(nearest);
    releaseAncestorTransforms(nearest);
    pinAtAnchor(nearest);
  }
  return placed;
}

// One pointerup listener and one animation frame per document. Each board registers an
// anchor scoped to its own root. A root that has left the document is dropped on the next
// pointerup or frame, so a leaked renderer stops costing queries.
const menusByDoc = new WeakMap();

function menuHub(doc) {
  let hub = menusByDoc.get(doc);
  if (hub) return hub;
  hub = { doc, entries: [], frame: 0, looping: false, misses: 0, listening: false, onPointer: null, menuSig: "" };
  menusByDoc.set(doc, hub);
  return hub;
}

function menuToken(menu) {
  let token = menuIdentity.get(menu);
  if (token == null) {
    menuSerial += 1;
    token = menuSerial;
    menuIdentity.set(menu, token);
  }
  const overlay = menu.closest?.(".bp3-overlay");
  const open = !overlay
    || overlay.classList?.contains?.("bp3-overlay-open")
    || String(overlay.className || "").includes("bp3-overlay-open");
  return `${token}.${open ? 1 : 0}`;
}

// Identity of the menus plus the anchor box. Style writes are not part of it,
// so a pin we just applied does not look like a new menu on the next frame.
function editorMenuSig(doc, anchor) {
  const box = anchor.getBoundingClientRect?.() || {};
  const n = (value) => Math.round(Number(value) || 0);
  let menus = "";
  for (const menu of doc.querySelectorAll?.(MENU_SELECTOR) || []) {
    if (!menu || menu === anchor) continue;
    menus += `${menuToken(menu)},`;
  }
  return `${n(box.left)},${n(box.top)},${n(box.width)},${n(box.height)}|${menus}`;
}

function stopMenuHub(hub) {
  hub.looping = false;
  const view = hub.doc?.defaultView || globalThis;
  if (hub.frame && typeof view.cancelAnimationFrame === "function") view.cancelAnimationFrame(hub.frame);
  hub.frame = 0;
  hub.menuSig = "";
  if (hub.listening) {
    try { hub.doc.removeEventListener?.("pointerup", hub.onPointer, true); } catch { /* already gone */ }
    hub.listening = false;
  }
}

function pruneMenuHub(hub) {
  const keep = [];
  for (const entry of hub.entries) {
    if (entry?.root && entry.root.isConnected === false) continue;
    keep.push(entry);
  }
  hub.entries = keep;
  if (!keep.length) stopMenuHub(hub);
}

function startMenuLoop(hub) {
  if (hub.looping || !hub.entries.length) return;
  hub.looping = true;
  hub.misses = 0;
  const view = hub.doc?.defaultView || globalThis;
  const tick = () => {
    hub.frame = 0;
    if (!hub.looping) return;
    pruneMenuHub(hub);
    if (!hub.looping || !hub.entries.length) return;
    let anchor = null;
    for (const entry of hub.entries) {
      let next = null;
      try { next = typeof entry.anchor === "function" ? entry.anchor() : null; } catch { next = null; }
      if (next) { anchor = next; break; }
    }
    if (!anchor) {
      hub.menuSig = "";
      hub.misses += 1;
      if (hub.misses > 12) {
        hub.looping = false;
        for (const entry of hub.entries) {
          try { entry.onIdle?.(); } catch { /* caller */ }
        }
        return;
      }
    } else {
      hub.misses = 0;
      // The caret and the menu set are the only reasons to pin. A steady frame
      // does not write left/top, and it does not read menu layout to decide.
      const sig = editorMenuSig(hub.doc, anchor);
      if (sig !== hub.menuSig) {
        hub.menuSig = sig;
        placeEditorMenus(hub.doc, anchor);
      }
    }
    if (!hub.looping) return;
    const raf = view.requestAnimationFrame;
    if (typeof raf !== "function") return;
    hub.frame = raf(tick);
  };
  tick();
}

function listenMenuHub(hub) {
  if (hub.listening) return;
  hub.onPointer = () => {
    pruneMenuHub(hub);
    if (hub.entries.length) startMenuLoop(hub);
  };
  hub.doc.addEventListener?.("pointerup", hub.onPointer, true);
  hub.listening = true;
}

export function registerEditorMenus(doc, entry) {
  if (!doc || !entry) return () => {};
  const hub = menuHub(doc);
  hub.entries.push(entry);
  listenMenuHub(hub);
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    const i = hub.entries.indexOf(entry);
    if (i >= 0) hub.entries.splice(i, 1);
    if (!hub.entries.length) stopMenuHub(hub);
  };
}

export function nudgeEditorMenus(doc) {
  const hub = doc ? menusByDoc.get(doc) : null;
  if (!hub || !hub.entries.length) return;
  startMenuLoop(hub);
}

export function watchEditorMenus(doc, getAnchor, onIdle) {
  const root = { isConnected: true };
  let live = true;
  const stop = registerEditorMenus(doc, {
    root,
    anchor: () => (live && typeof getAnchor === "function" ? getAnchor() : null),
    onIdle: () => { if (live) onIdle?.(); },
  });
  nudgeEditorMenus(doc);
  return () => {
    live = false;
    stop();
  };
}
