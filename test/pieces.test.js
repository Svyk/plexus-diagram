import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { deflateSync, strToU8 } from "fflate";

import { assignModules, splitCss } from "../scripts/pieces.mjs";
import { inflate, inflateBase64, pieceDefer } from "../src/piece-loader.js";

const bytes = (text) => new Uint8Array(Buffer.from(text));

test("inflate reads stored, fixed and dynamic deflate blocks", () => {
  const text = "plexus ".repeat(4000) + Array.from({ length: 5000 }, (_, i) => (i * 7919) % 251).join(",");
  const plain = bytes(text);
  for (const packed of [
    deflateRawSync(plain, { level: 0 }),
    deflateRawSync(plain, { strategy: 4 }),
    deflateRawSync(plain, { level: 9 }),
    deflateSync(strToU8(text), { level: 9 }),
  ]) assert.equal(Buffer.from(inflate(new Uint8Array(packed))).toString(), text);
  assert.equal(inflate(new Uint8Array(deflateRawSync(new Uint8Array(0)))).length, 0);
  assert.equal(Buffer.from(inflateBase64(deflateRawSync(bytes("hi")).toString("base64"))).toString(), "hi");
});

test("a module two pieces share stays in the core, and only imported modules get forwarders", () => {
  const inputs = {
    "src/extension.js": ["src/a.js", "src/b.js"],
    "src/piece-loader.js": [],
    "src/a.js": ["src/shared.js", "src/a-inner.js"],
    "src/a-inner.js": [],
    "src/b.js": ["src/shared.js"],
    "src/shared.js": ["src/deep.js"],
    "src/deep.js": [],
  };
  const metafile = { inputs: Object.fromEntries(Object.entries(inputs).map(([path, list]) => [path, { imports: list.map((p) => ({ kind: "import-statement", path: p })) }])) };
  const plan = assignModules(metafile, { one: ["src/a.js"], two: ["src/b.js"] }, "src/extension.js");
  assert.ok(plan.core.has("src/shared.js") && plan.core.has("src/deep.js"));
  assert.equal(plan.owner.get("src/a-inner.js"), "one");
  assert.deepEqual([...plan.roots.keys()].sort(), ["src/a.js", "src/b.js"]);
});

test("a CSS rule moves only when every selector names a class of that piece alone", () => {
  const css = ".pxd-read{color:red}.pxd-mix,.pxd-card{top:0}@media(min-width:1px){.pxd-read__x{left:0}.pxd-card{left:1px}}@keyframes pxd-spin{0%{top:0}}.pxd-both{top:1px}.pxd-gone{top:2px}";
  const core = 'x.className="pxd-card";';
  const { eager, lazy } = splitCss(css, core, { read: '"pxd-read pxd-read__x pxd-both pxd-mix"', ai: '"pxd-both"' });
  assert.equal(lazy.read, ".pxd-read{color:red}@media(min-width:1px){.pxd-read__x{left:0}}");
  assert.equal(eager, ".pxd-mix,.pxd-card{top:0}@media(min-width:1px){.pxd-card{left:1px}}@keyframes pxd-spin{0%{top:0}}.pxd-both{top:1px}.pxd-gone{top:2px}");
});

test("a class the core glues together from a stem stays eager", () => {
  const { lazy } = splitCss(".pxd-tag-red{top:0}", "e=`pxd-tag-${c}`", { read: '"pxd-tag-red"' });
  assert.deepEqual(lazy, {});
});

test("a deferred view answers idle calls, then builds once and replays the last setter", () => {
  let built = 0;
  const seen = [];
  const view = pieceDefer(() => {
    built += 1;
    return { el: "node", isOpen: () => true, open(tab) { seen.push(["open", tab]); return this === view || this.el; }, setSelection(item) { seen.push(["select", item]); } };
  }, { calls: { isOpen: false, dispose: null }, props: { el: null }, replay: ["setSelection"] });
  assert.equal(view.isOpen(), false);
  assert.equal(view.el, null);
  view.dispose();
  view.setSelection("a");
  view.setSelection("b");
  assert.equal(built, 0);
  view.open("search");
  assert.equal(built, 1);
  assert.deepEqual(seen, [["select", "b"], ["open", "search"]]);
  assert.equal(view.isOpen(), true);
  assert.equal(view.el, "node");
});

test("a class an eager rule also names stays eager, so lazy order cannot change a tie", () => {
  const css = ".a .pxd-look{top:0}.pxd-dark .pxd-card,.pxd-dark .pxd-look{top:1px}.pxd-read{top:2px}";
  const { eager, lazy } = splitCss(css, '"pxd-dark pxd-card"', { read: '"pxd-look pxd-read"' });
  assert.equal(eager, ".a .pxd-look{top:0}.pxd-dark .pxd-card,.pxd-dark .pxd-look{top:1px}");
  assert.equal(lazy.read, ".pxd-read{top:2px}");
});
