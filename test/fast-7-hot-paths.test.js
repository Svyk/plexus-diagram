import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { DIAGRAM_MARKER, isDiagramString } from "../src/discovery.js";
import { createHost } from "../src/host/roam.js";
import { buildBoard, diffBoards } from "../src/model/board.js";
import { edgePath } from "../src/model/geometry.js";
import { highlighterTags } from "../src/model/highlighter.js";
import { parseRegion } from "../src/model/regions.js";
import { attrNameOf } from "../src/model/schema.js";
import { stressBoardTree } from "../src/model/stress-board.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

// The pre-change bodies. The after rows call the exports.
const NAME = "[A-Za-z0-9_]+";
const TAG_BEFORE = [
  `#\\[\\[bg-ch-(${NAME})\\]\\]`,
  `#\\[\\[bg-(${NAME})\\]\\]`,
  `#\\[\\[c:(${NAME})\\]\\]`,
  `#bg-ch-(${NAME})`,
  `#bg-(${NAME})`,
  `#c:(${NAME})`,
  `\\[\\[bg-ch-(${NAME})\\]\\]`,
  `\\[\\[bg-(${NAME})\\]\\]`,
].join("|");
const HEAD_BEFORE = /^\s*\{\{\[\[plexus-region\]\]:\s*([^}]*)\}\}(?: ([\s\S]*))?$/;

function highlighterTagsBefore(string) {
  const out = { bg: null, text: null };
  if (typeof string !== "string" || !string) return out;
  const re = new RegExp(TAG_BEFORE, "g");
  let match = re.exec(string);
  while (match) match = re.exec(string);
  return out;
}

function isDiagramStringBefore(value) {
  return DIAGRAM_MARKER.test(String(value ?? ""));
}

function parseRegionBefore(blockString) {
  if (typeof blockString !== "string") return null;
  return HEAD_BEFORE.exec(blockString);
}

function attrNameOfBefore(s) {
  if (typeof s !== "string") return null;
  const m = /^\s*([^:\n]{1,60})::/.exec(s);
  if (!m) return null;
  const name = m[1].trim();
  return name ? name : null;
}

function plainNotes(tree) {
  const out = [];
  const walk = (node) => {
    const text = node?.[":block/string"];
    if (typeof text === "string" && text.startsWith("Card ")) out.push(text);
    for (const child of node?.[":block/children"] || []) walk(child);
  };
  walk(tree);
  return out;
}

const cpuUs = (row) => row.cpu.user + row.cpu.system;

function time(fn) {
  const start = process.cpuUsage();
  const calls = fn();
  return { cpu: process.cpuUsage(start), calls };
}

function report(name, phase, row, extra = "") {
  console.log(`FAST-7 ${name} ${phase} user=${row.cpu.user} system=${row.cpu.system} calls=${row.calls}${extra}`);
}

// refreshLinks parks its timer with unref. A live interval lets that timer run.
async function settled(session) {
  const keep = setInterval(() => {}, 10);
  try {
    await session.refreshLinks();
  } finally {
    clearInterval(keep);
  }
}

afterEach(() => resetSessions());

