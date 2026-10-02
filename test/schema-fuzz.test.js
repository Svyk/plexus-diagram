import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { buildBoard } from "../src/model/board.js";
import { ITEM_TYPES, normalizeItemLayout } from "../src/model/schema.js";
import { mountBoardView } from "../src/view/board-view.js";
import "../src/session-clip.js";
import "../src/snapshots.js";
import "../src/templates.js";

afterEach(() => resetSessions());

const FIELDS = ["x", "y", "w", "h", "color", "collapsed", "fontSize", "pinned", "fit", "look", "axis", "textColor", "align", "fill", "border", "titleSize", "titleColor", "titleFill", "areaFill", "shape"];
const WRONG = ["12", true, false, null, [], {}, "mauve", ""];
const JUNK = [NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE, 1e308, -1e308, ...WRONG];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

// Every bag has an unknown key, a NaN, a wrong type, and a huge finite number.
function bag(type, rng) {
  const props = { type, mystery: "kept" };
  for (const key of FIELDS) props[key] = pick(rng, JUNK);
  props.x = NaN;
  props.y = pick(rng, WRONG);
  props.w = 1e20;
  props.h = 1e20;
  props.fontSize = Number.MAX_VALUE;
  props[`zz${Math.floor(rng() * 1e6)}`] = Number.MAX_VALUE;
  return props;
}

function pulled(bags) {
  const child = (uid, string, order, plexus, children = []) => ({
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { plexus },
    ":block/children": children,
  });
  return {
    ":block/uid": "b1",
    ":block/string": "{{[[diagram]]}}",
    ":block/props": { plexus: { v: 2, bg: NaN, bgColor: 4, nope: { a: 1 }, defaults: { section: { titleSize: "big", titleColor: 1, mystery: true } } } },
    ":block/children": [
      child("c", "Card", 0, bags.card),
      child("s", "Section", 1, bags.section, [child("t", "Text", 0, bags.text)]),
      child("bad", "Bad type", 2, bags.bad),
    ],
  };
}

test("HARD-1 normalize and buildBoard keep every item type finite under random junk", () => {
  for (let seed = 1; seed <= 32; seed++) {
    const rng = mulberry32(0x48415244 + seed);
    const bags = {
      card: bag("card", rng),
      section: bag("section", rng),
      text: bag("text", rng),
      bad: { ...bag("card", rng), type: ["section"] },
    };
    for (const type of ITEM_TYPES) {
      const props = bags[type];
      const n = normalizeItemLayout(props);
      assert.equal(n.type, type, `seed ${seed} ${type}`);
      assert.equal(n.x, undefined);
      assert.equal(n.y, undefined);
      assert.equal(n.w, 1e20);
      assert.equal(n.h, 1e20);
      assert.equal(n.fontSize, undefined);
      assert.equal("mystery" in n, false);
      assert.equal(Object.keys(n).some((k) => k.startsWith("zz")), false);
      assert.equal(normalizeItemLayout({ ...props, type: "nope" }).type, "card");
      assert.equal(normalizeItemLayout({ ...props, type: 1 }).type, "card");
      assert.equal(normalizeItemLayout({ ...props, type: null }).type, "card");
    }
    const board = buildBoard(pulled(bags));
    assert.ok(board);
    assert.equal(board.items.get("c").type, "card");
    assert.equal(board.items.get("s").type, "section");
    assert.equal(board.items.get("t").type, "text");
    assert.equal(board.items.get("bad").type, "card");
    for (const item of board.items.values()) {
      assert.equal(Number.isFinite(item.x), true, item.uid);
      assert.equal(Number.isFinite(item.y), true, item.uid);
      assert.equal(Number.isFinite(item.w), true, item.uid);
      assert.equal(Number.isFinite(item.h), true, item.uid);
    }
  }
  for (const bad of ["x", 1, [], null]) {
    const board = buildBoard({
      ":block/uid": "b",
      ":block/string": "{{[[diagram]]}}",
      ":block/children": [{ ":block/uid": "c", ":block/string": "C", ":block/props": { plexus: bad } }],
    });
    assert.equal(board.items.get("c").type, "card");
  }
  const kept = normalizeItemLayout({ type: "text", x: Number.MAX_VALUE, y: -Number.MAX_VALUE, w: 1e308, h: 24, fontSize: NaN, shape: Infinity });
  assert.equal(kept.type, "text");
  assert.equal(kept.x, Number.MAX_VALUE);
  assert.equal(kept.y, -Number.MAX_VALUE);
  assert.equal(kept.w, 1e308);
  assert.equal(kept.h, 24);
  assert.equal(kept.fontSize, undefined);
  assert.equal(kept.shape, undefined);
});

