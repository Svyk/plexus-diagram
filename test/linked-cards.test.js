// PXD-8 "Add linked references as cards": host query, skip rules, grouping by page, layout, cap and the session writes.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { groupLinkedRefs, linkedCardsLayout, linkedCardsMessage, linkedRefRows } from "../src/model/linked-cards.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { SPREAD_CAP } from "../src/session-clip.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

const rect = { x: 100, y: 200, w: 280, h: 160 };
const refsOn = (pages, perPage) => pages.flatMap((title, p) => Array.from({ length: perPage }, (_, i) => ({ uid: `r${p}x${i}`, pageTitle: title })));

// ------------------------------------------------------------------ model

test("linkedRefRows keeps one row per block and drops the block itself and blocks on the page itself", () => {
  const rows = [["refAAAA01", "Notes"], ["refAAAA01", "Notes"], ["selfBLK01", "Notes"], ["onAlpha01", "Alpha"], [null, "X"], ["refBBBB02", 7]];
  assert.deepEqual(linkedRefRows(rows, { selfTitle: "Alpha" }), [
    { uid: "refAAAA01", pageTitle: "Notes" },
    { uid: "selfBLK01", pageTitle: "Notes" },
    { uid: "refBBBB02", pageTitle: "" },
  ]);
  assert.deepEqual(linkedRefRows(rows, { selfUid: "selfBLK01" }).map((r) => r.uid), ["refAAAA01", "onAlpha01", "refBBBB02"]);
  assert.deepEqual(linkedRefRows(null), []);
});

test("groupLinkedRefs groups by page, most references first then by title, and skips blocks on the board", () => {
  const refs = [
    { uid: "a1", pageTitle: "Zed" },
    { uid: "b1", pageTitle: "Notes" },
    { uid: "c1", pageTitle: "Alpha" },
    { uid: "b2", pageTitle: "Notes" },
    { uid: "b1", pageTitle: "Notes" },
    { uid: "bad))", pageTitle: "Notes" },
    { uid: "onboard", pageTitle: "Zed" },
  ];
  assert.deepEqual(groupLinkedRefs(refs, { skip: ["onboard"] }), [
    { title: "Notes", uids: ["b1", "b2"] },
    { title: "Alpha", uids: ["c1"] },
    { title: "Zed", uids: ["a1"] },
  ]);
  assert.deepEqual(groupLinkedRefs(refs, { skip: new Set(["onboard", "a1"]) }).map((g) => g.title), ["Notes", "Alpha"]);
  assert.deepEqual(groupLinkedRefs(null), []);
});

test("linkedCardsLayout flat: a ref-card grid right of the source card, in page groups", () => {
  const refs = [
    { uid: "a1", pageTitle: "Zed" },
    { uid: "b1", pageTitle: "Notes" },
    { uid: "c1", pageTitle: "Alpha" },
    { uid: "b2", pageTitle: "Notes" },
    { uid: "d1", pageTitle: "Beta" },
  ];
  const plan = linkedCardsLayout(rect, refs, { mode: "flat" });
  assert.deepEqual(plan.sections, []);
  assert.deepEqual([plan.added, plan.total, plan.left], [5, 5, 0]);
  // three columns (ceil sqrt 5) from x = 100 + 280 + 80, 280 x 160 cards, 24 apart
  assert.deepEqual(plan.cards, [
    { string: "((b1))", x: 460, y: 200 },
    { string: "((b2))", x: 764, y: 200 },
    { string: "((c1))", x: 1068, y: 200 },
    { string: "((d1))", x: 460, y: 384 },
    { string: "((a1))", x: 764, y: 384 },
  ]);
  const wide = linkedCardsLayout(rect, refs.slice(0, 2), { card: { w: 400, h: 100 } });
  assert.deepEqual(wide.cards.map((c) => [c.x, c.y]), [[460, 200], [884, 200]], "spacing follows the card size");
  assert.deepEqual(linkedCardsLayout(null, refs).cards, []);
  assert.deepEqual(linkedCardsLayout(rect, refs, { skip: ["a1", "b1", "b2", "c1", "d1"] }), { cards: [], sections: [], added: 0, total: 0, left: 0 });
});

