// The pdf.js document cache never destroys a document that a crop is still using.
import assert from "node:assert/strict";
import test from "node:test";
import { createDocCache } from "../src/host/doc-cache.js";

const mkDoc = (n) => ({ n, destroyed: false, destroy() { this.destroyed = true; } });
const tick = () => new Promise((r) => setTimeout(r, 0));

test("three crops of one url mounting together share one document", async () => {
  const cache = createDocCache({ cap: 4 });
  const made = [];
  const load = async () => { await tick(); const d = mkDoc(made.length); made.push(d); return d; };
  const leases = await Promise.all([cache.acquire("u", load), cache.acquire("u", load), cache.acquire("u", load)]);
  assert.equal(made.length, 1, "one open for three callers");
  assert.ok(leases.every((l) => l.doc === made[0]));
  assert.equal(made[0].destroyed, false);
  leases.forEach((l) => l.release());
  assert.equal(made[0].destroyed, false, "a cached document stays open after release");
});

test("six PDFs at once with a cap of 4: nothing is destroyed while leased, evicted ones go on release", async () => {
  const cache = createDocCache({ cap: 4 });
  const docs = [];
  const leases = await Promise.all(Array.from({ length: 6 }, (_, i) => cache.acquire(`p${i}`, async () => { await tick(); const d = mkDoc(i); docs.push(d); return d; })));
  assert.ok(leases.every(Boolean));
  assert.equal(docs.some((d) => d.destroyed), false, "no document destroyed under its user");
  assert.equal(cache.size(), 4);
  leases.forEach((l) => l.release());
  assert.equal(docs.filter((d) => d.destroyed).length, 2, "the two evicted documents are destroyed once released");
  assert.equal(docs.filter((d) => !d.destroyed).length, 4);
});

test("a replaced document is destroyed when its last lease goes", async () => {
  const cache = createDocCache({ cap: 4 });
  const a = mkDoc("a");
  const b = mkDoc("b");
  const lease = await cache.acquire("u", async () => a);
  cache.set("u", b);
  assert.equal(a.destroyed, false);
  lease.release();
  assert.equal(a.destroyed, true);
  assert.equal(cache.get("u"), b);
});

test("a failed open is not cached and a later caller tries again", async () => {
  const cache = createDocCache();
  assert.equal(await cache.acquire("u", async () => { throw new Error("nope"); }), null);
  assert.equal(await cache.acquire("u", async () => null), null);
  const ok = await cache.acquire("u", async () => mkDoc("ok"));
  assert.equal(ok.doc.n, "ok");
});

test("clear destroys everything, leased or not", async () => {
  const cache = createDocCache();
  const d = mkDoc("x");
  await cache.acquire("u", async () => d);
  cache.clear();
  assert.equal(d.destroyed, true);
  assert.equal(cache.size(), 0);
});
