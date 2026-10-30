// Keep a static picture: one image child of the board block, written only by hand. It is the first child, so a
// reader without Plexus who expands the board block sees it before the card outline.

import { PICTURE_TYPE } from "./model/picture.js";
import { extendSession } from "./session.js";

extendSession((session, api) => {
  // A refresh (create false) never makes the block: if it was turned off meanwhile, nothing is written.
  session.keepPicture = ({ at, string, create = true }) => api.txn((t) => {
    const existing = api.board()?.pictureUid;
    if (existing) {
      t.string(existing, string);
      t.props(existing, { type: PICTURE_TYPE, at });
      return existing;
    }
    if (!create) return null;
    return t.create({ parent: api.uid, order: 0, string, plexus: { type: PICTURE_TYPE, at }, open: false });
  });

  session.dropPicture = () => api.txn((t) => {
    const uid = api.board()?.pictureUid;
    if (!uid) return false;
    t.del(uid);
    return true;
  });
});
