import assert from "node:assert/strict";
import test from "node:test";

import {
  assignDeepLink,
  cardDeepLink,
  copyLinkText,
  isShowableCard,
  locateShowTarget,
  hashFromUrl,
  pageUidFromHash,
  pxdTarget,
} from "../src/model/deeplink.js";

test("card deep link round-trips the page and the card", () => {
  const link = cardDeepLink({ graph: "Readwisenotes", pageUid: "xxnGb6SEj", cardUid: "XLE_xhX2y" });
  assert.equal(link, "#/app/Readwisenotes/page/xxnGb6SEj?pxd=XLE_xhX2y");
  assert.deepEqual(pxdTarget(link), { cardUid: "XLE_xhX2y", pageUid: "xxnGb6SEj", graph: "Readwisenotes" });
  const spaced = cardDeepLink({ graph: "A B", pageUid: "page-1", cardUid: "card_2" });
  assert.equal(spaced, "#/app/A%20B/page/page-1?pxd=card_2");
  assert.equal(pxdTarget(spaced).graph, "A B");
  assert.equal(cardDeepLink({ graph: "G", pageUid: "", cardUid: "card1" }), "");
  assert.equal(cardDeepLink({ graph: "G", pageUid: "page 1", cardUid: "card1" }), "");
  assert.equal(pxdTarget("#/app/G/page/page1"), null);
  assert.equal(pxdTarget("#/app/G/page/page1?pxd="), null);
  assert.equal(pxdTarget("#/app/G/page/page1?pxd=bad uid"), null);
  const kept = "https://roamresearch.com/?server-port=3333#/app/Readwisenotes/page/xxnGb6SEj?pxd=Or6gEkteS";
  assert.equal(hashFromUrl(kept), "#/app/Readwisenotes/page/xxnGb6SEj?pxd=Or6gEkteS");
  assert.equal(hashFromUrl("#/app/G/page/page1"), "#/app/G/page/page1");
  assert.equal(hashFromUrl("https://roamresearch.com/"), "");
  assert.equal(pageUidFromHash("#/app/Readwisenotes/page/xxnGb6SEj"), "xxnGb6SEj");
  assert.equal(pageUidFromHash("#/app/Readwisenotes/page/xxnGb6SEj?pxd=MC-yZP0bb"), "xxnGb6SEj");
  assert.equal(pageUidFromHash(""), "");
});

test("copy link keeps the block ref and appends the url when the page is known", () => {
  const page = { uid: "cardBBBB2", target: { kind: "page", title: "Beta" } };
  const block = { uid: "cardAAAA1", target: { kind: "self", uid: "cardAAAA1" } };
  assert.equal(
    copyLinkText(page, { graph: "Svy", pageUid: "pageLAB99" }),
    "[[Beta]]\n#/app/Svy/page/pageLAB99?pxd=cardBBBB2",
  );
  assert.equal(
    copyLinkText(block, { graph: "Svy", pageUid: "pageLAB99" }),
    "((cardAAAA1))\n#/app/Svy/page/pageLAB99?pxd=cardAAAA1",
  );
  assert.equal(copyLinkText(block, { graph: "Svy" }), "((cardAAAA1))");
});

test("locate prefers the block that is the card, then the lowest board uid", () => {
  const rows = [
    { boardUid: "boardZZZ", pageUid: "pageB", cardUid: "cardSELF", refUids: [] },
    { boardUid: "boardAAA", pageUid: "pageA", cardUid: "cardSELF", refUids: [] },
    { boardUid: "board000", pageUid: "pageA", cardUid: "cardREF", refUids: ["cardSELF"] },
  ];
  assert.deepEqual(locateShowTarget("cardSELF", rows), {
    boardUid: "boardAAA", pageUid: "pageA", cardUid: "cardSELF",
  });
  assert.deepEqual(locateShowTarget("srcBLOCK", [
    { boardUid: "boardMMM", pageUid: "p2", cardUid: "cardB", refUids: ["srcBLOCK"] },
    { boardUid: "boardAAA", pageUid: "p1", cardUid: "cardA", refUids: ["srcBLOCK"] },
  ]), { boardUid: "boardAAA", pageUid: "p1", cardUid: "cardA" });
  assert.equal(locateShowTarget("plain", rows), null);
  assert.equal(locateShowTarget("", rows), null);
  assert.equal(isShowableCard({ x: 1, y: 2 }), true);
  assert.equal(isShowableCard({ type: "text", x: 0, y: 0 }), true);
  assert.equal(isShowableCard({ type: "section", x: 1, y: 2 }), false);
  assert.equal(isShowableCard({ type: "edge", x: 1, y: 2 }), false);
  assert.equal(isShowableCard({ type: "edges", x: 1, y: 2 }), false);
  assert.equal(isShowableCard({ y: 2 }), false);
  assert.equal(isShowableCard(null), false);
});

test("assignDeepLink writes the hash, and repeats call onSame", () => {
  const loc = { hash: "#/app/Svy/page/other" };
  let same = 0;
  const link = assignDeepLink(loc, { graph: "Svy", pageUid: "pageLAB99", cardUid: "cardAAAA1" }, () => { same += 1; });
  assert.equal(link, "#/app/Svy/page/pageLAB99?pxd=cardAAAA1");
  assert.equal(loc.hash, link);
  assert.equal(same, 0);
  assert.equal(assignDeepLink(loc, { graph: "Svy", pageUid: "pageLAB99", cardUid: "cardAAAA1" }, () => { same += 1; }), link);
  assert.equal(same, 1);
  assert.equal(assignDeepLink({ hash: "" }, { graph: "", pageUid: "p", cardUid: "c" }), "");
});