test("linkedCardsLayout by page: one section per page, sized to its card grid, sections in rows", () => {
  const refs = [
    { uid: "a1", pageTitle: "Zed" },
    { uid: "b1", pageTitle: "Notes" },
    { uid: "c1", pageTitle: "Alpha" },
    { uid: "b2", pageTitle: "Notes" },
  ];
  const plan = linkedCardsLayout(rect, refs, { mode: "page" });
  assert.deepEqual(plan.cards, []);
  assert.deepEqual([plan.added, plan.total, plan.left], [4, 4, 0]);
  assert.deepEqual(plan.sections.map(({ title, x, y, w, h }) => ({ title, x, y, w, h })), [
    // two cards side by side: 32 + 280 + 24 + 280 + 32
    { title: "Notes", x: 460, y: 200, w: 648, h: 224 },
    { title: "Alpha", x: 1172, y: 200, w: 344, h: 224 },
    // ceil(sqrt 3) = 2 sections per row; the next row starts 64 below the tallest
    { title: "Zed", x: 460, y: 488, w: 344, h: 224 },
  ]);
  assert.deepEqual(plan.sections[0].cards, [{ string: "((b1))", x: 492, y: 232 }, { string: "((b2))", x: 796, y: 232 }]);
  assert.deepEqual(plan.sections[2].cards, [{ string: "((a1))", x: 492, y: 520 }]);
  for (const s of plan.sections) {
    for (const c of s.cards) assert.ok(c.x >= s.x + 24 && c.y >= s.y + 24 && c.x + 280 <= s.x + s.w - 24 && c.y + 160 <= s.y + s.h - 24, "auto-fit has nothing to grow");
  }
  assert.equal(linkedCardsLayout(rect, [{ uid: "x1", pageTitle: "" }], { mode: "page" }).sections[0].title, "Untitled");
});

test("linkedCardsLayout caps cards, and in page mode sections too, and counts what was left out", () => {
  const many = refsOn(["P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"], 3);
  const flat = linkedCardsLayout(rect, many, { cap: 22 });
  assert.deepEqual([flat.cards.length, flat.added, flat.total, flat.left], [22, 22, 30, 8]);
  const paged = linkedCardsLayout(rect, many, { mode: "page", cap: 22 });
  // five pages of 3 (20 changes), then a sixth section with the one card that still fits
  assert.deepEqual(paged.sections.map((s) => s.cards.length), [3, 3, 3, 3, 3, 1]);
  assert.equal(paged.sections.length + paged.added, 22);
  assert.deepEqual([paged.added, paged.total, paged.left], [16, 30, 14]);
  const onePage = linkedCardsLayout(rect, refsOn(["Big"], 30), { mode: "page", cap: 22 });
  assert.deepEqual([onePage.sections.length, onePage.added, onePage.left], [1, 21, 9]);
  assert.equal(linkedCardsLayout(rect, many, { mode: "page", cap: 1 }).added, 0, "a section needs room for one card");
});

test("linkedCardsLayout moves the group right, past every card or section it would cover", () => {
  const refs = refsOn(["Notes"], 2);
  // two cards, x 460..1044, y 200..360
  const free = linkedCardsLayout(rect, refs, { avoid: [{ x: 460, y: 600, w: 280, h: 160 }, rect] });
  assert.deepEqual(free.cards.map((c) => [c.x, c.y]), [[460, 200], [764, 200]], "a rect below, or the source card, is not in the way");
  const one = linkedCardsLayout(rect, refs, { avoid: [{ x: 800, y: 300, w: 200, h: 100 }] });
  assert.deepEqual(one.cards.map((c) => [c.x, c.y]), [[1080, 200], [1384, 200]], "80 past the right edge of what it hit");
  const chain = linkedCardsLayout(rect, refs, { avoid: [{ x: 460, y: 200, w: 280, h: 160 }, { x: 1300, y: 250, w: 100, h: 50 }] });
  assert.deepEqual(chain.cards.map((c) => c.x), [1480, 1784], "a move that lands on another rect moves again");
  const paged = linkedCardsLayout(rect, refsOn(["A", "B"], 1), { mode: "page", avoid: [{ x: 500, y: 150, w: 100, h: 100 }] });
  assert.deepEqual(paged.sections.map((s) => [s.title, s.x, s.y]), [["A", 680, 200], ["B", 1088, 200]]);
  assert.deepEqual(paged.sections.map((s) => s.cards[0].x), [712, 1120], "cards move with their section");
  // A new section's title sits 32 above its frame (y 168..200 here), so a card ending 28 above the frame is on it.
  const titled = (bottom) => linkedCardsLayout(rect, refsOn(["A"], 1), { mode: "page", avoid: [{ x: 460, y: bottom - 160, w: 280, h: 160 }] }).sections[0].x;
  assert.equal(titled(172), 820, "a card on the title moves the section");
  assert.equal(titled(168), 460, "32 clear of the frame is clear of the title");
});

