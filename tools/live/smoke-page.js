"use strict";
// In-page steps for tools/live/smoke.mjs. Installed with one eval, then called per step.
// State stays on globalThis so later evals see the same board.
(() => {
  const PAGE = "Plexus Diagram/Test Lab";
  const BOARD_TITLE = "REL-2 smoke";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function field(obj, key) {
    if (!obj || typeof obj !== "object") return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    const colon = key.startsWith(":") ? key : `:${key}`;
    if (Object.prototype.hasOwnProperty.call(obj, colon)) return obj[colon];
    return undefined;
  }

  function readBlock(uid) {
    try {
      return window.roamAlphaAPI.data.pull(
        "[:block/uid :block/string :edit/time :block/props {:block/children [:block/uid]}]",
        [":block/uid", uid],
      );
    } catch {
      return null;
    }
  }

  function plexusFields(uid) {
    const props = field(readBlock(uid), "block/props");
    const plexus = field(props, "plexus");
    return {
      v: plexus ? field(plexus, "v") : undefined,
      native: plexus ? field(plexus, "native") === true : false,
    };
  }

  function editTime(uid) {
    const block = readBlock(uid);
    const time = field(block, "edit/time");
    return time == null ? null : time;
  }

  function blockString(uid) {
    return field(readBlock(uid), "block/string") ?? "";
  }

  async function waitFor(pred, ms) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      try {
        const value = await pred();
        if (value) return value;
      } catch { /* poll */ }
      await sleep(100);
    }
    return null;
  }

  async function finish(promise, ms = 3000) {
    if (!promise) return;
    let settled = false;
    let failure = null;
    Promise.resolve(promise).then(() => { settled = true; }, (error) => {
      settled = true;
      failure = error;
    });
    const t0 = performance.now();
    while (!settled && performance.now() - t0 < ms) {
      clickOwnDialog();
      await sleep(100);
    }
    if (!settled) throw new Error("sidebar call timed out");
    if (failure) throw failure;
  }

  function clickOwnDialog() {
    const dialog = document.querySelector(".bp3-dialog");
    if (!dialog) return false;
    const text = dialog.innerText || "";
    if (!text.includes(BOARD_TITLE) || !/close this pinned window/i.test(text)) return false;
    const yes = [...dialog.querySelectorAll("button")].find((node) => /yes, close/i.test(node.textContent || ""));
    if (!yes) return false;
    yes.click();
    return true;
  }

  function windowKey(win) {
    const uid = win?.["block-uid"] || "";
    const type = win?.type || "";
    if (uid) return `${type}:${uid}`;
    const id = win?.["window-id"] || "";
    return id ? String(id) : "";
  }

  function plainWindow(win) {
    return {
      type: win?.type || "",
      "block-uid": win?.["block-uid"] || win?.blockUid || "",
      "window-id": win?.["window-id"] || win?.windowId || "",
    };
  }

  async function readWindows() {
    const api = window.roamAlphaAPI?.ui?.rightSidebar;
    if (!api?.getWindows) return [];
    const list = await api.getWindows();
    return (list || []).map(plainWindow);
  }

  function belongsToBoard(win, boardUid) {
    const uid = String(boardUid || "");
    if (!uid) return false;
    if (String(win?.["block-uid"] || "") === uid) return true;
    return String(win?.["window-id"] || "").includes(uid);
  }

  function addedWindows(before, after, boardUid) {
    const beforeKeys = new Set((before || []).map(windowKey).filter(Boolean));
    return (after || []).filter((win) => belongsToBoard(win, boardUid) && !beforeKeys.has(windowKey(win)));
  }

  function sidebarLeak(before, after, removed) {
    const afterKeys = new Set((after || []).map(windowKey).filter(Boolean));
    const removedKeys = new Set((removed || []).map(windowKey).filter(Boolean));
    const missing = (before || []).map(windowKey).filter((key) => key && !removedKeys.has(key) && !afterKeys.has(key));
    const still = [...removedKeys].filter((key) => afterKeys.has(key));
    if (!missing.length && !still.length) return "";
    return `sidebar windows changed: missing ${missing.length}, left ${still.length}`;
  }

  function findSidebarEl(boardUid, windowId) {
    const sidebar = document.querySelector("#right-sidebar");
    if (!sidebar) return null;
    if (windowId) {
      const byId = document.getElementById(windowId);
      if (byId) return byId;
      const fuzzy = sidebar.querySelector(`.rm-sidebar-window[id*="${CSS.escape(String(windowId))}"]`);
      if (fuzzy) return fuzzy;
    }
    const uid = String(boardUid || "");
    if (!uid) return null;
    const direct = sidebar.querySelector(`.rm-sidebar-window[id*="${CSS.escape(uid)}"]`);
    if (direct) return direct;
    const block = sidebar.querySelector(`[id*="${CSS.escape(uid)}"]`);
    return block ? block.closest(".rm-sidebar-window") : null;
  }

  async function removeAdded(wins, boardUid) {
    const api = window.roamAlphaAPI?.ui?.rightSidebar;
    if (!api?.removeWindow) return;
    for (const win of wins || []) {
      const blockUid = win["block-uid"] || boardUid;
      const type = win.type || "block";
      if (!blockUid) continue;
      const spec = { window: { type, "block-uid": blockUid } };
      try { await finish(api.expandWindow?.(spec)); } catch { /* already expanded */ }
      try { await finish(api.unpinWindow?.(spec)); } catch { /* already unpinned */ }
      try {
        await finish(api.removeWindow(spec));
      } catch {
        const el = findSidebarEl(blockUid, win["window-id"]);
        const cross = el?.querySelector?.(".window-headers .bp3-icon-cross");
        if (cross) cross.click();
        const t0 = performance.now();
        while (performance.now() - t0 < 2000) {
          if (clickOwnDialog()) break;
          await sleep(100);
        }
      }
    }
    clickOwnDialog();
    await sleep(300);
  }

  try { globalThis.__pxdSmoke?.session?.release?.(); } catch { /* first install */ }

  const state = {
    page: PAGE,
    graph: (location.hash.match(/#\/app\/([^/]+)/) || [])[1] || "",
    boardUid: "",
    cardUid: "",
    sectionUid: "",
    session: null,
    fresh: [],
  };
  globalThis.__pxdSmoke = state;

  const note = (uid, why) => {
    if (uid) state.fresh.push({ uid, why });
  };

  const session = () => {
    if (state.session) return state.session;
    const px = window.__plexusDiagram;
    if (!px?.session) throw new Error("no session api");
    state.session = px.session(state.boardUid);
    return state.session;
  };

  function payload(ok, reason) {
    return JSON.stringify({
      ok,
      reason: reason || "",
      page: state.page,
      graph: state.graph,
      uids: state.fresh,
    });
  }

  async function createBoard() {
    const px = window.__plexusDiagram;
    if (!px?.session) return payload(false, "no session api");
    const api = window.roamAlphaAPI;
    let page = api.data.pull("[:block/uid]", [":node/title", PAGE]);
    let pageUid = field(page, "block/uid") || null;
    if (!pageUid) {
      pageUid = api.util.generateUID();
      await api.data.page.create({ page: { title: PAGE, uid: pageUid } });
    }
    const boardUid = api.util.generateUID();
    await api.data.block.create({
      location: { "parent-uid": pageUid, order: "last" },
      block: { uid: boardUid, string: `{{[[diagram]]:${BOARD_TITLE}}}` },
    });
    state.boardUid = boardUid;
    note(boardUid, "board");
    const before = editTime(boardUid);
    if (before == null) return payload(false, "board has no edit/time");
    await api.ui.mainWindow.openBlock({ block: { uid: boardUid } });
    const root = await waitFor(() => document.querySelector(".roam-main .pxd-root"), 8000);
    if (!root) return payload(false, "board did not mount");
    await sleep(400);
    const after = editTime(boardUid);
    if (String(before) !== String(after)) return payload(false, `edit/time changed on open (${before} -> ${after})`);
    const props = plexusFields(boardUid);
    if (props.v != null) return payload(false, "plexus.v was written on open");
    state.session = px.session(boardUid);
    if (state.session?.board?.virtual !== true) return payload(false, "not a virtual board");
    return payload(true);
  }

  async function createCard() {
    const id = await session().createCard({ x: 40, y: 40, string: "Smoke card" });
    if (!id) return payload(false, "createCard returned nothing");
    state.cardUid = id;
    note(id, "card");
    const props = plexusFields(state.boardUid);
    if (props.v !== 2) return payload(false, "first edit did not stamp plexus.v");
    return payload(true);
  }

  async function editText() {
    if (!state.cardUid) return payload(false, "no card");
    await session().setString(state.cardUid, "Smoke card edited");
    const string = blockString(state.cardUid);
    if (string !== "Smoke card edited") return payload(false, `string is ${JSON.stringify(string)}`);
    return payload(true);
  }

  async function addArrow() {
    if (!state.cardUid) return payload(false, "no card");
    const other = await session().createCard({ x: 40, y: 280, string: "Smoke target" });
    if (!other) return payload(false, "second card was not created");
    note(other, "card");
    const edge = await session().addEdge({ from: state.cardUid, to: other, label: "to" });
    const container = session().board?.containerUid;
    if (container) note(container, "connections");
    if (!edge) return payload(false, "addEdge returned nothing");
    note(edge, "arrow");
    if (!session().board?.edges?.has?.(edge)) return payload(false, "arrow is not on the board");
    return payload(true);
  }

  async function addSection() {
    const id = await session().createSection({
      rect: { x: 720, y: 40, w: 520, h: 360 },
      title: "Smoke section",
    });
    if (!id) return payload(false, "createSection returned nothing");
    state.sectionUid = id;
    note(id, "section");
    if (session().board?.items?.get(id)?.type !== "section") return payload(false, "not a section");
    return payload(true);
  }

  async function moveCard() {
    if (!state.cardUid || !state.sectionUid) return payload(false, "no card or section");
    // Center of the 280×160 card lands inside the section. commitMove reparents on that center.
    await session().commitMove([state.cardUid], 600, 40);
    const parent = session().board?.items?.get(state.cardUid)?.parentUid;
    if (parent !== state.sectionUid) {
      const rect = session().rects?.get?.(state.cardUid);
      return payload(false, `parent is ${parent || "missing"} rect ${JSON.stringify(rect)}`);
    }
    return payload(true);
  }

  async function undoMove() {
    await session().undo();
    const item = session().board?.items?.get(state.cardUid);
    if (!item) return payload(false, "undo removed the card");
    if (!session().board?.items?.has(state.sectionUid)) return payload(false, "undo removed the section");
    if (item.parentUid !== state.boardUid) return payload(false, `parent is ${item.parentUid}`);
    return payload(true);
  }

  async function duplicate() {
    if (typeof session().duplicateItems !== "function") return payload(false, "no duplicateItems");
    const made = await session().duplicateItems([state.cardUid]);
    const ids = (made || []).filter((id) => id && id !== state.cardUid);
    if (!ids.length) return payload(false, "duplicate returned nothing");
    for (const id of ids) note(id, "duplicate");
    if (!session().board?.items?.has(ids[0])) return payload(false, "duplicate is not on the board");
    return payload(true);
  }

  async function sidebar() {
    const before = await readWindows();
    let added = [];
    let modeError = "";
    try {
      if (window.PlexusDiagram?.open) await window.PlexusDiagram.open(state.boardUid, { sidebar: true });
      else {
        await window.roamAlphaAPI.ui.rightSidebar.addWindow({
          window: { type: "block", "block-uid": state.boardUid },
        });
      }
      added = await waitFor(async () => {
        const found = addedWindows(before, await readWindows(), state.boardUid);
        return found.length ? found : null;
      }, 5000) || [];
      if (!added.length) {
        modeError = "sidebar did not open a new window";
      } else {
        const el = await waitFor(() => findSidebarEl(state.boardUid, added[0]["window-id"]), 4000);
        const root = el?.querySelector(".pxd-root");
        const boardBtn = root?.querySelector(".pxd-mode__board");
        const outlineBtn = root?.querySelector(".pxd-mode__outline");
        if (!root || !boardBtn || !outlineBtn) modeError = "no sidebar mode button";
        else {
          boardBtn.click();
          if (root.classList.contains("pxd-root--outline")) modeError = "Board mode left the outline view up";
          else {
            outlineBtn.click();
            if (!root.classList.contains("pxd-root--outline")) modeError = "Outline mode did not open";
          }
        }
      }
    } catch (error) {
      modeError = String(error?.message || error);
    }
    try { await removeAdded(added, state.boardUid); }
    catch (error) { modeError = modeError || String(error?.message || error); }
    const after = await readWindows();
    const leak = sidebarLeak(before, after, added);
    if (leak) return payload(false, leak);
    if (modeError) return payload(false, modeError);
    return payload(true);
  }

  async function restoreNative() {
    await session().restoreNative();
    const seen = await waitFor(() => {
      const props = plexusFields(state.boardUid);
      if (props.native !== true || props.v != null) return false;
      const main = document.querySelector(".roam-main");
      const diagram = main?.querySelector(".rm-diagram");
      if (!diagram || diagram.classList.contains("pxd-native-hidden")) return false;
      if (main.querySelector(".pxd-root")) return false;
      return true;
    }, 4000);
    if (!seen) return payload(false, "board did not render native");
    return payload(true);
  }

  const steps = {
    "create-board": createBoard,
    "create-card": createCard,
    "edit-text": editText,
    "add-arrow": addArrow,
    "add-section": addSection,
    "move-card": moveCard,
    undo: undoMove,
    duplicate,
    sidebar,
    "restore-native": restoreNative,
  };

  globalThis.__pxdSmokeStep = async (arg) => {
    if (arg?.op === "release") {
      try { state.session?.release?.(); } catch { /* already released */ }
      state.session = null;
      return JSON.stringify({ ok: true });
    }
    state.fresh = [];
    const fn = steps[arg?.step];
    if (!fn) return payload(false, "unknown step");
    try {
      return await fn();
    } catch (error) {
      return payload(false, String(error?.message || error).replace(/\s+/g, " ").trim());
    }
  };
})();
