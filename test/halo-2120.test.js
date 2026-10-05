import assert from "node:assert/strict";
import test from "node:test";

import { buckets, company, formatMade, headerText, readHaloPull, refsLine } from "../src/model/halo.js";
import { buildMenu } from "../src/view/menu-model.js";

const DAY = 86400000;
const OCT_4 = Date.UTC(2026, 9, 4, 15, 0, 0);

test("company keeps cards from the same day, at most 6, and skips the subject", () => {
  const rows = [
    { uid: "self", created: OCT_4 },
    { uid: "close", created: OCT_4 + 60 * 1000 },
    { uid: "edge", created: OCT_4 + DAY },
    { uid: "far", created: OCT_4 + DAY + 1 },
    { uid: "blank", created: null },
  ];
  for (let i = 0; i < 8; i += 1) rows.push({ uid: `n${i}`, created: OCT_4 + i });
  const got = company(rows, "self");
  assert.equal(got.includes("self"), false);
  assert.equal(got.includes("far"), false);
  assert.equal(got.includes("blank"), false);
  assert.equal(got.includes("close"), true);
  assert.equal(got.includes("edge"), true);
  assert.equal(got.length, 6);
  assert.deepEqual(company(rows, "missing"), []);
  assert.deepEqual(company([], "self"), []);
});

test("buckets are 12 counts and every ref lands in one", () => {
  assert.deepEqual(buckets([]), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(buckets([null, "no"]), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const same = buckets([OCT_4, OCT_4, OCT_4]);
  assert.equal(same.reduce((sum, n) => sum + n, 0), 3);
  assert.equal(same[0], 3);
  const spread = buckets([0, 50, 100]);
  assert.equal(spread.length, 12);
  assert.equal(spread.reduce((sum, n) => sum + n, 0), 3);
  assert.equal(spread[0] >= 1, true);
  assert.equal(spread[11] >= 1, true);
});

test("the header names the day, the board and the section, and skips an empty person", () => {
  assert.equal(formatMade(OCT_4), "October 4th, 2026");
  assert.equal(
    headerText({ created: OCT_4, board: "Board X", section: "Section Y", userName: "" }),
    "Made October 4th, 2026 on Board X › Section Y",
  );
  assert.equal(headerText({ created: OCT_4, board: "Board X", userName: "Ada" }).endsWith(" by Ada"), true);
  assert.equal(headerText({ created: OCT_4, board: "", userName: "" }).includes("Untitled board"), true);
  const pulled = readHaloPull({
    ":create/time": OCT_4,
    ":edit/time": OCT_4 + 5,
    ":create/user": { ":user/uid": "secret-user", ":user/display-name": "" },
    ":block/_refs": [{ ":create/time": OCT_4 }, { ":create/time": OCT_4 + DAY }],
  });
  assert.equal(pulled.created, OCT_4);
  assert.equal(pulled.edited, OCT_4 + 5);
  assert.equal(pulled.userName, "");
  assert.equal("uid" in pulled, false);
  assert.equal(JSON.stringify(pulled).includes("secret-user"), false);
  assert.equal(pulled.refTimes.length, 2);
  assert.equal(refsLine(pulled.refTimes).startsWith("Referenced 2 times"), true);
  assert.equal(refsLine([]), "Referenced 0 times");
  const card = buildMenu("card", {}).map((row) => row.id);
  const edge = buildMenu("edge", {}).map((row) => row.id);
  assert.equal(card.includes("context"), true);
  assert.equal(edge.includes("context"), true);
});
