import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";

afterEach(() => resetSessions());

function seedNative(fake) {
  fake.seedBoard({
    uid: "b1",
    props: { "rf-diagram": { keep: 1 } },
    children: [{ uid: "a", string: "Alpha" }, { uid: "b", string: "Beta" }],
    diagram: {
      nodes: [
        { id: 1, blockUid: "a", data: { position: { x: 10, y: 20 }, width: 120, height: 60 } },
        { id: 2, blockUid: "b", data: { position: { x: 180, y: 40 }, width: 120, height: 60 } },
      ],
      edges: [{ source: 1, target: 2, data: { label: "causes" } }],
    },
  });
}

test("HARD-3 edit, restore native, and re-enhance keeps the Plexus layout and the original nodes", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  seedNative(fake);
  const session = acquireSession("b1", { host, linkDelay: 0 });
  const nativeGeom = (pulled) => JSON.parse(JSON.stringify({
    nodes: pulled?.[":diagram/nodes"],
    edges: pulled?.[":diagram/edges"],
  }));
  const nativeBefore = nativeGeom(host.pullNative("b1"));

  const first = await session.enhance();
  assert.equal(first.kind, "native");
  assert.equal(session.board.enhanced, true);
  assert.equal(session.board.edges.size, 1);
  const imported = {
    a: { ...session.board.items.get("a") },
    b: { ...session.board.items.get("b") },
  };
  assert.notEqual(imported.b.x, 180, "the import scales native positions onto the board");

  await session.commitMove(["b"], 320, 40);
  await session.setColor(["a", "b"], "teal");
  await session.commitRects([{ uid: "a", x: imported.a.x, y: imported.a.y, w: 360, h: 220 }]);
  await session.createSection({ rect: { x: 40, y: 420, w: 480, h: 240 }, title: "Notes" });
  await session.idle();

  const edited = {
    a: { x: fake.props("a").plexus.x, y: fake.props("a").plexus.y, w: fake.props("a").plexus.w, h: fake.props("a").plexus.h, color: fake.props("a").plexus.color },
    b: { x: fake.props("b").plexus.x, y: fake.props("b").plexus.y, color: fake.props("b").plexus.color },
  };
  assert.equal(edited.b.x, imported.b.x + 320);
  assert.equal(edited.a.w, 360);
  assert.equal(edited.a.color, "teal");
  const sectionUid = [...session.board.items.values()].find((item) => item.type === "section").uid;
  const edgesBefore = session.board.edges.size;

  await session.restoreNative();
  assert.equal(session.board.enhanced, false);
  assert.deepEqual(fake.props("b1").plexus, { native: true });
  assert.equal(fake.props("b").plexus.x, edited.b.x);
  assert.equal(fake.props("b").plexus.color, "teal");
  assert.deepEqual(nativeGeom(host.pullNative("b1")), nativeBefore);

  fake.clearLog();
  const again = await session.enhance();
  await session.idle();

  assert.equal(again.enhanced, true);
  assert.equal(again.kind, "kept");
  assert.equal(session.board.enhanced, true);
  assert.equal(session.board.edges.size, edgesBefore);
  assert.deepEqual(
    { x: fake.props("a").plexus.x, y: fake.props("a").plexus.y, w: fake.props("a").plexus.w, h: fake.props("a").plexus.h, color: fake.props("a").plexus.color },
    edited.a,
  );
  assert.deepEqual(
    { x: fake.props("b").plexus.x, y: fake.props("b").plexus.y, color: fake.props("b").plexus.color },
    edited.b,
  );
  assert.equal(fake.props(sectionUid).plexus.type, "section");
  assert.equal(fake.props("b1").plexus.v, 2);
  assert.equal(fake.props("b1").plexus.native, undefined);
  assert.deepEqual(fake.props("b1")["rf-diagram"], { keep: 1 });
  assert.deepEqual(nativeGeom(host.pullNative("b1")), nativeBefore);
  assert.deepEqual(fake.writesLog().map((entry) => [entry[0], entry[1]]), [["update", "b1"]]);
});
