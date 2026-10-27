// PXD-10: a section bound to a tag or an attribute writes it onto the cards dropped in and takes it off on the way out.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/session-bucket.js";
import {
  addTag,
  attrsOfKids,
  bindingKey,
  bindingLabel,
  chunk,
  hasTag,
  parseBinding,
  planBucketAdd,
  planBucketRemove,
  planChainChange,
  readBinding,
  removeTag,
  tagToken,
} from "../src/model/bucket.js";

afterEach(() => resetSessions());

const TAG = { kind: "tag", tag: "reviewed" };
const ATTR = { kind: "attr", name: "Status", value: "Review" };

// ---------------------------------------------------------------- model

test("PXD-10 parseBinding: tag forms, attribute, refused and empty", () => {
  assert.deepEqual(parseBinding("#reviewed"), TAG);
  assert.deepEqual(parseBinding("  reviewed "), TAG, "a bare word is a tag");
  assert.deepEqual(parseBinding("#[[two words]]"), { kind: "tag", tag: "two words" });
  assert.deepEqual(parseBinding("[[two words]]"), { kind: "tag", tag: "two words" });
  assert.deepEqual(parseBinding("Status:: Review"), ATTR);
  assert.deepEqual(parseBinding("Status::Review "), ATTR);
  assert.equal(parseBinding("BT_attrStatus:: Review"), null, "Better Tasks fields are never bound");
  assert.equal(parseBinding("Status::"), null, "an attribute needs a value");
  assert.equal(parseBinding("Title:: x"), null, "a fixed table column name is refused");
  assert.equal(parseBinding(""), null);
  assert.equal(parseBinding("   "), null);
  assert.equal(parseBinding("#"), null);
  assert.equal(parseBinding("two words"), null);
  assert.equal(parseBinding(null), null);
});

test("PXD-10 readBinding validates what is stored; labels and keys are stable", () => {
  assert.deepEqual(readBinding({ bucket: TAG }), TAG);
  assert.deepEqual(readBinding({ bucket: ATTR }), ATTR);
  assert.equal(readBinding({ bucket: { kind: "tag", tag: " " } }), null);
  assert.equal(readBinding({ bucket: { kind: "attr", name: "BT_attrX", value: "a" } }), null);
  assert.equal(readBinding({ bucket: "#x" }), null);
  assert.equal(readBinding({}), null);
  assert.equal(readBinding(null), null);
  assert.equal(bindingLabel(TAG), "#reviewed");
  assert.equal(bindingLabel({ kind: "tag", tag: "two words" }), "#[[two words]]");
  assert.equal(bindingLabel(ATTR), "Status:: Review");
  assert.equal(bindingLabel(null), "");
  assert.notEqual(bindingKey(TAG), bindingKey(ATTR));
  assert.equal(tagToken("a/b-c.d"), "#a/b-c.d");
  assert.equal(tagToken("a b"), "#[[a b]]");
});

test("PXD-10 tags: no duplicate, two-word tags, a prefix tag is another tag, a plain [[tag]] stays on remove", () => {
  assert.equal(addTag("note", "reviewed"), "note #reviewed");
  assert.equal(addTag("note #reviewed", "reviewed"), "note #reviewed");
  assert.equal(addTag("note [[reviewed]]", "reviewed"), "note [[reviewed]]", "a page ref already counts");
  assert.equal(addTag("note #review", "reviewed"), "note #review #reviewed", "#review is not #reviewed");
  assert.equal(addTag("note #reviewed2", "reviewed"), "note #reviewed2 #reviewed");
  assert.equal(addTag("", "reviewed"), "#reviewed", "no leading space");
  assert.equal(addTag("note", "two words"), "note #[[two words]]");
  assert.equal(addTag("note #[[two words]]", "two words"), "note #[[two words]]");
  assert.equal(hasTag("x #reviewed y", "reviewed"), true);
  assert.equal(hasTag("x #review", "reviewed"), false);
  assert.equal(hasTag("x a#reviewed", "reviewed"), false);
  assert.equal(removeTag("note #reviewed", "reviewed"), "note");
  assert.equal(removeTag("a #reviewed b", "reviewed"), "a b");
  assert.equal(removeTag("#reviewed note", "reviewed"), "note");
  assert.equal(removeTag("note #[[two words]]", "two words"), "note");
  assert.equal(removeTag("n #reviewed2 #review", "reviewed"), "n #reviewed2 #review");
  assert.equal(removeTag("n [[reviewed]] #reviewed", "reviewed"), "n [[reviewed]]", "[[tag]] is content");
  assert.equal(removeTag("{{[[TODO]]}} do it #reviewed", "reviewed"), "{{[[TODO]]}} do it");
  assert.equal(removeTag("{{[[TODO]]}} do it", "TODO"), "{{[[TODO]]}} do it", "markers are untouched");
});