test("linkedCardsMessage counts references, sections and the ones left out", () => {
  assert.equal(linkedCardsMessage({ added: 1 }), "Added 1 linked reference");
  assert.equal(linkedCardsMessage({ added: 5, sections: 1 }), "Added 5 linked references in 1 section");
  assert.equal(linkedCardsMessage({ added: 22, left: 8 }), "Added 22 linked references, 8 left out (Roam undo holds 50 changes)");
  assert.equal(linkedCardsMessage({ added: 16, sections: 6, left: 14 }), "Added 16 linked references in 6 sections, 14 left out (Roam undo holds 50 changes)");
});

test("the card menu offers the flat and grouped forms with the other add-as-cards actions", () => {
  const row = flattenMenu(buildMenu("card", { canExpand: true })).find((i) => i.id === "linked-cards");
  assert.equal(row.label, "Add linked references as cards");
  assert.deepEqual(row.children.map((c) => [c.id, c.label]), [["linked-cards:flat", "Flat"], ["linked-cards:page", "Grouped by page"]]);
  assert.equal(flattenMenu(buildMenu("card", {})).some((i) => i.id === "linked-cards"), false);
});

// ------------------------------------------------------------------ host

test("linkedRefBlocks asks for the blocks that ref a page or a block, outside this board", () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "boardAAA" });
  const boardEid = host.resolveEid({ uid: "boardAAA" });
  const seen = [];
  fake.setQ((query, input, eid) => {
    seen.push({ query: String(query), input, eid });
    return [["refAAAA01", "Notes"], ["refAAAA01", "Notes"], ["onAlpha01", "Alpha"], ["note10001", "Lab"], ["refBBBB02", "Zed"]];
  });
  const page = { uid: "cardP0001", type: "card", kind: "page", title: "Alpha", string: "[[Alpha]]", target: { kind: "page", title: "Alpha" } };
  assert.deepEqual(host.linkedRefBlocks(page, { boardUid: "boardAAA" }), [
    { uid: "refAAAA01", pageTitle: "Notes" },
    { uid: "note10001", pageTitle: "Lab" },
    { uid: "refBBBB02", pageTitle: "Zed" },
  ]);
  assert.match(seen[0].query, /\[\?p :node\/title \?title\] \[\?b :block\/refs \?p\]/);
  assert.match(seen[0].query, /\(not \[\?b :block\/parents \?board\]\) \[\(not= \?b \?board\)\]/);
  assert.deepEqual([seen[0].input, seen[0].eid], ["Alpha", boardEid]);

  const block = { uid: "refcard01", type: "card", kind: "block", string: "((note10001))", target: { kind: "block", uid: "note10001" } };
  assert.deepEqual(host.linkedRefBlocks(block).map((r) => r.uid), ["refAAAA01", "onAlpha01", "refBBBB02"], "the block itself is not its own reference");
  assert.match(seen[1].query, /\[\?s :block\/uid \?uid\] \[\?b :block\/refs \?s\]/);
  assert.deepEqual([seen[1].input, seen[1].eid], ["note10001", -1]);
  host.linkedRefBlocks({ uid: "noteCARD1", type: "card", kind: "note", string: "plain" });
  assert.equal(seen[2].input, "noteCARD1", "a note card is its own block");

  assert.deepEqual(host.linkedRefBlocks({ uid: "s1", type: "section", kind: "section" }), []);
  assert.deepEqual(host.linkedRefBlocks({ uid: "nb1", type: "card", kind: "board", target: { kind: "board", uid: "nb1" } }), []);
  assert.deepEqual(host.linkedRefBlocks(null), []);
  assert.equal(seen.length, 3, "no query for sections and boards");
  fake.setQ(() => { throw new Error("query down"); });
  assert.deepEqual(host.linkedRefBlocks(page), []);
});

