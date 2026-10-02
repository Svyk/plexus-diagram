// Save and restore a board layout. The folder is a collapsed Snapshots child.
// Restore runs in chunks of 45 after the view has confirmed once.

import {
  SNAPSHOTS_TITLE,
  captureLayout,
  planRestore,
  snapshotProps,
  snapshotTitle,
} from "./model/snapshots.js";
import { extendSession } from "./session.js";

extendSession((session, api) => {
  session.saveSnapshot = (now = new Date()) => {
    const board = api.board();
    if (!board) return Promise.resolve(null);
    const title = snapshotTitle(now);
    if (!title) return Promise.resolve(null);
    const items = captureLayout(board);
    return api.txn((t) => {
      let parent = board.snapshotsUid;
      if (!parent) {
        parent = t.create({
          parent: api.uid,
          string: SNAPSHOTS_TITLE,
          plexus: { type: "snapshots" },
          open: false,
        });
      }
      return t.create({
        parent,
        string: title,
        plexus: snapshotProps(items),
      });
    });
  };

  session.restoreSnapshot = async (snapUid) => {
    const board = api.board();
    const snap = board?.snapshots?.find((item) => item.uid === snapUid);
    if (!snap) return false;
    const chunks = planRestore(snap.items, board);
    for (const chunk of chunks) {
      await api.txn((t) => {
        for (const op of chunk) {
          if (op.op === "move") t.move(op.uid, op.parent);
          else {
            t.props(op.uid, api.itemPlexus(op.uid, {
              x: op.x,
              y: op.y,
              w: op.w,
              h: op.h,
              color: op.color || undefined,
              collapsed: op.collapsed ? true : undefined,
            }));
          }
        }
      });
    }
    api.emit("toast", { message: `Restored ${snap.title}` });
    return true;
  };

  session.deleteSnapshot = (snapUid) => api.txn((t) => {
    const snap = api.board()?.snapshots?.find((item) => item.uid === snapUid);
    if (!snap) return false;
    t.del(snapUid);
    return true;
  });
});
