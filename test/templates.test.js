import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/templates.js";
import { TEMPLATE_PAGE, TEMPLATE_WRITE_CAP, STARTERS, planCopy, planTemplate, templateUndo } from "../src/model/templates.js";
import { boardString } from "../src/model/schema.js";

afterEach(() => resetSessions());

const titles = [
  ["five-why", "5-Why"],
  ["fishbone", "Fishbone (6M)"],
  ["8d", "8D"],
  ["swot", "SWOT"],
  ["kanban", "Kanban"],
  ["timeline", "Timeline"],
  ["process", "Process flow"],
  ["meeting", "Meeting notes"],
  ["retro", "Retro"],
];

let seq = 0;
const genUid = () => `u${seq += 1}`;

test("TP-1: every starter clones under the write cap, keeps props, and rewrites inside refs", () => {
  assert.deepEqual(STARTERS.map((s) => [s.id, s.title]), titles);
  for (const [id, title] of titles) {
    seq = 0;
    const plan = planTemplate(id, { genUid, parentUid: "page" });
    assert.ok(plan, id);
    assert.equal(plan.creates[0].string, boardString(title));
    assert.equal(plan.creates[0].parent, "page");
    assert.ok(plan.chunks.every((c) => c.length <= TEMPLATE_WRITE_CAP && c.length > 0));
    assert.equal(plan.chunks.flat().length, plan.creates.length);
    const uids = new Set(plan.creates.map((op) => op.uid));
    for (const op of plan.creates) {
      if (op !== plan.creates[0]) assert.ok(uids.has(op.parent), `${id} parent ${op.parent}`);
      const px = op.props?.plexus;
      if (px?.type === "edge") {
        assert.ok(uids.has(px.from) && uids.has(px.to), `${id} edge ends`);
        assert.match(op.string, new RegExp(`\\(\\(${px.from}\\)\\).*\\(\\(${px.to}\\)\\)`));
      }
      if (px?.type === "section" || px?.type === "card") {
        assert.equal(typeof px.x, "number");
        assert.equal(typeof px.y, "number");
      }
    }
    assert.deepEqual(templateUndo(plan.rootUid), { op: "delete", uid: plan.rootUid });
  }
});

test("TP-1: a template over 45 blocks is split, and an outside ref stays", () => {
  const children = [];
  for (let i = 0; i < 50; i += 1) {
    children.push({
      ":block/uid": `c${i}`,
      ":block/string": i === 0 ? "see ((c1)) and ((outside))" : `card ${i}`,
      ":block/props": { plexus: { type: "card", x: i, y: 0, w: 200, h: 80, v: 2 } },
      ":block/children": [],
    });
  }
  const tree = {
    ":block/uid": "root",
    ":block/string": boardString("Fat"),
    ":block/props": { plexus: { v: 2 } },
    ":block/children": children,
  };
  seq = 0;
  const plan = planCopy(tree, { genUid, parentUid: "page" });
  assert.equal(plan.creates.length, 51);
  assert.deepEqual(plan.chunks.map((c) => c.length), [45, 6]);
  const first = plan.creates[1];
  const second = plan.uidMap.get("c1");
  assert.equal(first.string, `see ((${second})) and ((outside))`);
  assert.equal(first.props.plexus.x, 0);
});

function setup() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", string: "{{[[diagram]]:Fixture}}", props: { plexus: { v: 2 } }, children: [] });
  const session = acquireSession("b1", { host, settings: null, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}

test("TP-1: insert writes one board and undo deletes that root", async () => {
  const { fake, session } = setup();
  const toasts = [];
  session.on("toast", (t) => toasts.push(t));
  const uid = await session.insertTemplate("swot", { x: 40, y: 50, w: 320, h: 220 });
  assert.equal(fake.block(uid).string, boardString("SWOT"));
  assert.equal(fake.block(uid).parent, "b1");
  assert.equal(fake.children(uid).length, 4);
  assert.deepEqual(fake.children(uid).map((id) => fake.block(id).string), ["Strengths", "Weaknesses", "Opportunities", "Threats"]);
  const undo = toasts.at(-1);
  assert.equal(undo.message, "Inserted SWOT");
  await undo.action.run();
  assert.equal(fake.block(uid), null);
  assert.deepEqual(fake.children("b1"), []);
});

test("TP-1: save copies the board onto the templates page and undo deletes the copy", async () => {
  const { fake, host, session } = setup();
  const made = await session.insertTemplate("kanban", { x: 0, y: 0, w: 320, h: 220 });
  fake.clearLog();
  const toasts = [];
  session.on("toast", (t) => toasts.push(t));
  const saved = await session.saveAsTemplate();
  assert.equal(host.pageUid(TEMPLATE_PAGE) != null, true);
  const page = host.pageUid(TEMPLATE_PAGE);
  assert.equal(fake.block(saved).parent, page);
  assert.equal(fake.block(saved).string, "{{[[diagram]]:Fixture}}");
  const nested = fake.children(saved).find((id) => fake.block(id).string === boardString("Kanban"));
  assert.ok(nested, "the saved copy still holds the kanban board");
  assert.notEqual(nested, made);
  const undo = toasts.at(-1);
  assert.equal(undo.label ?? undo.action.label, "Undo");
  await undo.action.run();
  assert.equal(fake.block(saved), null);
  assert.equal(fake.block(made).string, boardString("Kanban"));
});

test("TP-1: saving more than 45 blocks toasts each chunk and one undo", async () => {
  const { fake, session } = setup();
  for (let i = 0; i < 50; i += 1) {
    await session.createCard({ x: 2000 + (i % 10) * 40, y: 2000 + Math.floor(i / 10) * 40, string: `c${i}`, w: 20, h: 20 });
  }
  const toasts = [];
  session.on("toast", (t) => toasts.push(t));
  const saved = await session.saveAsTemplate();
  assert.equal(toasts[0].message, "Template 1 of 2");
  assert.equal(toasts[1].message, "Template 2 of 2");
  assert.equal(toasts.at(-1).message, "Saved board as template");
  assert.equal(toasts.at(-1).action.label, "Undo");
  await toasts.at(-1).action.run();
  assert.equal(fake.block(saved), null);
  assert.equal(fake.children("b1").length, 50);
});