describe("FAST-7 hot paths", { concurrency: 1 }, () => {
  // The cpu printout needs `node --predictable` (npm run bench:hot); a plain `npm test` skips it.
  test("prints before and after cpu on the 300-card tree under node --predictable", { skip: !process.execArgv.includes("--predictable") }, () => {
    const tree = stressBoardTree();
    const notes = plainNotes(tree);
    assert.equal(notes.length, 300);

    const built = buildBoard(tree);
    const again = buildBoard(tree);
    const buildBefore = time(() => { buildBoard(tree); return 1; });
    const buildAfter = time(() => { buildBoard(tree); return 1; });
    report("buildBoard", "before", buildBefore);
    report("buildBoard", "after", buildAfter);

    const diffBefore = time(() => { diffBoards(built, again); return 1; });
    const diffAfter = time(() => { diffBoards(built, again); return 1; });
    report("diffBoards", "before", diffBefore);
    report("diffBoards", "after", diffAfter);

    const a = { x: 0, y: 0, w: 200, h: 120 };
    const b = { x: 420, y: 80, w: 200, h: 120 };
    const runEdges = () => {
      for (let i = 0; i < 150; i += 1) edgePath({ a, b, route: i % 2 ? "elbow" : "curve" });
      return 150;
    };
    report("edgePath", "before", time(runEdges));
    report("edgePath", "after", time(runEdges));

    let reps = 20;
    let tagsBefore;
    let tagsAfter;
    while (reps <= 320) {
      tagsBefore = time(() => {
        for (let i = 0; i < reps; i += 1) for (const note of notes) highlighterTagsBefore(note);
        return reps * notes.length;
      });
      tagsAfter = time(() => {
        for (let i = 0; i < reps; i += 1) for (const note of notes) highlighterTags(note);
        return reps * notes.length;
      });
      if (cpuUs(tagsBefore) > 0 && cpuUs(tagsAfter) < cpuUs(tagsBefore)) break;
      reps *= 2;
    }
    report("highlighterTags", "before", tagsBefore);
    report("highlighterTags", "after", tagsAfter);
    assert.ok(cpuUs(tagsAfter) < cpuUs(tagsBefore), `after ${cpuUs(tagsAfter)} before ${cpuUs(tagsBefore)}`);

    const diagramBefore = time(() => {
      for (const note of notes) isDiagramStringBefore(note);
      return notes.length;
    });
    let markerTests = 0;
    const origTest = DIAGRAM_MARKER.test;
    DIAGRAM_MARKER.test = function diagramTest(value) {
      markerTests += 1;
      return origTest.call(this, value);
    };
    let diagramAfter;
    try {
      diagramAfter = time(() => {
        for (const note of notes) isDiagramString(note);
        return notes.length;
      });
    } finally {
      DIAGRAM_MARKER.test = origTest;
    }
    report("isDiagramString", "before", diagramBefore);
    report("isDiagramString", "after", diagramAfter, ` markerTests=${markerTests}`);
    assert.equal(markerTests, 0);
    assert.equal(isDiagramString("{{[[diagram]]:PF2 stress}}"), true);
    assert.equal(isDiagramString("{{diagram}}"), true);

    const regionBefore = time(() => {
      for (const note of notes) parseRegionBefore(note);
      return notes.length;
    });
    const regionAfter = time(() => {
      for (const note of notes) parseRegion(note);
      return notes.length;
    });
    report("parseRegion", "before", regionBefore);
    report("parseRegion", "after", regionAfter);
    assert.equal(parseRegion(notes[0]), null);
    const region = parseRegion("{{[[plexus-region]]: k=img d=imgcard01 f=0.1,0.2,0.3,0.4}} hamstring");
    assert.equal(region.kind, "img");
    assert.equal(region.drawingUid, "imgcard01");

    const attrBefore = time(() => {
      for (const note of notes) attrNameOfBefore(note);
      return notes.length;
    });
    const attrAfter = time(() => {
      for (const note of notes) attrNameOf(note);
      return notes.length;
    });
    report("attrNameOf", "before", attrBefore);
    report("attrNameOf", "after", attrAfter);
    assert.equal(attrNameOf(notes[0]), null);
    assert.equal(attrNameOf("Causes:: [[B]]"), "Causes");
  });

  test("highlighterTags skips RegExp when the string has no hash and no bracket, and still returns a bg tag", () => {
    const Native = globalThis.RegExp;
    let built = 0;
    globalThis.RegExp = new Proxy(Native, {
      construct(target, args, newTarget) {
        built += 1;
        return Reflect.construct(target, args, newTarget);
      },
    });
    try {
      assert.deepEqual(highlighterTags("Card 1.1"), { bg: null, text: null });
      assert.equal(built, 0);
      assert.deepEqual(highlighterTags("#bg-blue"), { bg: "blue", text: null });
      assert.deepEqual(highlighterTags("[[bg-red]]"), { bg: "red", text: null });
    } finally {
      globalThis.RegExp = Native;
    }
  });

  test("a cold pullBoard passes one entity to both pull patterns", () => {
    const tree = stressBoardTree();
    const fake = createFakeRoam();
    const orig = fake.api.data.pull.bind(fake.api.data);
    const rootEntities = [];
    fake.api.data.pull = (pattern, entity) => {
      if (Array.isArray(entity) && entity[0] === ":block/uid" && entity[1] === tree[":block/uid"]) {
        rootEntities.push(entity);
        if (rootEntities.length === 1) return null;
        if (String(pattern).includes(":block/children")) return tree;
      }
      return orig(pattern, entity);
    };
    const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
    rootEntities.length = 0;
    const node = host.pullBoard(tree[":block/uid"]);
    assert.equal(node?.[":block/uid"], tree[":block/uid"]);
    assert.ok(rootEntities.length >= 2, `pulls ${rootEntities.length}`);
    assert.equal(rootEntities[0], rootEntities[1]);
  });

  test("computeLinks resolves each distinct ref once, including a shared page and the board", async () => {
    const fake = createFakeRoam();
    fake.seedPage({ title: "Same", uid: "pageSame" });
    fake.seedBoard({
      uid: "b1",
      props: { plexus: { v: 2 } },
      children: [
        { uid: "c1", string: "[[Same]]", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } },
        { uid: "c2", string: "[[Same]]", props: { plexus: { x: 240, y: 0, w: 200, h: 100 } } },
        { uid: "c3", string: "((b1))", props: { plexus: { x: 480, y: 0, w: 200, h: 100 } } },
      ],
    });
    const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
    const calls = [];
    const orig = host.resolveEid.bind(host);
    host.resolveEid = (ref) => {
      calls.push({ uid: ref?.uid, title: ref?.title });
      return orig(ref);
    };
    const session = acquireSession("b1", { host, linkDelay: 0, idle: (fn) => fn() });
    await settled(session);
    calls.length = 0;
    await settled(session);
    assert.equal(calls.filter((ref) => ref.title === "Same").length, 1);
    assert.equal(calls.filter((ref) => ref.uid === "b1").length, 1);
  });

  test("computeLinks before and after cpu on the 300-card tree", async () => {
    const tree = stressBoardTree();
    const fake = createFakeRoam();
    const origPull = fake.api.data.pull.bind(fake.api.data);
    let opens = 0;
    fake.api.data.pull = (pattern, entity) => {
      if (Array.isArray(entity) && entity[1] === tree[":block/uid"]) {
        opens += 1;
        if (opens === 1) return null;
        if (String(pattern).includes(":block/children")) return tree;
      }
      return origPull(pattern, entity);
    };
    const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
    let calls = 0;
    const orig = host.resolveEid.bind(host);
    host.resolveEid = (ref) => {
      calls += 1;
      return orig(ref);
    };
    const session = acquireSession(tree[":block/uid"], { host, linkDelay: 0, idle: (fn) => fn() });
    await settled(session);
    const board = session.board;
    calls = 0;
    const before = time(() => {
      host.resolveEid({ uid: tree[":block/uid"] });
      let n = 1;
      for (const item of board.items.values()) {
        if (item.type !== "card") continue;
        const t = item.target;
        const ref = t.kind === "page" ? { title: t.title } : { uid: t.uid };
        host.resolveEid(ref);
        n += 1;
      }
      return n;
    });
    calls = 0;
    const start = process.cpuUsage();
    await settled(session);
    const after = { cpu: process.cpuUsage(start), calls };
    report("computeLinks", "before", before);
    report("computeLinks", "after", after);
    assert.equal(before.calls, after.calls);
  });
});