test("PXD-10 attrsOfKids reads raw children like the table does", () => {
  const kids = [
    { ":block/uid": "k1", ":block/string": "Status:: Todo" },
    { uid: "k2", string: "Owner:: Sam" },
    { uid: "k3", string: "plain child" },
    { uid: "k4", string: "BT_attrDue:: today" },
  ];
  assert.deepEqual(attrsOfKids(kids), [
    { name: "Status", value: "Todo", uid: "k1" },
    { name: "Owner", value: "Sam", uid: "k2" },
  ]);
  assert.deepEqual(attrsOfKids(null), []);
});

test("PXD-10 plan add and remove: tag strings, attribute update / create / delete", () => {
  const row = { uid: "u", string: "note", attrs: [] };
  assert.deepEqual(planBucketAdd(TAG, row), { op: "string", uid: "u", string: "note #reviewed" });
  assert.equal(planBucketAdd(TAG, { ...row, string: "note #reviewed" }), null);
  assert.deepEqual(planBucketRemove(TAG, { ...row, string: "note #reviewed" }), { op: "string", uid: "u", string: "note" });
  assert.equal(planBucketRemove(TAG, row), null);
  assert.deepEqual(planBucketAdd(ATTR, row), { op: "create", parent: "u", string: "Status:: Review" });
  const had = { ...row, attrs: [{ name: "Status", value: "Todo", uid: "a1" }] };
  assert.deepEqual(planBucketAdd(ATTR, had), { op: "string", uid: "a1", string: "Status:: Review" });
  assert.equal(planBucketAdd(ATTR, { ...row, attrs: [{ name: "Status", value: "Review", uid: "a1" }] }), null);
  assert.deepEqual(planBucketRemove(ATTR, { ...row, attrs: [{ name: "Status", value: "Review", uid: "a1" }] }), { op: "delete", uid: "a1" });
  assert.equal(planBucketRemove(ATTR, had), null, "another value is not ours to delete");
  assert.equal(planBucketAdd(null, row), null);
});

test("PXD-10 planChainChange: in, out, between two tags, same attribute name, same binding nested", () => {
  const row = { uid: "u", string: "note #a", attrs: [] };
  const A = { kind: "tag", tag: "a" };
  const B = { kind: "tag", tag: "b" };
  assert.deepEqual(planChainChange([], [TAG], row), [{ op: "string", uid: "u", string: "note #a #reviewed" }]);
  assert.deepEqual(planChainChange([A], [], row), [{ op: "string", uid: "u", string: "note" }]);
  assert.deepEqual(planChainChange([A], [B], row), [{ op: "string", uid: "u", string: "note #b" }], "one string op for two tag changes");
  assert.deepEqual(planChainChange([A, B], [A, B], row), [], "same chain");
  assert.deepEqual(planChainChange([A], [A, B], row), [{ op: "string", uid: "u", string: "note #a #b" }], "the nested binding already held is untouched");
  assert.deepEqual(planChainChange([B, A], [A], { ...row, string: "note #a #b" }), [{ op: "string", uid: "u", string: "note #a" }]);
  const withStatus = { uid: "u", string: "note", attrs: [{ name: "Status", value: "Todo", uid: "a1" }] };
  assert.deepEqual(
    planChainChange([{ kind: "attr", name: "Status", value: "Todo" }], [ATTR], withStatus),
    [{ op: "string", uid: "a1", string: "Status:: Review" }],
    "one update, no delete and create",
  );
  assert.deepEqual(planChainChange([{ kind: "attr", name: "Status", value: "Todo" }], [], withStatus), [{ op: "delete", uid: "a1" }]);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk(Array.from({ length: 100 }, (_, i) => i)).map((c) => c.length), [45, 45, 10]);
});

