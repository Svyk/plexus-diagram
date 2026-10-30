// PXD-7 session calls for property chips. The board's plexus `chips` list is the only write. Card values are read
// lazily, one card at a time, and only when the board has picks.
import { PROP_CHIPS_KEY, propChipsOf, togglePropChip } from "./model/prop-chips.js";
import { laneAttrOk, laneFields, laneRow } from "./model/attr-lanes.js";
import { isTableRow, tableRow } from "./model/table.js";
import { extendSession } from "./session.js";

const FIELD_SCAN_CAP = 400;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

extendSession((session, api) => {
  const { host } = api;
  const boardUid = session.uid;
  let memoBoard = null;
  let memo = new Map();

  function rowOf(uid) {
    const board = api.board();
    if (board !== memoBoard) { memoBoard = board; memo = new Map(); }
    if (memo.has(uid)) return memo.get(uid);
    const item = board?.items.get(uid);
    let row = null;
    if (isTableRow(item)) {
      if (item.kind === "block" && item.target?.uid) row = laneRow(board, item, api.laneKids, api.laneResolve);
      else if (item.kind === "page" && item.target?.uid) {
        let top = [];
        try { top = host.pullTree?.(item.target.uid, 1, 40) || []; } catch { top = []; }
        row = tableRow(board, item, api.laneResolve, [...(item.content || []), ...top]);
      } else row = tableRow(board, item, api.laneResolve);
    }
    memo.set(uid, row);
    return row;
  }

  Object.assign(session, {
    cardPropChips(uid) {
      const names = api.board()?.chips;
      if (!names?.length) return [];
      return propChipsOf(rowOf(uid), names);
    },

    setBoardChips(names) {
      return api.txn((t) => {
        const board = api.board();
        if (!board?.enhanced) return false;
        const list = Array.isArray(names) ? names.filter((n) => typeof n === "string" && laneAttrOk(n)) : [];
        const base = api.rawPlexus(boardUid);
        const next = { ...base };
        if (list.length) next[PROP_CHIPS_KEY] = list;
        else delete next[PROP_CHIPS_KEY];
        if (!same(next, base)) t.props(boardUid, next);
        return true;
      });
    },

    toggleBoardChip(name) {
      const cur = api.board()?.chips || [];
      const next = togglePropChip(cur, name);
      if (next === cur) return Promise.resolve(false);
      return session.setBoardChips(next);
    },

    chipFieldsFor() {
      const board = api.board();
      const picked = board?.chips || [];
      const rows = [];
      let n = 0;
      for (const uid of board?.order || []) {
        if (n >= FIELD_SCAN_CAP) break;
        if (!isTableRow(board.items.get(uid))) continue;
        n += 1;
        const row = rowOf(uid);
        if (row) rows.push(row);
      }
      const found = laneFields(rows).filter((name) => !picked.includes(name));
      return [...picked, ...found];
    },
  });
});
