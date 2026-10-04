// REG-6. Save view writes one k=view block under {{[[plexus-regions]]}}. Go does not use this file.

import { extendSession } from "./session.js";
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
});