// ---------------------------------------------------------------- session

const card = (uid, string, x, y, extra = {}, children = []) => ({ uid, string, props: { plexus: { x, y, w: 200, h: 100, ...extra } }, children });
const section = (uid, x, y, extra = {}, children = []) => ({ uid, string: uid, props: { plexus: { type: "section", x, y, w: 300, h: 300, ...extra } }, children });

function setup({ bucket = TAG, children, kids = [] } = {}) {
  const fake = createFakeRoam();
  const real = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const watchers = [];
  const groups = [];
  const customs = [];
  const host = Object.create(real);
  host.watchBoard = (id, cb) => { watchers.push(cb); return real.watchBoard(id, cb); };
  host.group = (fn, label) => { groups.push(label); return real.group(fn, label); };
  host.setCustomUndo = (c) => { customs.push(c); return real.setCustomUndo?.(c); };
  fake.seedPage({ title: "Target page", uid: "TP", children: [{ uid: "abc", string: "Target text", children: kids }] });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: children ?? [
      card("n1", "Note one", 0, 0),
      card("c1", "((abc))", 0, 200),
      section("S", 400, 0, bucket ? { bucket } : {}, [card("m1", "member", 20, 40)]),
    ],
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  return { fake, real, host, session, watchers, groups, customs };
}
const updates = (fake) => fake.writesLog().filter((e) => e[0] === "update");
const plexusOf = (fake, uid) => fake.props(uid)?.plexus;
const tick = () => new Promise((r) => setTimeout(r, 20));

test("PXD-10 bind and unbind write the section's props only; layout writes keep the binding", async () => {
  const { fake, session } = setup({ bucket: null });
  assert.equal(session.sectionBinding("S"), null);
  assert.equal(await session.bindSection("S", TAG), true);
  await fake.flush();
  assert.deepEqual(plexusOf(fake, "S").bucket, TAG);
  assert.equal(plexusOf(fake, "S").type, "section");
  assert.equal(plexusOf(fake, "S").w, 300, "other props stay");
  assert.deepEqual(fake.writesLog().map((e) => e[0]), ["update"], "nothing written to cards");
  assert.deepEqual(session.sectionBinding("S"), TAG);
  assert.equal(await session.bindSection("S", TAG), false, "same binding writes nothing");
  await session.setColor(["S"], "teal");
  await fake.flush();
  assert.deepEqual(plexusOf(fake, "S").bucket, TAG, "a later layout write keeps bucket");
  assert.equal(plexusOf(fake, "S").color, "teal");
  assert.equal(await session.bindSection("S", ATTR), true);
  assert.deepEqual(plexusOf(fake, "S").bucket, ATTR);
  assert.equal(await session.bindSection("S", null), true);
  await fake.flush();
  assert.equal(plexusOf(fake, "S").bucket, undefined);
  assert.equal(plexusOf(fake, "S").color, "teal");
  assert.equal(session.sectionBinding("S"), null);
  assert.equal(await session.bindSection("n1", TAG), false, "only sections bind");
});

test("PXD-10 drop in: a note card gets the tag on its own string", async () => {
  const { fake, session } = setup();
  await session.commitMove(["n1"], 400, 0);
  await fake.flush();
  assert.equal(fake.block("n1").parent, "S");
  assert.equal(fake.block("n1").string, "Note one #reviewed");
  assert.equal(session.board.items.get("n1").string, "Note one #reviewed");
});

test("PXD-10 drop in: a ref card writes the tag onto the block it points at", async () => {
  const { fake, session } = setup();
  await session.commitMove(["c1"], 400, 0);
  await fake.flush();
  assert.equal(fake.block("c1").parent, "S");
  assert.equal(fake.block("c1").string, "((abc))", "the card itself is untouched");
  assert.equal(fake.block("abc").string, "Target text #reviewed");
});

