export const DIAGRAM_MARKER = /\{\{\s*(\[\[)?diagram/i;
export const MAX_GUARD_UIDS = 2000;
export const ENHANCED_UID_CACHE_PREFIX = "plexus-diagram:enhanced-uids:";
export const PREPAINT_STYLE_ID = "plexus-diagram-prepaint-guard";
export const PENDING_CLASS = "pxd-native-pending";
export const NATIVE_HIDDEN_CLASS = "pxd-native-hidden";

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
    selectors.push(
      `[id$="${escaped}"] .rm-diagram:not(.${NATIVE_HIDDEN_CLASS})`,
      `.rm-block-ref[data-uid="${escaped}"] .rm-diagram:not(.${NATIVE_HIDDEN_CLASS})`,
      `[data-uid="${escaped}"] .rm-diagram:not(.${NATIVE_HIDDEN_CLASS})`,
    );
  }
  const hideRule = selectors.length
    ? `${selectors.join(",\n")} { visibility: hidden !important; pointer-events: none !important; }`
    : "";
  const pendingRule = unique.length
    ? `.rm-diagram.${PENDING_CLASS}:not(.${NATIVE_HIDDEN_CLASS}) { visibility: hidden !important; }`
    : "";
  return [hideRule, pendingRule].filter(Boolean).join("\n");
}

export function findDiagramUidFromEl(element) {
  if (!element) return null;
  const ref = element.closest?.(".rm-block-ref[data-uid]");
  if (ref?.dataset?.uid) return ref.dataset.uid;
  const host = element.closest?.("[data-uid]");
  if (host?.dataset?.uid) return host.dataset.uid;
  const blockInput = element.closest?.('[id^="block-input-"]');
  if (blockInput?.id) {
    const match = blockInput.id.match(/block-input-.+-body-outline-\d{2}-\d{2}-\d{4}-(.+)$/);
    if (match) return match[1];
  }
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
