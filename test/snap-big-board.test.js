import assert from "node:assert/strict";
import test from "node:test";
import { buildBoard, worldRects } from "../src/model/board.js";
import { captureBoardSnap, paintBoardSnap } from "../src/view/boardsnap-paint.js";
import { SNAP_MAX_ITEMS, packSnapshot, parseSnapshot } from "../src/model/boardsnap.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const N = 1500;
const COLS = 40;

test("a board past SNAP_MAX_ITEMS is snapshotted: every box, faces only near the camera", () => {
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  try {
    const raw = {
      ":block/uid": "big000001",
      ":block/string": "{{[[diagram]]:Big}}",
      ":block/props": { ":plexus": { ":v": 2 } },
      ":block/children": Array.from({ length: N }, (_, i) => ({
        ":block/uid": `c${String(i).padStart(6, "0")}`,
        ":block/string": `Card ${i} with some text`,
        ":block/order": i,
        ":block/props": { ":plexus": { ":x": (i % COLS) * 260, ":y": Math.floor(i / COLS) * 200, ":w": 240, ":h": 180 } },
      })),
    };
    const board = buildBoard(raw);
    const rects = worldRects(board);
    const doc = stub.document;
    const shells = new Map();
    for (const [uid, r] of rects) {
      const el = doc.createElement("div");
      el.className = "pxd-item pxd-item--card pxd-item--note";
      el.style.transform = `translate(${r.x}px, ${r.y}px)`;
      el.style.width = `${r.w}px`;
      el.style.height = `${r.h}px`;
      const header = doc.createElement("div");
      header.className = "pxd-item__header";
      header.textContent = board.items.get(uid).title;
      const body = doc.createElement("div");
      body.className = "pxd-item__body";
      body.textContent = "body text ".repeat(20);
      el.append(header, body);
      shells.set(uid, el);
    }
    const vp = { x: 0, y: 0, zoom: 1 };
    const raw2 = captureBoardSnap({ uid: "big000001", root: doc.createElement("div"), board, rects, vp, width: 1400, height: 900, shellOf: (uid) => shells.get(uid) });
    assert.ok(raw2, "captured");
    assert.equal(raw2.items.length, N);
    const withFace = raw2.items.filter((item) => item.face).length;
    assert.ok(withFace > 0 && withFace <= SNAP_MAX_ITEMS, `faces: ${withFace}`);
    assert.ok(raw2.items.find((item) => item.uid === "c000000").face, "the card at the camera has its face");
    assert.equal(raw2.items.find((item) => item.uid === `c${String(N - 1).padStart(6, "0")}`).face, undefined);
    const snap = parseSnapshot(packSnapshot(raw2));
    assert.ok(snap, "packed under the byte cap");
    assert.equal(snap.items.length, N);
    const mountEl = doc.createElement("div");
    doc.body.append(mountEl);
    const painted = paintBoardSnap(doc, mountEl, snap, vp, { height: 900 });
    assert.ok(painted.shells.size > 0 && painted.shells.size < N / 4, `painted ${painted.shells.size} of ${N}`);
  } finally {
    restore();
  }
});
