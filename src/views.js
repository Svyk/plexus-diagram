// REG-6. Save view writes one k=view block under {{[[plexus-regions]]}}. Go does not use this file.

import { extendSession } from "./session.js";
import { imageRegionString } from "./model/image-region.js";
import { isContainerString, parseRegion, serializeRegion } from "./model/regions.js";
import { viewBlockString } from "./model/view-save.js";

const UID = ":block/uid";
const STR = ":block/string";
const CONTAINER = "{{[[plexus-regions]]}}";

function regionsParent(api, board) {
  if (board.regionsUid) return board.regionsUid;
  const root = api.rawNode(api.uid);
  for (const child of api.kidsOf(root)) {
    const text = child[STR] ?? child.string ?? "";
    if (isContainerString(text)) return child[UID] || child.uid;
  }
  return null;
}

function viewRegion(api, uid) {
  const node = api.rawNode(uid);
  if (!node) return null;
  const region = parseRegion(node[STR] ?? node.string ?? "");
  if (!region || region.kind !== "view" || region.supported !== true) return null;
  return region;
}

// The container is a child of this card only. The board's regions list is a different block.
function imageCardContainer(api, cardUid) {
  const card = api.rawNode(cardUid);
  if (!card) return null;
  for (const child of api.kidsOf(card)) {
    const id = child[UID] || child.uid;
    if (!id) continue;
    const text = child[STR] ?? child.string ?? "";
    if (isContainerString(text) || api.rawPlexus(id)?.type === "regions") return id;
  }
  return null;
}

extendSession((session, api) => {
  session.addView = ({ caption = "", v, ids } = {}) => {
    const board = api.board();
    if (!board) return Promise.resolve(null);
    const string = viewBlockString({ drawingUid: api.uid, caption, v, ids });
    if (!string) return Promise.resolve(null);
    const uid = api.host.generateUid();
    const promise = api.txn((t) => {
      let parent = regionsParent(api, board);
      if (!parent) {
        parent = t.create({
          parent: api.uid,
          string: CONTAINER,
          plexus: { type: "regions" },
          open: false,
          order: "last",
        });
      }
      t.create({ parent, uid, string, order: "last" });
      return uid;
    });
    if (promise && typeof promise === "object") promise.uid = uid;
    return promise;
  };

  session.renameView = (uid, caption) => {
    const region = viewRegion(api, uid);
    if (!region) return Promise.resolve(false);
    let string;
    try {
      string = serializeRegion({ ...region, caption });
    } catch {
      return Promise.resolve(false);
    }
    return api.txn((t) => {
      t.string(uid, string);
      return true;
    });
  };

  session.deleteView = (uid) => {
    if (!viewRegion(api, uid)) return Promise.resolve(false);
    return api.txn((t) => {
      t.del(uid);
      return true;
    });
  };

  session.addImageRegion = (cardUid, frac, caption, uid) => {
    const string = imageRegionString(cardUid, frac, caption);
    if (string == null) return Promise.resolve(null);
    const regionUid = uid || api.host.generateUid();
    const existing = imageCardContainer(api, cardUid);
    if (!existing) {
      api.txn((t) => {
        t.create({
          parent: cardUid,
          string: CONTAINER,
          plexus: { type: "regions" },
          open: false,
          order: "last",
        });
      });
    }
    const parent = existing || imageCardContainer(api, cardUid);
    const promise = api.txn((t) => {
      t.create({ parent, uid: regionUid, string, order: "last" });
      return regionUid;
    });
    if (promise && typeof promise === "object") promise.uid = regionUid;
    return promise;
  };

  // The highlight block is not on the board. rawInsert skips that parent, so both creates stay one txn.
  session.addHighlightRegion = (highlightUid, frac, caption, uid) => {
    const string = imageRegionString(highlightUid, frac, caption);
    if (string == null) return Promise.resolve(null);
    const regionUid = uid || api.host.generateUid();
    let existing = null;
    try {
      for (const kid of api.host.pullTree?.(highlightUid, 1, 200) || []) {
        if (kid?.uid && isContainerString(kid.string ?? "")) { existing = kid.uid; break; }
      }
    } catch { existing = null; }
    const promise = api.txn((t) => {
      const parent = existing || t.create({
        parent: highlightUid,
        string: CONTAINER,
        plexus: { type: "regions" },
        open: false,
        order: "last",
      });
      t.create({ parent, uid: regionUid, string, order: "last" });
      return regionUid;
    });
    if (promise && typeof promise === "object") promise.uid = regionUid;
    return promise;
  };
});
