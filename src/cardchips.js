// NAV-1. One chip per board under a block Roam already rendered. Read-only.
// Listeners are on document, not on each chip.

import { placePopover, SCAN_CAP, uidFromElementId } from "./relchips.js";

const SKIP = ".pxd-root, .rm-pdf-container, .rm-search-results, .rm-search";
const OPT_OUT = "plexus-no-chips";

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

function blocked(node) {
  if (node?.closest?.(SKIP)) return true;
  const page = articleOf(node);
  return page ? optedOut(page) : false;
}

function nextAfter(node) {
  const parent = node?.parentElement;
  if (!parent?.children) return null;
  const index = parent.children.indexOf(node);
  return index >= 0 ? parent.children[index + 1] || null : null;
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
  let sweepTimer = null;
  let sweepGen = 0;
  const view = () => doc?.defaultView || globalThis;

  const stopSweep = () => {
    sweepGen += 1;
    if (sweepTimer != null) view().clearTimeout?.(sweepTimer);
    sweepTimer = null;
  };

  const closePop = () => {
    if (timer) view().clearTimeout?.(timer);
    timer = null;
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
    const chip = event.target?.closest?.(".pxd-cardchip");
    if (!chip || !chip.classList?.contains("pxd-cardchip")) return;
    if (timer) view().clearTimeout?.(timer);
    timer = view().setTimeout?.(() => showPop(chip), 200);
  };

  const onOut = (event) => {
    const chip = event.target?.closest?.(".pxd-cardchip");
    if (!chip) return;
    if (timer) view().clearTimeout?.(timer);
    timer = null;
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

  const attach = (container) => {
    if (!container || container.nodeType !== 1 || blocked(container)) return;
    let uid = container.getAttribute?.("data-block-uid") || "";
    if (!uid) {
      const input = container.querySelector?.("textarea");
      uid = uidFromElementId(input?.id, cache?.targets?.() || new Set()) || "";
    }
    if (!uid || !cache?.hasTarget?.(uid)) return;
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
    const header = outside(scope, ".rm-reference-main");
    const kids = outside(scope, ".rm-block-children");
    const page = articleOf(header || kids) || scope.querySelector(".roam-article") || scope;
    if (optedOut(page)) return;
    let parent = null;
    let before = null;
    if (header?.parentElement && !header.closest?.("h1.rm-title-display")) {
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
    for (const child of [...(row.children || [])]) chips.delete(child);
    row.replaceChildren();
    const boards = cache.boardsOf(uid) || [];
    for (const boardUid of boards.slice(0, 3)) row.append(makeChip(boardUid, uid));
    const extra = boards.length - 3;
    if (extra > 0) {
      const more = doc.createElement("span");
      more.className = "pxd-cardchip-more";
      more.textContent = `+${extra}`;
      row.append(more);
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

  // Each turn attaches at most SCAN_CAP containers. The rest wait on a timer
  // so a long outline does not write hundreds of chips in one pass. A scan
  // that arrives while that timer is armed still refreshes the first cap,
  // and leaves the queued walk alone so the tail is not starved.
  const scan = (node) => {
    if (enabled() === false) {
      stopSweep();
      disposeChips();
      return;
    }
    if (!node || node.nodeType !== 1) return;
    const list = containersOf(node);
    const end = Math.min(SCAN_CAP, list.length);
    for (let i = 0; i < end; i += 1) attach(list[i]);
    placePage(doc.body || node);
    if (list.length <= SCAN_CAP || sweepTimer != null) return;
    const gen = sweepGen;
    const pending = list;
    const run = (start) => {
      if (gen !== sweepGen) return;
      const next = Math.min(start + SCAN_CAP, pending.length);
      for (let i = start; i < next; i += 1) attach(pending[i]);
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