test("PXD-10 drop in, attribute: create under a target without the attribute, update the one it has", async () => {
  const a = setup({ bucket: ATTR });
  await a.session.commitMove(["c1"], 400, 0);
  await a.fake.flush();
  const made = a.fake.children("abc");
  assert.equal(made.length, 1);
  assert.equal(a.fake.block(made[0]).string, "Status:: Review");
  resetSessions();
  const b = setup({ bucket: ATTR, kids: [{ uid: "st1", string: "Status:: Todo" }, { uid: "o1", string: "Owner:: Sam" }] });
  await b.session.commitMove(["c1"], 400, 0);
  await b.fake.flush();
  assert.equal(b.fake.block("st1").string, "Status:: Review");
  assert.deepEqual(b.fake.children("abc"), ["st1", "o1"], "no new child");
});

test("PXD-10 drop out: the tag comes off, an attribute child with the bound value is deleted", async () => {
  const a = setup({ children: [
    section("S", 400, 0, { bucket: TAG }, [card("n1", "Note one #reviewed", 20, 40), card("c1", "((abc))", 20, 160)]),
  ] });
  await a.session.commitMove(["n1"], -500, 0);
  await a.fake.flush();
  assert.equal(a.fake.block("n1").parent, "b1");
  assert.equal(a.fake.block("n1").string, "Note one");
  resetSessions();
  const b = setup({ bucket: ATTR, kids: [{ uid: "st1", string: "Status:: Review" }], children: [
    section("S", 400, 0, { bucket: ATTR }, [card("c1", "((abc))", 20, 40)]),
  ] });
  await b.session.commitMove(["c1"], -500, 0);
  await b.fake.flush();
  assert.equal(b.fake.block("c1").parent, "b1");
  assert.equal(b.fake.block("st1"), null, "the Status child is gone");
  resetSessions();
  const c = setup({ bucket: ATTR, kids: [{ uid: "st1", string: "Status:: Done" }], children: [
    section("S", 400, 0, { bucket: ATTR }, [card("c1", "((abc))", 20, 40)]),
  ] });
  await c.session.commitMove(["c1"], -500, 0);
  await c.fake.flush();
  assert.equal(c.fake.block("st1").string, "Status:: Done", "another value stays");
});