// ------------------------------------------------------------------ session
const card = (uid, string, x, y, w = 200, h = 100, extra = {}, children = []) => ({
  uid, string, props: { plexus: { x, y, w, h, ...extra } }, children,
});
function setup(children, settings = null) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children });
  const session = acquireSession("b1", { host, settings, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}
const creates = (fake) => fake.writesLog().filter((e) => e[0] === "create");
const updates = (fake) => fake.writesLog().filter((e) => e[0] === "update");
const at = (fake, uid) => [fake.props(uid).plexus.x, fake.props(uid).plexus.y];
const three = [{ uid: "refAAAA01", pageTitle: "Notes" }, { uid: "refBBBB02", pageTitle: "Notes" }, { uid: "refCCCC03", pageTitle: "Zed" }];

test("addLinkedRefCards flat: ref cards right of the card in one transaction, skipping blocks already on the board", async () => {
  const { fake, session } = setup([card("X", "[[Alpha]]", 100, 100, 280, 160), card("have", "((refBBBB02))", 2000, 2000)]);
  const res = await session.addLinkedRefCards("X", three, "flat");
  assert.deepEqual([res.added, res.sections, res.total, res.left], [2, 0, 2, 0]);
  assert.deepEqual(res.ids.map((u) => fake.block(u).string), ["((refAAAA01))", "((refCCCC03))"]);
  assert.ok(res.ids.every((u) => fake.block(u).parent === "b1"));
  const plan = linkedCardsLayout({ x: 100, y: 100, w: 280, h: 160 }, three, { skip: ["refBBBB02"] });
  assert.deepEqual(res.ids.map((u) => at(fake, u)), plan.cards.map((c) => [c.x, c.y]));
  assert.deepEqual([creates(fake).length, updates(fake).length], [2, 0]);
});

test("addLinkedRefCards by page: one section per page titled with its name, cards inside at section-relative positions", async () => {
  const { fake, session } = setup([card("X", "[[Alpha]]", 100, 100, 280, 160)]);
  const res = await session.addLinkedRefCards("X", three, "page");
  assert.deepEqual([res.added, res.sections, res.left], [3, 2, 0]);
  const [notes, zed] = res.ids;
  assert.equal(fake.block(notes).string, "Notes");
  assert.equal(fake.block(zed).string, "Zed");
  assert.deepEqual(fake.props(notes).plexus, { type: "section", x: 460, y: 100, w: 648, h: 224 });
  assert.deepEqual(fake.props(zed).plexus, { type: "section", x: 1172, y: 100, w: 344, h: 224 });
  assert.deepEqual(fake.children(notes).map((u) => fake.block(u).string), ["((refAAAA01))", "((refBBBB02))"]);
  assert.deepEqual(fake.children(notes).map((u) => at(fake, u)), [[32, 32], [336, 32]]);
  assert.deepEqual(fake.children(zed).map((u) => [fake.block(u).string, ...at(fake, u)]), [["((refCCCC03))", 32, 32]]);
  assert.deepEqual([creates(fake).length, updates(fake).length], [5, 0], "two sections and three cards; auto-fit grows nothing");
});

test("addLinkedRefCards: a new section that lands in the source card's section is fitted into it", async () => {
  const { fake, session } = setup([card("S", "Frame", 0, 0, 600, 400, { type: "section" }, [card("X", "[[Alpha]]", 20, 40, 280, 160)])]);
  const res = await session.addLinkedRefCards("X", [{ uid: "refAAAA01", pageTitle: "Notes" }], "page");
  const [notes] = res.ids;
  assert.equal(fake.block(notes).parent, "S");
  assert.deepEqual(at(fake, notes), [380, 40]);
  assert.equal(fake.props("S").plexus.w, 380 + 344 + 24, "the frame grows to hold the new section");
});

test("addLinkedRefCards: a second run on the card below lands clear of the first batch", async () => {
  const { fake, session } = setup([card("X", "[[Alpha]]", 100, 100, 280, 160), card("Y", "((blockYY01))", 100, 300, 280, 160)]);
  const first = await session.addLinkedRefCards("X", three, "flat");
  // 2 columns: (460,100) (764,100) (460,284); a section beside Y at (460,300) would cover the third card
  assert.deepEqual(first.ids.map((u) => at(fake, u)), [[460, 100], [764, 100], [460, 284]]);
  const second = await session.addLinkedRefCards("Y", [{ uid: "refDDDD04", pageTitle: "Notes" }], "page");
  assert.deepEqual(at(fake, second.ids[0]), [820, 300]);
  assert.deepEqual(first.ids.map((u) => at(fake, u)), [[460, 100], [764, 100], [460, 284]], "the first batch is not moved");
  assert.equal(updates(fake).length, 0);
});

test("addLinkedRefCards keeps clear of an existing section's title, not only its frame", async () => {
  // One card at (460,100)..(740,260). A section 28 below it would have its title on the card's bottom 4 px.
  const near = (gap) => {
    resetSessions();
    const { fake, session } = setup([card("X", "[[Alpha]]", 100, 100, 280, 160), card("S", "Below", 400, 260 + gap, 400, 200, { type: "section" })]);
    return session.addLinkedRefCards("X", three.slice(0, 1), "flat").then((res) => at(fake, res.ids[0]));
  };
  assert.deepEqual(await near(28), [880, 100], "moved 80 past the section");
  assert.deepEqual(await near(32), [460, 100], "32 clear of the frame is clear of the title");
});

test("addLinkedRefCards from a card at the top of a crowded section is one undo step and moves no member", async () => {
  const members = Array.from({ length: 23 }, (_, i) => card(`mem${String(i).padStart(4, "0")}`, `note ${i}`, 40, 2200 + i * 30, 120, 20));
  for (const mode of ["flat", "page"]) {
    resetSessions();
    const { fake, session } = setup([card("S", "Frame", 0, 0, 5000, 4000, { type: "section" }, [card("X", "[[Alpha]]", 40, 0, 280, 160), ...members])]);
    fake.trackUndo = true;
    const res = await session.addLinkedRefCards("X", refsOn(["Notes"], 30), mode);
    // Starting inside S's 24 px pad would grow S upward and rewrite all 23 members: 47 writes, two undo steps.
    assert.equal(at(fake, res.ids[0])[1], mode === "flat" ? 24 : 32, `${mode}: starts below the pad (a section's title too)`);
    assert.deepEqual([creates(fake).length, updates(fake).length], [22, 0], mode);
    assert.deepEqual([fake.props("S").plexus.y, fake.props("mem0000").plexus.y], [0, 2200]);
    await session.undo();
    assert.ok(res.ids.every((u) => !fake.block(u)), `${mode}: one undo takes it all back`);
  }
});

test("addLinkedRefCards lowers the cap when auto-fit must also move a crowded section, so one undo still takes it all", async () => {
  // A sits in B's top-left corner, inside B's pad: growing A grows B up and left, and B's 30 members are rewritten.
  const members = Array.from({ length: 30 }, (_, i) => card(`mem${String(i).padStart(4, "0")}`, `note ${i}`, 1000 + (i % 6) * 130, 2200 + Math.floor(i / 6) * 40, 120, 20));
  const inner = card("A", "Inner", 0, 0, 600, 400, { type: "section" }, [card("X", "[[Alpha]]", 40, 40, 280, 160)]);
  const { fake, session } = setup([card("B", "Outer", 0, 0, 3000, 3000, { type: "section" }, [inner, ...members])]);
  fake.trackUndo = true;
  const res = await session.addLinkedRefCards("X", refsOn(["Notes"], 30), "flat");
  // A and B grown, 30 members rebased: 32 auto-fit writes leave room for 13 cards in 45
  assert.deepEqual([res.added, res.left], [13, 17]);
  assert.deepEqual([creates(fake).length, updates(fake).length], [13, 32]);
  await session.undo();
  assert.ok(res.ids.every((u) => !fake.block(u)), "one undo takes it all back");
  assert.deepEqual(fake.props("mem0000").plexus, { x: 1000, y: 2200, w: 120, h: 20 }, "and puts the members back");
});

test("addLinkedRefCards stores a non-default card size on each card, so the cards it spaced by that size do not overlap", async () => {
  const small = { "default-card-width": 200, "default-card-height": 100 };
  const overlapping = (rs) => rs.some((a, i) => rs.slice(i + 1).some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
  {
    const { fake, session } = setup([card("X", "[[Alpha]]", 100, 100, 280, 160)], small);
    const res = await session.addLinkedRefCards("X", three, "flat");
    assert.deepEqual(res.ids.map((u) => fake.props(u).plexus), [{ x: 460, y: 100, w: 200, h: 100 }, { x: 684, y: 100, w: 200, h: 100 }, { x: 460, y: 224, w: 200, h: 100 }]);
    const drawn = res.ids.map((u) => session.rects.get(u));
    assert.deepEqual(drawn.map((r) => [r.w, r.h]), [[200, 100], [200, 100], [200, 100]]);
    assert.equal(overlapping(drawn), false);
  }
  resetSessions();
  {
    const { fake, session } = setup([card("X", "[[Alpha]]", 100, 100, 280, 160)], small);
    const res = await session.addLinkedRefCards("X", three, "page");
    const [notes, zed] = res.ids;
    // 32 + 200 + 24 + 200 + 32 = 488 wide; Zed starts 64 after it
    assert.deepEqual(fake.props(notes).plexus, { type: "section", x: 460, y: 100, w: 488, h: 164 });
    assert.deepEqual(fake.props(zed).plexus, { type: "section", x: 1012, y: 100, w: 264, h: 164 });
    assert.deepEqual(fake.children(notes).map((u) => fake.props(u).plexus), [{ x: 32, y: 32, w: 200, h: 100 }, { x: 256, y: 32, w: 200, h: 100 }]);
    assert.equal(overlapping(fake.children(notes).map((u) => session.rects.get(u))), false);
    assert.equal(overlapping(res.ids.map((u) => session.rects.get(u))), false, "the sections do not overlap");
    assert.equal(updates(fake).length, 0, "auto-fit grows nothing");
  }
  resetSessions();
  {
    const { fake, session } = setup([card("X", "[[Alpha]]", 100, 100, 280, 160)], { "default-card-width": 280, "default-card-height": 160 });
    const res = await session.addLinkedRefCards("X", three.slice(0, 1), "flat");
    assert.deepEqual(fake.props(res.ids[0]).plexus, { x: 460, y: 100 }, "the default size is not written");
  }
});

test("addLinkedRefCards counts sections toward the spread cap and stays under the undo budget", async () => {
  assert.equal(SPREAD_CAP, 22);
  const many = refsOn(["P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"], 3);
  {
    const { fake, session } = setup([card("X", "[[Alpha]]", 100, 100, 280, 160)]);
    const toasts = [];
    session.on("toast", (t) => toasts.push(t.message));
    const res = await session.addLinkedRefCards("X", many, "page");
    assert.deepEqual([res.added, res.sections, res.total, res.left], [16, 6, 30, 14]);
    assert.equal(creates(fake).length, 22);
    assert.ok(fake.writesLog().length <= 45, `writes ${fake.writesLog().length}`);
    assert.deepEqual(toasts, [], "the view says what was left out");
  }
  resetSessions();
  {
    const { fake, session } = setup([card("X", "[[Alpha]]", 100, 100, 280, 160)]);
    const res = await session.addLinkedRefCards("X", many, "flat");
    assert.deepEqual([res.added, res.total, res.left], [22, 30, 8]);
    assert.equal(creates(fake).length, 22);
  }
});

test("addLinkedRefCards writes nothing when every reference is on the board, or for a missing card", async () => {
  const { fake, session } = setup([card("X", "[[Alpha]]", 100, 100, 280, 160), card("h1", "((refAAAA01))", 900, 900)]);
  const res = await session.addLinkedRefCards("X", three.slice(0, 1), "page");
  assert.deepEqual([res.added, res.total, res.ids.length], [0, 0, 0]);
  assert.deepEqual((await session.addLinkedRefCards("nope", three, "flat")).added, 0);
  assert.equal(fake.writesLog().length, 0);
});
