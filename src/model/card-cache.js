// PDF-7 / NAV-1 uid map. Keyed by enhanced-board child uids. No writes.

const REF = /^\(\(([^\s()]+)\)\)$/;

export function createCardCache() {
  const childBoard = new Map();
  const targetBoards = new Map();
  const boards = new Map();

  const drop = (boardUid) => {
    const prev = boards.get(boardUid);
    if (!prev) return;
    for (const child of prev) {
      if (childBoard.get(child.uid) === boardUid) childBoard.delete(child.uid);
      if (!child.target) continue;
      const set = targetBoards.get(child.target);
      if (!set) continue;
      set.delete(boardUid);
      if (set.size === 0) targetBoards.delete(child.target);
    }
    boards.delete(boardUid);
  };

  return {
    setBoard(boardUid, _title, children) {
      if (typeof boardUid !== "string" || boardUid === "") return;
      drop(boardUid);
      const list = [];
      for (const child of children || []) {
        const uid = child && typeof child.uid === "string" ? child.uid : "";
        if (!uid) continue;
        let target = child && typeof child.target === "string" ? child.target : "";
        if (!target && typeof child?.string === "string") {
          const match = REF.exec(child.string.trim());
          if (match) target = match[1];
        }
        list.push({ uid, target });
        childBoard.set(uid, boardUid);
        if (!target) continue;
        let set = targetBoards.get(target);
        if (!set) {
          set = new Set();
          targetBoards.set(target, set);
        }
        set.add(boardUid);
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
    clear() {
      childBoard.clear();
      targetBoards.clear();
      boards.clear();
    },
  };
}
