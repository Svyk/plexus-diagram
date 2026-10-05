// ECO-7 plan. The edge ends are the ref card and the image card, never the drawing block.

import { edgeString } from "./schema.js";

const GAP = 40;
const LABEL = "annotates";

export function annotatePlan(image, boardUid) {
  const to = image.uid;
  return {
    create: { parentUid: boardUid, order: "last" },
    card: {
      x: image.x + image.w + GAP,
      y: image.y,
      w: image.w,
      h: image.h,
    },
    edge: {
      label: LABEL,
      to,
      string(cardUid) {
        return edgeString({ srcRef: `((${cardUid}))`, dstRef: `((${to}))`, label: LABEL });
      },
    },
  };
}
