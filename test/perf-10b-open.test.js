// PERF-10b: page, parent, pdf url, and tree reads during one open stay on the live cache.
import test from "node:test";
import assert from "node:assert/strict";
import { createHost } from "../src/host/roam.js";

const ANCESTORS = "[:block/uid :block/string {:block/parents [:block/uid :block/string :block/props {:block/parents [:db/id]}]}]";

function parseEntity(entity) {
  if (Array.isArray(entity)) return { key: entity[0], value: entity[1] };
  const match = /^\[\s*(:[\w/.-]+)\s+"((?:[^"\\]|\\.)*)"\s*\]$/.exec(String(entity ?? ""));
  if (match) return { key: match[1], value: match[2] };
  return null;
}

function stripRefs(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(stripRefs);
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === ":block/refs") continue;
    out[key] = stripRefs(value);
  }
  return out;
}

// Same 39-card board as test/perf-10-open.test.js, plus four highlight pages.
function countingHost() {
  const blocks = new Map();
  const pages = new Map();
  let eid = 10;
  const make = (uid, string, extra = {}) => {
    const node = {
      ":db/id": eid++,
      ":block/uid": uid,
      ":block/string": string,
      ":block/open": true,
      ":block/props": {},
      ":block/children": [],
      ...extra,
    };
    blocks.set(uid, node);
    if (typeof node[":node/title"] === "string") pages.set(node[":node/title"], node);
    return node;
  };
  for (let i = 0; i < 35; i++) {
    const row = make(`row${i}`, `row ${i}`);
    const extra = { ":block/children": [row] };
    if (i < 4) {
      extra[":block/page"] = make(`pdf${i}`, "", {
        ":node/title": `Doc ${i}.pdf`,
        ":pdf/url": `https://files.test/${i}.pdf`,
      });
    }
    make(`b${i}`, `note ${i}`, extra);
  }
  for (let i = 0; i < 4; i++) {
    const rows = [0, 1, 2].map((r) => make(`p${i}r${r}`, `line ${i}.${r}`));
    make(`page${i}`, "", { ":node/title": `Page ${i}`, ":block/children": rows });
  }
  make("todo", "", { ":node/title": "TODO" });
  make("done", "", { ":node/title": "DONE" });
  const children = [];
  for (let i = 0; i < 35; i++) {
    children.push(make(`c${i}`, `((b${i}))`, { ":block/refs": [blocks.get(`b${i}`)] }));
  }
  for (let i = 0; i < 4; i++) {
    children.push(make(`pc${i}`, `[[Page ${i}]]`, { ":block/refs": [pages.get(`Page ${i}`)] }));
  }
  make("board", "{{[[diagram]]}}", {
    ":block/props": { plexus: { v: 2 } },
    ":block/children": children,
    ":block/parents": [{
      ":block/uid": "daily",
      ":block/string": "October 5th, 2026",
      ":block/props": {},
      ":block/parents": [{ ":db/id": 1 }],
    }],
  });

  const calls = [];
  const lookup = (entity) => {
    const parsed = parseEntity(entity);
    if (!parsed) return null;
    if (parsed.key === ":node/title") return pages.get(parsed.value) ?? null;
    if (parsed.key === ":block/uid") return blocks.get(parsed.value) ?? null;
    return null;
  };
  const pull = (pattern, entity) => {
    calls.push({ name: "pull", pattern: String(pattern), entity });
    const node = lookup(entity);
    if (!node) return null;
    const copy = structuredClone(node);
    return String(pattern).includes(":block/refs") ? copy : stripRefs(copy);
  };
  const query = (text, ...inputs) => {
    calls.push({ name: "q", text, inputs });
    if (String(text).includes("[?title ...]")) return [["Page 0", "mention1", "sees Page 0", "Daily"]];
    return [];
  };
  const watches = [];
  const data = {
    pull,
    // POL-5: one pull_many for the board, not a pull per card and not four collection queries.
    pull_many(_pattern, eids) {
      calls.push({ name: "pull_many" });
      return (Array.isArray(eids) ? eids : []).map((id) => ({ ":db/id": id }));
    },
    q: query,
    fast: { q: query },
    addPullWatch(pattern, entity, cb) {
      calls.push({ name: "addPullWatch", pattern });
      watches.push({ pattern, entity, cb });
    },
    removePullWatch(pattern, entity, cb) {
      calls.push({ name: "removePullWatch" });
      const i = watches.findIndex((w) => w.cb === cb && w.entity === entity && w.pattern === pattern);
      if (i >= 0) watches.splice(i, 1);
    },
  };
  const host = createHost({ api: { data, util: { generateUID: () => "uid" } }, storage: new Map(), graph: "g" });
  const since = (start) => calls.slice(start);
  return { host, calls, since, blocks };
}

