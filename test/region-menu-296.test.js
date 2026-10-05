import assert from "node:assert/strict";
import test from "node:test";

import { regionBadge, regionDeleteCopy, regionMenu, regionRefCount, renameRegionCaption } from "../src/model/region-menu.js";

const MACRO = "{{[[plexus-region]]: k=img d=MC-yZP0bb f=0.2500,0.2000,0.5000,0.5000}}";
const BLOCK = `${MACRO} hamstring`;

test("rename keeps the macro bytes and replaces the caption", () => {
  const next = renameRegionCaption(BLOCK, "biceps femoris");
  assert.equal(next, `${MACRO} biceps femoris`);
  assert.equal(next.slice(0, MACRO.length), BLOCK.slice(0, MACRO.length));
  assert.equal(renameRegionCaption(`${MACRO}   hamstring  `, "  biceps   femoris "), `${MACRO} biceps femoris`);
  assert.equal(renameRegionCaption(BLOCK, "   "), MACRO);
  assert.equal(renameRegionCaption("not a region", "x"), null);
});

test("badge and delete copy", () => {
  assert.equal(regionBadge(2), "\u25EC 2");
  assert.equal(regionBadge(0), "");
  assert.equal(regionBadge(1.5), "");
  assert.equal(regionDeleteCopy(0), "");
  assert.equal(regionDeleteCopy(1), "Referenced in 1 block. Delete anyway?");
  assert.equal(regionDeleteCopy(2), "Referenced in 2 blocks. Delete anyway?");
  assert.equal(regionDeleteCopy(-1), null);
  assert.equal(regionDeleteCopy(null), null);
  assert.equal(regionRefCount([[1]]), 1);
  assert.equal(regionRefCount([0]), 0);
  assert.equal(regionRefCount(2), 2);
  assert.equal(regionRefCount(null), null);
  assert.equal(regionRefCount([]), null);
  assert.equal(regionRefCount([[-1]]), null);
});

test("menu rows name each region", () => {
  const menu = regionMenu([
    { uid: "aaa", caption: "hamstring" },
    { uid: "bbb", caption: "" },
  ]);
  assert.equal(menu.label, "Regions");
  assert.deepEqual(menu.children.map((row) => row.label), ["hamstring", "Region"]);
  assert.deepEqual(menu.children[0].children.map((row) => row.id), [
    "region-go:aaa",
    "region-copy:aaa",
    "region-rename:aaa",
    "region-delete:aaa",
  ]);
  assert.equal(menu.children[0].children[3].danger, true);
  assert.equal(regionMenu([]), null);
});