test("HARD-1 the board renders junk props and writes nothing until a color edit", async () => {
  for (let seed = 1; seed <= 4; seed++) {
    const rng = mulberry32(0x52454e44 + seed);
    const bags = {
      card: bag("card", rng),
      section: bag("section", rng),
      text: bag("text", rng),
      bad: { ...bag("card", rng), type: { bad: true } },
    };
    const stub = createDomStub();
    const restore = stub.install();
    try {
      const fake = createFakeRoam();
      const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
      const child = (uid, string, plexus, children) => ({ uid, string, props: { plexus }, children });
      fake.seedBoard({
        uid: "b1",
        props: { plexus: { v: 2, bg: NaN, bgColor: 4, nope: { a: 1 }, defaults: { section: { titleSize: "big", titleColor: 1, mystery: true } } } },
        children: [
          child("c", "Card", bags.card),
          child("s", "Section", bags.section, [child("t", "Text", bags.text)]),
          child("bad", "Bad type", bags.bad),
        ],
      });
      const before = {
        b1: fake.props("b1"),
        c: fake.props("c"),
        s: fake.props("s"),
        t: fake.props("t"),
        bad: fake.props("bad"),
      };
      fake.clearLog();
      const session = acquireSession("b1", {
        host,
        settings: { get: (k) => (k === "graph-links" ? "off" : undefined) },
        linkDelay: 0,
      });
      const mountEl = stub.document.createElement("div");
      stub.document.body.append(mountEl);
      const view = mountBoardView({
        host,
        session,
        mountEl,
        settings: { get: (k) => (k === "graph-links" ? "off" : undefined) },
        version: "1.3.0",
        initialViewport: { x: 40, y: 40, zoom: 1 },
      });
      for (let i = 0; i < 8; i++) {
        stub.flushFrames();
        stub.flushTimers();
        stub.flushIdle();
      }
      assert.equal(view.stats().shells, 4, `seed ${seed}`);
      assert.ok(view.stats().mounted >= 1, `seed ${seed}`);
      for (const uid of ["c", "s", "t", "bad"]) {
        const node = view.root.querySelector(`[data-uid="${uid}"]`);
        assert.ok(node, `seed ${seed} ${uid}`);
        const cls = String(node.className);
        if (uid === "s") assert.match(cls, /pxd-section/);
        else assert.match(cls, /pxd-item--card|pxd-item--text/);
        assert.match(String(node.style.width), /px$/, uid);
        assert.match(String(node.style.transform), /translate/, uid);
      }
      assert.equal(fake.writesLog().length, 0, `seed ${seed} open`);
      for (const uid of ["b1", "c", "s", "t", "bad"]) assert.deepEqual(fake.props(uid), before[uid], `seed ${seed} ${uid}`);
      const edited = ["c", "s", "t"][seed % 3];
      await session.setColor([edited], "teal");
      await session.idle();
      const writes = fake.writesLog();
      assert.ok(writes.length >= 1, `seed ${seed}`);
      assert.deepEqual(writes.map((e) => [e[0], e[1]]), [["update", edited]]);
      assert.equal(fake.props(edited).plexus.color, "teal");
      assert.equal(fake.props(edited).plexus.mystery, "kept");
      const zz = Object.keys(before[edited].plexus).find((k) => k.startsWith("zz"));
      assert.equal(fake.props(edited).plexus[zz], Number.MAX_VALUE);
      for (const uid of ["b1", "c", "s", "t", "bad"]) {
        if (uid !== edited) assert.deepEqual(fake.props(uid), before[uid], `seed ${seed} ${uid}`);
      }
      view.dispose();
      session.release();
    } finally {
      restore();
      resetSessions();
    }
  }
});
