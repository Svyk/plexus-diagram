import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { deskEntryKey, deskEntryString, deskTargetOf, sameDeskEntry } from "../src/model/desk.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";
import { sourceCss } from "./css-source.js";

test("deskEntryString: block is embed-path closed, page is embed", () => {
  assert.equal(deskEntryString({ kind: "block", uid: "abc123xyz" }), "{{embed-path: ((abc123xyz)) closed}}");
  assert.equal(deskEntryString({ kind: "page", title: "My Page" }), "{{embed: [[My Page]]}}");
});

test("deskEntryKey parses embed, embed-path, wrapped macro names and refuses junk", () => {
  assert.deepEqual(deskEntryKey("{{embed: ((u1))}}"), { kind: "block", uid: "u1" });
  assert.deepEqual(deskEntryKey("{{embed-path: ((u1)) closed}}"), { kind: "block", uid: "u1" });
  assert.deepEqual(deskEntryKey("{{[[embed]]: [[A B]]}}"), { kind: "page", title: "A B" });
  assert.deepEqual(deskEntryKey("{{[[embed-path]]: ((u2))}}"), { kind: "block", uid: "u2" });
  assert.equal(deskEntryKey("hello ((u1))"), null);
  assert.equal(deskEntryKey("{{embed: ((u1)) trailing}}"), null);
  assert.equal(deskEntryKey("{{embed: plain}}"), null);
  assert.equal(deskEntryKey(null), null);
  assert.ok(sameDeskEntry({ kind: "block", uid: "a" }, { kind: "block", uid: "a" }));
  assert.ok(!sameDeskEntry({ kind: "block", uid: "a" }, { kind: "page", title: "a" }));
});

test("deskTargetOf: page, block and ref cards", () => {
  assert.deepEqual(deskTargetOf({ uid: "c1", target: { kind: "page", title: "P" } }), { kind: "page", title: "P" });
  assert.deepEqual(deskTargetOf({ uid: "c1", target: { kind: "block" } }), { kind: "block", uid: "c1" });
  assert.deepEqual(deskTargetOf({ uid: "c1", target: { kind: "block", uid: "src" } }), { kind: "block", uid: "src" });
  assert.equal(deskTargetOf(null), null);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function deskSetup({ deskUid = "desk-1", title = "roam/desk/Me", children = [] } = {}) {
  const fake = createFakeRoam();
  fake.onQuery(/:user\/desk-page/, () => deskUid);
  if (deskUid) fake.seedPage({ title, uid: deskUid, children });
  fake.seedPage({ title: "Other", uid: "pg1", children: [{ uid: "bk1", string: "x" }] });
  const pagePull = (pattern, entity) => {
    if (String(pattern) !== "[{:block/page [:block/uid]}]") return fake.api.data.pull(pattern, entity);
    const top = fake.api.data.pull("[:block/uid {:block/children [:block/uid]}]", [":block/uid", "desk-1"]);
    const onDesk = (top?.[":block/children"] || []).some((c) => c[":block/uid"] === entity[1]);
    return { ":block/page": { ":block/uid": onDesk ? "desk-1" : "pg1" } };
  };
  const api = { ...fake.api, user: { uid: () => "me" }, data: { ...fake.api.data, pull: pagePull } };
  return { fake, host: createHost({ api, storage: fake.storage, graph: "g" }) };
}

test("addToDesk: no desk bound", async () => {
  const { host } = deskSetup({ deskUid: null });
  assert.deepEqual(await host.addToDesk({ kind: "block", uid: "bk1" }), { status: "no-desk" });
});

test("addToDesk adds the exact string as first child, then reports already", async () => {
  const { fake, host } = deskSetup({ children: [{ uid: "old", string: "older" }] });
  const res = await host.addToDesk({ kind: "block", uid: "bk1" });
  assert.equal(res.status, "added");
  assert.equal(fake.block(res.uid).string, "{{embed-path: ((bk1)) closed}}");
  const kids = host.pullBoard("desk-1")[":block/children"].map((c) => c[":block/uid"]);
  assert.deepEqual(kids, [res.uid, "old"]);
  await sleep(30);
  assert.deepEqual(await host.addToDesk({ kind: "block", uid: "bk1" }), { status: "already" });
  const page = await host.addToDesk({ kind: "page", title: "Other" });
  assert.equal(fake.block(page.uid).string, "{{embed: [[Other]]}}");
  await sleep(30);
  assert.deepEqual(await host.addToDesk({ kind: "page", title: "Other" }), { status: "already" });
});

test("addToDesk: an existing embed-path entry with extra args counts as the same entry", async () => {
  const { host } = deskSetup({ children: [{ uid: "e", string: "{{[[embed-path]]: ((bk1)) open}}" }] });
  assert.deepEqual(await host.addToDesk({ kind: "block", uid: "bk1" }), { status: "already" });
});

test("addToDesk: block on the desk page is already, desk page itself is is-desk", async () => {
  const { host } = deskSetup({ children: [{ uid: "mine", string: "note" }] });
  assert.deepEqual(await host.addToDesk({ kind: "block", uid: "mine" }), { status: "already" });
  assert.deepEqual(await host.addToDesk({ kind: "page", title: "roam/desk/Me" }), { status: "is-desk" });
});

test("card menu: add-to-desk follows open-sidebar only when canDesk", () => {
  const ids = (c) => flattenMenu(buildMenu("card", c)).map((e) => e.id);
  const on = ids({ canDesk: true });
  assert.equal(on[on.indexOf("open-sidebar") + 1], "add-to-desk");
  assert.ok(!ids({}).includes("add-to-desk"));
});

test("built extension.css scopes page-chrome rules out of Roam's Sidecar", () => {
  const css = sourceCss();
  // Every rule keyed on a Plexus class on <html> or <body> (both mirrored into the Sidecar) must exclude it.
  const bad = css.split("\n").filter((l) => /^(body|html|:root)\.pxd-/.test(l) && !l.includes("rm-sidecar"));
  assert.deepEqual(bad, []);
  assert.ok(css.includes("html:not(.rm-sidecar) > body.pxd-has-board"));
  assert.ok(css.includes(":root.pxd-sidebar-pdf:not(.rm-sidecar)"));
});