function targets() {
  const list = [];
  for (let i = 0; i < 35; i++) list.push({ kind: "block", uid: `b${i}` });
  for (let i = 0; i < 4; i++) list.push({ kind: "page", title: `Page ${i}` });
  return list;
}

test("one open of a 39-card board stays within 20 data calls including page, parent, and tree reads", () => {
  const { host, calls, since } = countingHost();
  const start = calls.length;
  host.api.data.pull("[:block/props]", [":block/uid", "board"]);
  host.api.data.pull(ANCESTORS, [":block/uid", "board"]);
  host.blockString("board");
  const pulled = host.pullBoard("board");
  assert.equal(pulled[":block/uid"], "board");
  const offBoard = host.watchBoard("board", () => {});
  for (let i = 0; i < 35; i++) {
    assert.equal(host.blockString(`b${i}`), `note ${i}`);
    const tree = host.pullTree(`b${i}`, 2, 12);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].uid, `row${i}`);
    assert.equal(tree[0].string, `row ${i}`);
  }
  for (let i = 0; i < 4; i++) {
    const outline = host.pageOutline(`Page ${i}`, 2000);
    assert.equal(outline.exists, true);
    assert.equal(outline.blocks.length, 3);
    host.watchPage(`Page ${i}`, () => {});
    assert.equal(typeof host.pageUid(`Page ${i}`), "string");
    assert.equal(host.blockPageUid(`b${i}`), `pdf${i}`);
    assert.equal(host.pdfPageUrl(`pdf${i}`), `https://files.test/${i}.pdf`);
  }
  assert.equal(host.blockPageUid("c0"), "daily");
  assert.equal(host.parentString("c0"), "{{[[diagram]]}}");
  assert.equal(host.parentString("row0"), "note 0");
  host.linkedRefs({ uid: "pc0", target: { kind: "page", title: "Page 0" } });
  host.cardStats(targets(), { boardUid: "board" });
  const opened = since(start);
  const adds = opened.filter((c) => c.name === "addPullWatch");
  assert.equal(adds.length, 1);
  const pulls = opened.filter((c) => c.name === "pull").length;
  const qs = opened.filter((c) => c.name === "q").length;
  assert.ok(opened.length <= 20, `first open made ${opened.length} data calls (${pulls} pull, ${qs} q, ${adds.length} watch)`);
  offBoard();
});

test("a block outside a watched board pulls instead of serving a stale cache", () => {
  const { host, calls, since, blocks } = countingHost();
  const start = calls.length;
  assert.equal(host.blockPageUid("outside"), "");
  assert.equal(host.pdfPageUrl("outside"), "");
  assert.equal(host.parentString("outside"), null);
  assert.deepEqual(host.pullTree("outside"), []);
  assert.equal(since(start).filter((c) => c.name === "pull").length, 4);
  const burst = calls.length;
  assert.equal(host.blockPageUid("outside"), "");
  assert.equal(host.pdfPageUrl("outside"), "");
  assert.equal(host.parentString("outside"), null);
  assert.deepEqual(host.pullTree("outside"), []);
  assert.equal(since(burst).filter((c) => c.name === "pull").length, 0);

  host.pullBoard("board");
  const off = host.watchBoard("board", () => {});
  assert.equal(host.blockPageUid("b0"), "pdf0");
  assert.equal(host.pdfPageUrl("pdf0"), "https://files.test/0.pdf");
  assert.equal(host.parentString("c0"), "{{[[diagram]]}}");
  assert.equal(host.pullTree("b0")[0].string, "row 0");
  off();

  blocks.get("b0")[":block/page"] = { ":block/uid": "moved" };
  blocks.get("pdf0")[":pdf/url"] = "https://files.test/moved.pdf";
  blocks.get("row0")[":block/string"] = "row changed";
  const again = calls.length;
  assert.equal(host.blockPageUid("b0"), "moved");
  assert.equal(host.pdfPageUrl("pdf0"), "https://files.test/moved.pdf");
  assert.equal(host.pullTree("b0")[0].string, "row changed");
  assert.equal(host.parentString("c0"), null);
  const pulled = since(again).filter((c) => c.name === "pull");
  assert.equal(pulled.length, 4);
});
