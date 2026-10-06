// NAV-1. One chip per board under a block Roam already rendered. Read-only.
// Listeners are on document, not on each chip.

import { placePopover, SCAN_CAP, uidFromElementId } from "./relchips.js";

const SKIP = ".pxd-root, .rm-pdf-container, .rm-search-results, .rm-search";
const OPT_OUT = "plexus-no-chips";
const OWN = ".pxd-cardchip-row, .pxd-cardchip, .pxd-cardchip-more, .pxd-cardpop";
const HOVER_GRACE_MS = 250;

export function chipText(title) {
  const name = String(title || "").trim() || "Untitled board";
  return `▦ on ${name}`;
}

function articleOf(node) {
  return node?.closest?.(".roam-article") || null;
}

function optedOut(scope) {
  if (!scope?.querySelectorAll) return false;
  for (const ref of scope.querySelectorAll(".rm-page-ref")) {
    const title = ref.getAttribute?.("data-link-title") || ref.getAttribute?.("data-page-title") || ref.textContent || "";
    if (String(title).replace(/^#/, "").trim() === OPT_OUT) return true;
  }
  return false;
}

// The opt-out answer is read once per article per scan. memo is that scan's Map.
function blocked(node, memo) {
  if (node?.closest?.(SKIP)) return true;
  const page = articleOf(node);
  if (!page) return false;
  if (!memo) return optedOut(page);
  if (!memo.has(page)) memo.set(page, optedOut(page));
  return memo.get(page);
}

function nextAfter(node) {
  return node?.nextElementSibling || null;
}

export function createCardChips({
  doc = globalThis.document,
  cache,
  enabled = () => true,
  pageUid = () => "",
  onOpen,
  onPreview,
} = {}) {
  const chips = new Set();
  const rows = new Set();
  let pop = null;
  let timer = null;
  let closeTimer = null;
  let sweepTimer = null;
  let off = false;
  const sigs = new WeakMap(); // page row -> signature of the boards it shows
  let sweepGen = 0;
  let placeFrame = 0;
  let placeQueue = null;
  const view = () => doc?.defaultView || globalThis;

  const stopSweep = () => {
    sweepGen += 1;
    if (sweepTimer != null) view().clearTimeout?.(sweepTimer);
    sweepTimer = null;
  };

  // One article walk per frame. A burst of title or list inserts shares that walk.
  const cancelPlace = () => {
    placeQueue = null;
    if (!placeFrame) return;
    view().cancelAnimationFrame?.(placeFrame);
    placeFrame = 0;
  };

  const scheduleArticle = (article) => {
    if (!article || article.nodeType !== 1) return;
    if (!placeQueue) placeQueue = new Set();
    placeQueue.add(article);
    if (placeFrame) return;
    const run = () => {
      placeFrame = 0;
      const batch = placeQueue;
      placeQueue = null;
      if (!batch) return;
      if (!isTargetPage()) return;
      for (const page of batch) {
        if (page.isConnected === false) continue;
        placePage(page);
      }
    };
    const raf = view().requestAnimationFrame?.bind(view());
    if (typeof raf !== "function") {
      run();
      return;
    }
    placeFrame = raf(run);
  };

  const closePop = () => {
    if (timer) view().clearTimeout?.(timer);
    timer = null;
    if (closeTimer) view().clearTimeout?.(closeTimer);
    closeTimer = null;
    pop?.remove();
    pop = null;
  };

  const showPop = (chip) => {
    closePop();
    const boardUid = chip.getAttribute?.("data-board") || "";
    const cardUid = chip.getAttribute?.("data-uid") || "";
    let preview = null;
    try { preview = onPreview?.({ boardUid, cardUid }) || null; } catch { preview = null; }
    const el = doc.createElement("div");
    el.className = "pxd-cardpop pxd-root";
    el.style.position = "fixed";
    el.style.width = "320px";
    const title = doc.createElement("div");
    title.className = "pxd-cardpop__title";
    title.textContent = preview?.title || cache?.titleOf?.(boardUid) || "Untitled board";
    el.append(title);
    if (preview?.section) {
      const section = doc.createElement("div");
      section.className = "pxd-cardpop__section";
      section.textContent = preview.section;
      el.append(section);
    }
    if (preview?.svg) el.append(preview.svg);
    const open = doc.createElement("button");
    open.type = "button";
    open.className = "pxd-cardpop__open";
    open.textContent = "Open on board";
    open.addEventListener("click", (event) => {
      event.stopPropagation();
      onOpen?.({ boardUid, cardUid, sidebar: false });
    });
    const side = doc.createElement("button");
    side.type = "button";
    side.className = "pxd-cardpop__side";
    side.textContent = "Open in sidebar";
    side.addEventListener("click", (event) => {
      event.stopPropagation();
      onOpen?.({ boardUid, cardUid, sidebar: true });
    });
    el.append(open, side);
    doc.body?.append(el);
    const rect = chip.getBoundingClientRect?.() || { left: 8, top: 8, right: 40, bottom: 28, width: 32, height: 20 };
    const placed = placePopover({
      anchor: rect,
      size: { w: 320, h: 200 },
      viewport: { left: 0, top: 0, right: view().innerWidth || 800, bottom: view().innerHeight || 600 },
    });
    el.style.left = `${placed.left}px`;
    el.style.top = `${placed.top}px`;
    pop = el;
  };

  const onPointerDown = (event) => {
    const chip = event.target?.closest?.(".pxd-cardchip");
    if (pop && !chip && !event.target?.closest?.(".pxd-cardpop")) closePop();
    if (chip) {
      event.stopPropagation();
      return;
    }
    const area = event.target?.closest?.("textarea");
    const box = area?.closest?.(".roam-block-container");
    if (!box) return;
    for (const child of [...(box.children || [])]) {
      if (child.classList?.contains("pxd-cardchip") || child.classList?.contains("pxd-cardchip-more")) {
        chips.delete(child);
        child.remove();
      }
    }
  };

  const onClick = (event) => {
    const chip = event.target?.closest?.(".pxd-cardchip");
    if (!chip) return;
    event.stopPropagation();
    onOpen?.({
      boardUid: chip.getAttribute?.("data-board") || "",
      cardUid: chip.getAttribute?.("data-uid") || "",
      sidebar: false,
    });
  };

  const onOver = (event) => {
    if (pop && event.target?.closest?.(".pxd-cardpop")) {
      if (closeTimer) view().clearTimeout?.(closeTimer);
      closeTimer = null;
      return;
    }
    const chip = event.target?.closest?.(".pxd-cardchip");
    if (!chip || !chip.classList?.contains("pxd-cardchip")) return;
    if (closeTimer) view().clearTimeout?.(closeTimer);
    closeTimer = null;
    if (timer) view().clearTimeout?.(timer);
    timer = view().setTimeout?.(() => showPop(chip), 200);
  };

  // Leaving a chip or the popover closes it after a short grace, so the pointer can cross into the popover.
  const onOut = (event) => {
    const from = event.target?.closest?.(".pxd-cardchip, .pxd-cardpop");
    if (!from) return;
    if (timer) view().clearTimeout?.(timer);
    timer = null;
    if (event.relatedTarget?.closest?.(".pxd-cardchip, .pxd-cardpop")) return;
    if (!pop) return;
    if (closeTimer) view().clearTimeout?.(closeTimer);
    closeTimer = view().setTimeout?.(() => {
      closeTimer = null;
      closePop();
    }, HOVER_GRACE_MS);
  };

  if (doc?.addEventListener) {
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("click", onClick);
    doc.addEventListener("pointerover", onOver);
    doc.addEventListener("mouseover", onOver);
    doc.addEventListener("pointerout", onOut);
  }

  const makeChip = (boardUid, blockUid) => {
    const chip = doc.createElement("button");
    chip.type = "button";
    chip.className = "pxd-cardchip";
    chip.textContent = chipText(cache?.titleOf?.(boardUid));
    chip.setAttribute("data-board", boardUid);
    chip.setAttribute("data-uid", cache?.cardOn?.(boardUid, blockUid) || blockUid);
    chips.add(chip);
    return chip;
  };

  const fill = (parent, before, blockUid) => {
    const boards = (cache?.boardsOf?.(blockUid) || []).slice(0, 3);
    const wanted = new Set(boards);
    for (const child of [...(parent.children || [])]) {
      const mine = child.classList?.contains("pxd-cardchip") || child.classList?.contains("pxd-cardchip-more");
      if (!mine) continue;
      const board = child.getAttribute?.("data-board") || "";
      if (!wanted.has(board) || child.classList.contains("pxd-cardchip-more")) {
        chips.delete(child);
        child.remove();
      }
    }
    const present = new Set();
    for (const child of parent.children || []) {
      if (child.classList?.contains("pxd-cardchip")) present.add(child.getAttribute?.("data-board") || "");
    }
    for (const boardUid of boards) {
      if (present.has(boardUid)) continue;
      const chip = makeChip(boardUid, blockUid);
      if (before && before.parentElement === parent) parent.insertBefore(chip, before);
      else parent.append(chip);
    }
    const extra = Math.max(0, (cache?.boardsOf?.(blockUid) || []).length - 3);
    if (extra > 0) {
      const more = doc.createElement("span");
      more.className = "pxd-cardchip-more";
      more.textContent = `+${extra}`;
      if (before && before.parentElement === parent) parent.insertBefore(more, before);
      else parent.append(more);
    }
  };

  const attach = (container, memo) => {
    if (!container || container.nodeType !== 1 || container.closest?.(SKIP)) return;
    let uid = container.getAttribute?.("data-block-uid") || "";
    if (!uid) {
      const input = container.querySelector?.("textarea");
      uid = uidFromElementId(input?.id, cache?.targets?.() || new Set()) || "";
    }
    if (!uid || !cache?.hasTarget?.(uid)) return;
    if (blocked(container, memo)) return;
    if (container.querySelector?.(".rm-block-highlight-view, .pxd-boardchip")) return;
    const area = container.querySelector?.("textarea");
    if (area && area === doc.activeElement) {
      for (const child of [...(container.children || [])]) {
        if (child.classList?.contains("pxd-cardchip") || child.classList?.contains("pxd-cardchip-more")) {
          chips.delete(child);
          child.remove();
        }
      }
      return;
    }
    let kids = null;
    for (const child of container.children || []) {
      if (child.classList?.contains("rm-block-children")) kids = child;
    }
    fill(container, kids, uid);
  };

  const outside = (scope, selector) => {
    for (const el of scope.querySelectorAll?.(selector) || []) {
      if (el.closest?.(".pxd-root, .rm-pdf-container, .rm-search-results, .rm-search")) continue;
      if (el.closest?.("h1.rm-title-display")) continue;
      return el;
    }
    return null;
  };

  const placePage = (scope) => {
    if (!scope?.querySelector) return;
    const uid = typeof pageUid === "function" ? pageUid() : "";
    if (!uid || !cache?.hasTarget?.(uid)) return;
    // Under the page title; the references section and the first child list are fallbacks.
    const title = outside(scope, ".rm-title-display-container");
    const header = outside(scope, ".rm-reference-main");
    const kids = outside(scope, ".rm-block-children");
    const page = articleOf(title || header || kids) || scope.querySelector(".roam-article") || scope;
    if (optedOut(page)) return;
    let parent = null;
    let before = null;
    if (title?.parentElement) {
      parent = title.parentElement;
      before = nextAfter(title);
    } else if (header?.parentElement && !header.closest?.("h1.rm-title-display")) {
      parent = header.parentElement;
      before = nextAfter(header);
    } else if (kids && !kids.closest?.("h1.rm-title-display")) {
      parent = kids;
      before = kids.firstChild;
    }
    if (!parent || parent.closest?.("h1.rm-title-display") || parent.matches?.("h1, h1.rm-title-display")) return;
    let row = null;
    for (const child of parent.children || []) {
      if (child.classList?.contains("pxd-cardchip-row")) row = child;
    }
    if (!row) {
      row = doc.createElement("div");
      row.className = "pxd-cardchip-row";
      if (before && before.parentElement === parent) parent.insertBefore(row, before);
      else if (parent === kids) parent.insertBefore(row, kids.firstChild);
      else parent.append(row);
      rows.add(row);
    }
    const boards = cache.boardsOf(uid) || [];
    const sig = `${uid}\n${boards.map((boardUid) => `${boardUid}:${cache?.titleOf?.(boardUid) || ""}`).join("\n")}`;
    if (sigs.get(row) !== sig) {
      for (const child of [...(row.children || [])]) chips.delete(child);
      row.replaceChildren();
      for (const boardUid of boards.slice(0, 3)) row.append(makeChip(boardUid, uid));
      const extra = boards.length - 3;
      if (extra > 0) {
        const more = doc.createElement("span");
        more.className = "pxd-cardchip-more";
        more.textContent = `+${extra}`;
        row.append(more);
      }
      sigs.set(row, sig);
    }
    for (const old of scope.querySelectorAll(".pxd-cardchip-row") || []) {
      if (old === row) continue;
      for (const child of [...(old.children || [])]) chips.delete(child);
      rows.delete(old);
      old.remove();
    }
  };

  const containersOf = (node) => {
    const list = [];
    if (node.matches?.(".roam-block-container")) list.push(node);
    if (typeof node.querySelectorAll === "function") {
      for (const el of node.querySelectorAll(".roam-block-container")) list.push(el);
    }
    return list;
  };

  // The page row is placed from the title, the references header, the page's
  // first child list, or a chip row. A block Roam inserted while typing is none
  // of those, and must not walk the article.
  const isPageChrome = (node) => {
    if (typeof node.matches !== "function") return false;
    if (node.matches(".rm-title-display-container, h1.rm-title-display, .rm-title-display")) return true;
    return node.matches(".rm-reference-main") && !node.closest?.("h1.rm-title-display");
  };

  const isPageChildList = (node) => {
    if (typeof node.matches !== "function" || !node.matches(".rm-block-children")) return false;
    if (node.closest?.("h1.rm-title-display")) return false;
    if (node.parentElement?.closest?.(".rm-block-children")) return false;
    return Boolean(articleOf(node));
  };

  // The current page is read when the placement runs, not when the node arrives: during
  // navigation Roam inserts the new page before the route reports it.
  const isTargetPage = () => {
    const uid = typeof pageUid === "function" ? pageUid() : "";
    return Boolean(uid && cache?.hasTarget?.(uid));
  };
  const refreshPage = (node) => {
    if (node === doc.body || node === doc.documentElement || node.matches?.(".roam-app")) {
      if (!isTargetPage()) return;
      for (const article of node.querySelectorAll?.(".roam-article") || []) placePage(article);
      return;
    }
    if (node.matches?.(".roam-article")) {
      if (isTargetPage()) placePage(node);
      return;
    }
    if (node.matches?.(".pxd-cardchip-row") || isPageChrome(node) || isPageChildList(node)) {
      scheduleArticle(articleOf(node));
      return;
    }
    // Any other insert: one scoped check per article per frame, and only while its row is missing.
    const article = articleOf(node) || node.querySelector?.(".roam-article");
    if (article && !article.querySelector?.(".pxd-cardchip-row")) scheduleArticle(article);
  };

  // Each turn attaches at most SCAN_CAP containers. The rest wait on a timer
  // so a long outline does not write hundreds of chips in one pass. A scan
  // that arrives while that timer is armed still refreshes the first cap,
  // and leaves the queued walk alone so the tail is not starved.
  const scan = (node) => {
    if (enabled() === false) {
      if (off) return;
      off = true;
      cancelPlace();
      stopSweep();
      disposeChips();
      return;
    }
    off = false;
    if (!node || node.nodeType !== 1) return;
    // A chip row is page chrome. Its descendants are not, and scanning them rebuilds the row.
    if (node.matches?.(".pxd-cardchip-row")) {
      refreshPage(node);
      return;
    }
    // Chips this module wrote come back through the mutation observer. They are not page content.
    if (node.closest?.(OWN)) return;
    const memo = new Map();
    const list = containersOf(node);
    const end = Math.min(SCAN_CAP, list.length);
    for (let i = 0; i < end; i += 1) attach(list[i], memo);
    refreshPage(node);
    if (list.length <= SCAN_CAP || sweepTimer != null) return;
    const gen = sweepGen;
    const pending = list;
    const run = (start) => {
      if (gen !== sweepGen) return;
      const next = Math.min(start + SCAN_CAP, pending.length);
      for (let i = start; i < next; i += 1) attach(pending[i], memo);
      if (next >= pending.length) return;
      const set = view().setTimeout?.bind(view());
      if (!set) return;
      sweepTimer = set(() => {
        sweepTimer = null;
        run(next);
      }, 0);
    };
    const set = view().setTimeout?.bind(view());
    if (!set) return;
    sweepTimer = set(() => {
      sweepTimer = null;
      run(end);
    }, 0);
  };

  const disposeChips = () => {
    closePop();
    for (const chip of chips) chip.remove();
    chips.clear();
    for (const row of rows) row.remove();
    rows.clear();
    const body = doc?.body;
    if (!body?.querySelectorAll) return;
    for (const el of body.querySelectorAll(".pxd-cardchip, .pxd-cardchip-more, .pxd-cardchip-row, .pxd-cardpop")) el.remove();
  };

  const dispose = () => {
    cancelPlace();
    stopSweep();
    if (doc?.removeEventListener) {
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("click", onClick);
      doc.removeEventListener("pointerover", onOver);
      doc.removeEventListener("mouseover", onOver);
      doc.removeEventListener("pointerout", onOut);
    }
    disposeChips();
  };

  return { scan, dispose, count: () => chips.size };
}