test("PXD-10 an unbound section adds no writes", async () => {
  const { fake, session } = setup({ bucket: null });
  await session.commitMove(["n1", "c1"], 400, 0);
  await fake.flush();
  assert.equal(fake.block("n1").string, "Note one");
  assert.equal(fake.block("abc").string, "Target text");
  assert.equal(fake.writesLog().filter((e) => e[0] === "update" && e.some((x) => typeof x === "string" && /#reviewed|Status::/.test(x))).length, 0);
  assert.equal(JSON.stringify(fake.writesLog()).includes("Status::"), false);
  assert.equal(fake.children("abc").length, 0);
});

test("PXD-10 moving a section into a bound section tags its cards; a section dragged out untags them", async () => {
  const { fake, session } = setup({ children: [
    section("B", 800, 0, { bucket: TAG }),
    section("S", 0, 0, {}, [card("n1", "inner", 20, 40)]),
  ] });
  await session.commitMove(["S"], 800, 0);
  await fake.flush();
  assert.equal(fake.block("S").parent, "B");
  assert.equal(fake.block("n1").string, "inner #reviewed");
  await session.commitMove(["S"], -800, 0);
  await fake.flush();
  assert.equal(fake.block("S").parent, "b1");
  assert.equal(fake.block("n1").string, "inner");
});

test("PXD-10 one-shot: 100 cards write in groups of 45, 45, 10; a second run writes nothing", async () => {
  const cards = Array.from({ length: 100 }, (_, i) => card(`k${i}`, `card ${i}`, (i % 10) * 10, Math.floor(i / 10) * 10));
  const { fake, session, groups } = setup({ children: [section("S", 400, 0, { bucket: TAG }, cards)] });
  const res = await session.writeSectionToGraph("S");
  await fake.flush();
  assert.equal(res, 100);
  assert.equal(groups.length, 3, `one transaction per chunk: ${groups.length}`);
  assert.equal(fake.writesLog().filter((e) => e[0] === "update").length, 100);
  assert.ok(fake.block("k0").string.endsWith("#reviewed") && fake.block("k99").string.endsWith("#reviewed"));
  fake.clearLog();
  const again = await session.writeSectionToGraph("S");
  await fake.flush();
  assert.equal(again, 0);
  assert.equal(fake.writesLog().length, 0);
});

test("PXD-10 one-shot: unbound or empty writes nothing and says so", async () => {
  const { fake, session } = setup({ children: [section("S", 400, 0, { bucket: TAG }), section("U", 0, 0)] });
  const toasts = [];
  session.on("toast", (t) => toasts.push(t.message));
  assert.equal(await session.writeSectionToGraph("U"), 0);
  assert.equal(await session.writeSectionToGraph("S"), 0);
  assert.deepEqual(toasts, ["No cards to tag"]);
  assert.equal(fake.writesLog().length, 0);
});

test("PXD-10 one-shot toast and ref cards sharing a target write once", async () => {
  const { fake, session } = setup({ children: [section("S", 400, 0, { bucket: TAG }, [card("c1", "((abc))", 20, 40), card("c2", "((abc))", 20, 160), card("n1", "plain", 20, 260)])] });
  const toasts = [];
  session.on("toast", (t) => toasts.push(t.message));
  assert.equal(await session.writeSectionToGraph("S"), 2);
  await fake.flush();
  assert.equal(fake.block("abc").string, "Target text #reviewed");
  assert.equal(fake.block("n1").string, "plain #reviewed");
  assert.deepEqual(toasts, ["Tagged 2 cards with #reviewed"]);
  assert.equal(await session.writeSectionToGraph("S"), 0, "a second run reads the written strings");
});

test("PXD-10 echo: a stale snapshot after the drop does not bounce the card back", async () => {
  const { fake, real, session, watchers } = setup();
  const stale = JSON.parse(JSON.stringify(real.pullBoard("b1", { light: true })));
  await session.commitMove(["n1"], 400, 0);
  assert.equal(session.board.items.get("n1").parentUid, "S");
  for (const cb of watchers) cb(stale);
  await tick();
  assert.equal(session.board.items.get("n1").string, "Note one #reviewed", "the new string stays");
  assert.equal(session.board.items.get("n1").parentUid, "S", "membership stays");
  await fake.flush();
  for (const cb of watchers) cb(JSON.parse(JSON.stringify(real.pullBoard("b1", { light: true }))));
  await tick();
  assert.equal(session.board.items.get("n1").string, "Note one #reviewed");
  assert.equal(session.board.items.get("n1").parentUid, "S");
});

test("PXD-10 a big drag installs a custom undo that restores strings, created and deleted children", async () => {
  const cards = Array.from({ length: 20 }, (_, i) => card(`k${i}`, `card ${i}`, i * 3, i * 3));
  const { fake, session, customs } = setup({ bucket: ATTR, children: [
    card("c1", "((abc))", 0, 100),
    ...cards,
    section("S", 800, 0, { bucket: ATTR }),
  ], kids: [{ uid: "st1", string: "Status:: Todo" }] });
  const ids = ["c1", ...cards.map((c) => c.uid)];
  await session.commitMove(ids, 800, 0);
  await fake.flush();
  assert.ok(customs.some((c) => c && typeof c.undo === "function"), "past 45 writes the undo is custom");
  assert.equal(fake.block("st1").string, "Status:: Review");
  assert.equal(fake.block("k0").parent, "S");
  assert.equal(fake.children("k0").length, 1, "the attribute child of a note card is created under it");
  const entry = customs.filter(Boolean).at(-1);
  await entry.undo();
  await fake.flush();
  assert.equal(fake.block("st1").string, "Status:: Todo", "the update is undone");
  assert.equal(fake.children("k0").length, 0, "the created child is removed");
  assert.equal(fake.block("k0").parent, "b1");
});
