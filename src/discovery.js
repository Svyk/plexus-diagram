import { readPlexus, SCHEMA_VERSION } from "./model/schema.js";

export const DIAGRAM_MARKER = /\{\{\s*(\[\[)?diagram/i;
export const MAX_GUARD_UIDS = 2000;
export const ENHANCED_UID_CACHE_PREFIX = "plexus-diagram:enhanced-uids:";
export const PREPAINT_STYLE_ID = "plexus-diagram-prepaint-guard";
export const PENDING_CLASS = "pxd-native-pending";
export const NATIVE_HIDDEN_CLASS = "pxd-native-hidden";
export const OUTLINE_NATIVE_CLASS = "pxd-outline-native";

export function isDiagramString(value) {
  return DIAGRAM_MARKER.test(String(value ?? ""));
}

export function cssAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

export function graphCacheKey(locationHash = globalThis.location?.hash || "") {
  const match = String(locationHash).match(/#\/app\/([^/]+)/);
  return match ? `${ENHANCED_UID_CACHE_PREFIX}${match[1]}` : `${ENHANCED_UID_CACHE_PREFIX}unknown`;
}
export function diagramUidFromLocation(hash = globalThis.location?.hash || "") {
  const match = String(hash).match(/#\/app\/[^/]+\/page\/([^/?#]+)/);
  return match ? match[1] : null;
}

// Native Maximize dies when the house / daily tab changes the route. The overlay
// mount often *survives* (the block is still in the daily outline), so fullscreen
// must be torn down whenever the open page uid is no longer this diagram.
export function routeLeftZoomedDiagram(diagramUid, hash = globalThis.location?.hash || "") {
  if (!diagramUid) return true;
  return diagramUidFromLocation(hash) !== diagramUid;
}

export function readEnhancedUidCache(storage = globalThis.localStorage, key = graphCacheKey()) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(String).filter(Boolean).sort());
  } catch {
    return new Set();
  }
}

export function writeEnhancedUidCache(uids, storage = globalThis.localStorage, key = graphCacheKey()) {
  const sorted = [...new Set([...uids].map(String).filter(Boolean))].sort();
  storage?.setItem?.(key, JSON.stringify(sorted));
  return sorted;
}

export function enhancedUidGuardCss(uids) {
  const selectors = [];
  const unique = [...new Set([...uids].map(String).filter(Boolean))].sort();
  if (unique.length > MAX_GUARD_UIDS) {
    console.warn(`[plexus-diagram] Skipping the pre-paint guard: ${unique.length} cached diagram uids exceeds the ${MAX_GUARD_UIDS} cap`);
    return "";
  }
  for (const uid of unique) {
    const escaped = cssAttributeValue(uid);
    for (const host of [
      `[id$="${escaped}"]`,
      `[data-uid="${escaped}"]`,
      `.rm-block-ref[data-uid="${escaped}"]`,
    ]) {
      selectors.push(
        `${host} .rm-diagram:not(.${NATIVE_HIDDEN_CLASS}):not(.${OUTLINE_NATIVE_CLASS})`,
        `${host} .rm-diagram-title-panel:not(.${OUTLINE_NATIVE_CLASS})`,
        `${host} .react-flow:not(.${OUTLINE_NATIVE_CLASS} *)`,
      );
    }
  }
  // display:none is load-bearing: React Flow nodes re-set visibility:visible on
  // themselves, so a visibility guard leaves native chrome painted over the overlay.
  const hideRule = selectors.length
    ? `${selectors.join(",\n")} { display: none !important; }`
    : "";
  const pendingRule = unique.length
    ? `.rm-diagram.${PENDING_CLASS}:not(.${NATIVE_HIDDEN_CLASS}):not(.${OUTLINE_NATIVE_CLASS}) { visibility: hidden !important; pointer-events: none !important; }`
    : "";
  return [hideRule, pendingRule].filter(Boolean).join("\n");
}

// Roam block input ids are `block-input-<window>-body-outline-<page>-<uid>` (plus dated and
// sidebar variants) and uids may contain "-", so the only unambiguous parse is to try each
// "-" suffix, shortest first, and keep the first one that names a diagram block.
export function uidFromBlockInputId(id, isDiagramUid) {
  const value = String(id || "");
  const prefix = "block-input-";
  if (!value.startsWith(prefix) || typeof isDiagramUid !== "function") return null;
  for (let i = value.length - 1; i >= prefix.length; i -= 1) {
    if (value[i] !== "-") continue;
    const candidate = value.slice(i + 1);
    if (candidate && isDiagramUid(candidate)) return candidate;
  }
  return null;
}

export const BLOCK_CONTAINER_SELECTOR = ".roam-block-container";

export function directChildWithClass(element, className) {
  for (const child of element?.children || []) {
    if (child.classList?.contains(className)) return child;
  }
  return null;
}

// The block a .roam-block-container renders: its .rm-block-main holds the block's own input first.
export function blockContainerUid(container, isDiagramUid) {
  const main = directChildWithClass(container, "rm-block-main");
  const input = main?.querySelector?.('[id^="block-input-"]');
  return uidFromBlockInputId(input?.id, isDiagramUid);
}

// Roam renders {{[[embed]]: ((uid))}} inside one of these. The nearest match is this copy.
const EMBED_WRAP_SELECTORS = [".rm-embed-container", ".block-embed", ".rm-embed"];
const EMBED_REF = /\{\{(?:\[\[embed\]\]|embed):\s*\(\(([A-Za-z0-9_-]+)\)\)/;

// Block uids may contain "-". The owner is the longest suffix of the outline id
// whose block string is the embed macro, not the last segment (`uyXFLc-bf` is one uid).
function embedOwnerFromInputId(id, readString) {
  const value = String(id || "");
  if (!value.startsWith("block-input-")) return "";
  const mark = "-body-outline-";
  const at = value.lastIndexOf(mark);
  if (at < 0) return "";
  const tail = value.slice(at + mark.length);
  if (!tail) return "";
  const candidates = [];
  for (let i = 0; i < tail.length; i += 1) {
    if (i === 0 || tail[i - 1] === "-") candidates.push(tail.slice(i));
  }
  candidates.sort((a, b) => b.length - a.length);
  if (typeof readString !== "function") return candidates[candidates.length - 1] || "";
  for (const candidate of candidates) {
    let string = "";
    try { string = String(readString(candidate) ?? ""); } catch { string = ""; }
    if (EMBED_REF.test(string)) return candidate;
  }
  return "";
}

function firstBlockInputId(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.shift();
    if (String(node?.id || "").startsWith("block-input-")) return node.id;
    const kids = node?.children || [];
    for (let i = 0; i < kids.length; i += 1) stack.push(kids[i]);
  }
  return "";
}

export function embedWrap(native) {
  if (!native?.closest) return null;
  for (const sel of EMBED_WRAP_SELECTORS) {
    const hit = native.closest(sel);
    if (hit) return hit;
  }
  return null;
}

// Uid of the block that holds the embed. Null when this diagram is the board itself.
// A missing wrap still counts when an ancestor block's string is the embed macro,
// so a copy Roam did not tag still gets its own viewport.
export function embedOwnerUid(native, readString) {
  const wrap = embedWrap(native);
  if (wrap) {
    let node = wrap.parentElement;
    while (node) {
      const uid = embedOwnerFromInputId(node.id, readString);
      if (uid) return uid;
      node = node.parentElement;
    }
    return "embed";
  }
  if (typeof readString !== "function") return null;
  let node = native?.parentElement;
  while (node) {
    if (node.matches?.(".roam-block-container")) {
      const uid = embedOwnerFromInputId(firstBlockInputId(node), readString);
      if (uid) {
        let string = "";
        try { string = String(readString(uid) ?? ""); } catch { string = ""; }
        if (EMBED_REF.test(string)) return uid;
      }
    }
    node = node.parentElement;
  }
  return null;
}

// The element that means "this copy". Two diagrams in one copy share it.
export function embedScope(native, readString) {
  const wrap = embedWrap(native);
  if (wrap) return wrap;
  const owner = embedOwnerUid(native, readString);
  if (!owner || owner === "embed") return null;
  let node = native?.parentElement;
  while (node) {
    if (node.matches?.(".roam-block-container") && embedOwnerFromInputId(firstBlockInputId(node), readString) === owner) return node;
    node = node.parentElement;
  }
  return null;
}

// Board uid named by the embed block. Null when this native is not an embed.
export function embedBoardUid(native, readString) {
  const owner = embedOwnerUid(native, readString);
  if (!owner || owner === "embed" || typeof readString !== "function") return null;
  let string = "";
  try { string = String(readString(owner) ?? ""); } catch { return null; }
  const match = EMBED_REF.exec(string);
  return match ? match[1] : null;
}

export function findDiagramUidFromEl(element, isDiagramUid) {
  if (!element) return null;
  const ref = element.closest?.(".rm-block-ref[data-uid]");
  if (ref?.dataset?.uid) return ref.dataset.uid;
  const blockInput = element.closest?.('[id^="block-input-"]');
  const resolved = uidFromBlockInputId(blockInput?.id, isDiagramUid);
  if (resolved) return resolved;
  if (blockInput?.id) {
    // Dated zoomed outline ids come first: block-input-<window>-body-outline-MM-DD-YYYY-<uid>.
    const dated = blockInput.id.match(/block-input-.+-body-outline-\d{2}-\d{2}-\d{4}-(.+)$/);
    if (dated) return dated[1];
    const zoomed = blockInput.id.match(/block-input-.+-body-outline-(.+)$/);
    // Reject a leading date so the looser pattern never captures "MM-DD-YYYY[-<uid>]".
    if (zoomed && !/^\d{2}-\d{2}-\d{4}(-|$)/.test(zoomed[1])) return zoomed[1];
  }
  // On a zoomed block page the hash names the zoomed block; trust it when the id parse is ambiguous.
  if (element.closest?.(".rm-zoom-block-wrapper")) {
    const pageUid = diagramUidFromLocation();
    if (pageUid) return pageUid;
  }
  const host = element.closest?.("[data-uid]");
  if (host?.dataset?.uid) return host.dataset.uid;
  return null;
}

export function diagramElForUid(uid, root = globalThis.document) {
  if (!uid || !root?.querySelector) return null;
  const escaped = (globalThis.CSS?.escape || String)(String(uid));
  return root.querySelector(`[id$="${escaped}"] .rm-diagram`)
    || root.querySelector(`[data-uid="${escaped}"] .rm-diagram`)
    || root.querySelector(`.rm-block-ref[data-uid="${escaped}"] .rm-diagram`);
}

export function waitForDiagramEl(uid, { timeout = 2500, root = globalThis.document } = {}) {
  const immediate = diagramElForUid(uid, root) || root?.querySelector?.(".rm-diagram");
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (node) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      clearInterval(interval);
      clearTimeout(timer);
      resolve(node || null);
    };
    const tick = () => {
      const node = diagramElForUid(uid, root) || root?.querySelector?.(".rm-diagram");
      if (node) finish(node);
    };
    const Mutation = globalThis.MutationObserver;
    const observer = typeof Mutation === "function" && root?.body
      ? new Mutation((records) => {
        for (const record of records) {
          for (const added of record.addedNodes || []) {
            if (added.nodeType !== 1) continue;
            if (added.matches?.(".rm-diagram") || added.querySelector?.(".rm-diagram")) {
              tick();
              return;
            }
          }
        }
      })
      : null;
    observer?.observe(root.body, { childList: true, subtree: true });
    const interval = setInterval(tick, 50);
    const timer = setTimeout(() => finish(null), timeout);
  });
}

export function diagramsWithin(root) {
  if (!root) return [];
  const values = [];
  if (root.matches?.(".rm-diagram")) values.push(root);
  for (const diagram of root.querySelectorAll?.(".rm-diagram") || []) {
    if (!values.includes(diagram)) values.push(diagram);
  }
  return values;
}

export function diagramInstanceInfo(nativeElement, enhancedUids = new Set()) {
  if (!nativeElement?.classList?.contains?.("rm-diagram")) return null;
  const uid = findDiagramUidFromEl(nativeElement);
  if (!uid || !enhancedUids.has(uid)) return null;
  return { uid, nativeElement };
}

export function isEnhancedProps(pulledProps) {
  return readPlexus(pulledProps)?.v === SCHEMA_VERSION;
}

// Synchronous truth read: the board block's own props decide whether it is enhanced.
export function readEnhanced(api, uid) {
  if (!uid) return false;
  try {
    const pulled = api?.data?.pull?.("[:block/props]", [":block/uid", uid]);
    return isEnhancedProps(pulled?.[":block/props"] ?? pulled?.props ?? null);
  } catch {
    return false;
  }
}

// A direct child with stored Plexus layout means the diagram was a board before (restored without the marker).
export function storedLayoutIn(children) {
  for (const child of Array.isArray(children) ? children : []) {
    const stored = readPlexus(child?.[":block/props"] ?? child?.props);
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) return true;
  }
  return false;
}

// Auto mode: "virtual" mounts a board without writing, "convert" keeps the native
// diagram and offers a button, null means nothing to do (v2, or restored with the marker).
export function autoEligibility({ plexus, nativeNodeCount = 0, storedLayout = false } = {}) {
  if (plexus?.v === SCHEMA_VERSION) return null;
  if (plexus?.native === true) return null;
  if (nativeNodeCount > 0 || storedLayout) return "convert";
  return "virtual";
}
