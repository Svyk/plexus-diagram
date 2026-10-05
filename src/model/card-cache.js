// PDF-7 / NAV-1 uid map. Keyed by enhanced-board child uids. No writes.

const REF = /^\(\(([^\s()]+)\)\)$/;
const keyOf = (boardUid, target) => `${boardUid}\0${target}`;

export function createCardCache() {
  const childBoard = new Map();
  const targetBoards = new Map();
  const boards = new Map();
  const titles = new Map();
  const cardBy = new Map();

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
    clear() {
      childBoard.clear();
      targetBoards.clear();
      boards.clear();
      titles.clear();
      cardBy.clear();
    },
  };
}
