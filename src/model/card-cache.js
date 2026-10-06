// PDF-7 / NAV-1 uid map. Keyed by enhanced-board child uids. No writes.

const REF = /^\(\(([^\s()]+)\)\)$/;
const keyOf = (boardUid, target) => `${boardUid}\0${target}`;

export function createCardCache() {
  const childBoard = new Map();
  const targetBoards = new Map();
  const boards = new Map();
  const titles = new Map();
  const cardBy = new Map();
  // Pulled blocks and pages for the current graph session. A board open fills these
  // from one read; later block and page reads reuse them.
  const reads = new Map();
  const pageReads = new Map();
  const linkedReads = new Map();
  const refBoards = new Map();
  const pageBoards = new Map();
  const refUids = new Set();
  const nativeKnown = new Set();
  const noteBoard = (map, key, boardUid) => {
    if (!key || !boardUid) return;
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(boardUid);
  };

  const drop = (boardUid) => {
    const prev = boards.get(boardUid);
    if (!prev) return;
    for (const child of prev) {
      if (childBoard.get(child.uid) === boardUid) childBoard.delete(child.uid);
      for (const target of child.keys || []) {
        if (cardBy.get(keyOf(boardUid, target)) === child.uid) cardBy.delete(keyOf(boardUid, target));
        const set = targetBoards.get(target);
        if (!set) continue;
        set.delete(boardUid);
        if (set.size === 0) targetBoards.delete(target);
      }
    }
    boards.delete(boardUid);
    titles.delete(boardUid);
  };

  const remember = (boardUid, target, cardUid) => {
    if (!target) return;
    cardBy.set(keyOf(boardUid, target), cardUid);
    let set = targetBoards.get(target);
    if (!set) {
      set = new Set();
      targetBoards.set(target, set);
    }
    set.add(boardUid);
  };

  return {
    setBoard(boardUid, title, children) {
      if (typeof boardUid !== "string" || boardUid === "") return;
      drop(boardUid);
      const name = typeof title === "string" && title.trim() ? title.trim() : "Untitled board";
      titles.set(boardUid, name);
      const list = [];
      for (const child of children || []) {
        const uid = child && typeof child.uid === "string" ? child.uid : "";
        if (!uid) continue;
        let target = child && typeof child.target === "string" ? child.target : "";
        if (!target && typeof child?.string === "string") {
          const match = REF.exec(child.string.trim());
          if (match) target = match[1];
        }
        const keys = [];
        const add = (value) => {
          if (!value || keys.includes(value)) return;
          keys.push(value);
          remember(boardUid, value, uid);
        };
        add(uid);
        add(target);
        list.push({ uid, target, keys });
        childBoard.set(uid, boardUid);
      }
      boards.set(boardUid, list);
    },
    hasChild(uid) {
      return childBoard.has(uid);
    },
    hasTarget(uid) {
      return targetBoards.has(uid);
    },
    boardsOf(uid) {
      return [...(targetBoards.get(uid) || [])];
    },
    titleOf(boardUid) {
      return titles.get(boardUid) || "Untitled board";
    },
    entries() {
      const out = [];
      for (const [boardUid, list] of boards) {
        for (const child of list) {
          out.push({
            uid: child.uid,
            cardUid: child.uid,
            target: child.target || "",
            boardUid,
            title: titles.get(boardUid) || "Untitled board",
          });
        }
      }
      return out;
    },
    cardOn(boardUid, target) {
      return cardBy.get(keyOf(boardUid, target)) || "";
    },
    targets() {
      return new Set(targetBoards.keys());
    },
    rememberBlock(uid, node) {
      if (typeof uid === "string" && uid && node && typeof node === "object") reads.set(uid, node);
    },
    blockOf(uid) {
      return reads.get(uid);
    },
    rememberPage(title, node) {
      if (typeof title === "string" && title && node && typeof node === "object") pageReads.set(title, node);
    },
    pageOf(title) {
      return pageReads.get(title);
    },
    rememberLinked(key, rows) {
      if (typeof key === "string" && key) linkedReads.set(key, Array.isArray(rows) ? rows : []);
    },
    hasLinked(key) {
      return linkedReads.has(key);
    },
    linkedOf(key) {
      return linkedReads.get(key) || [];
    },
    markRef(uid, boardUid) {
      if (typeof uid !== "string" || uid === "") return;
      refUids.add(uid);
      noteBoard(refBoards, uid, boardUid);
    },
    isRef(uid) {
      return refUids.has(uid);
    },
    refBoardsOf(uid) {
      return [...(refBoards.get(uid) || [])];
    },
    notePageBoard(title, boardUid) {
      noteBoard(pageBoards, title, boardUid);
    },
    pageBoardsOf(title) {
      return [...(pageBoards.get(title) || [])];
    },
    markNative(uid) {
      if (typeof uid === "string" && uid) nativeKnown.add(uid);
    },
    nativeKnown(uid) {
      return nativeKnown.has(uid);
    },
    forgetBlock(uid) {
      reads.delete(uid);
      refUids.delete(uid);
      refBoards.delete(uid);
      nativeKnown.delete(uid);
    },
    forgetPage(title) {
      pageReads.delete(title);
      pageBoards.delete(title);
      linkedReads.delete(`page:${title}`);
    },
    clear() {
      childBoard.clear();
      targetBoards.clear();
      boards.clear();
      titles.clear();
      cardBy.clear();
      reads.clear();
      pageReads.clear();
      linkedReads.clear();
      refBoards.clear();
      pageBoards.clear();
      refUids.clear();
      nativeKnown.clear();
    },
  };
}
