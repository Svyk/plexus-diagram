// PDFH-4. pdfBlockByUrl reads the page's refs. No file fetch and no write.
import assert from "node:assert/strict";
import test from "node:test";

import { createHost } from "../src/host/roam.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

const URL = "https://example.test/papers/Risk%20model.pdf";

function setup(answer) {
  const fake = createFakeRoam();
  const queries = [];
  const fetches = [];
  const data = fake.api.data;
  const q = (query, ...inputs) => {
    queries.push([String(query), ...inputs]);
    return answer(String(query), ...inputs);
  };
  data.q = q;
  data.fast.q = q;
  fake.setFileGet((arg) => { fetches.push(arg); return { bytes: new Uint8Array() }; });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  return { host, queries, fetches };
}

test("an empty or broken url does not query", () => {
  const { host, queries, fetches } = setup(() => [["should-not-run"]]);
  assert.equal(host.pdfBlockByUrl(""), "");
  assert.equal(host.pdfBlockByUrl("   "), "");
  assert.equal(host.pdfBlockByUrl("https://example.test/a.pdf\n"), "");
  assert.equal(queries.length, 0);
  assert.equal(fetches.length, 0);
  assert.equal(host.stats.writes, 0);
});

test("pdfBlockByUrl returns the ref block and skips the page uid", () => {
  const { host, queries, fetches } = setup((text) => {
    if (text.includes(":pdf/url")) return [["pageUid01", "Paper.pdf"]];
    if (text.includes(":block/page")) return [];
    if (text.includes("[?p :block/refs ?b]")) return [["pageUid01"], ["pdfblock1"]];
    if (text.includes("[?b :block/refs ?p]")) return [["otherblk1"]];
    return [];
  });
  assert.equal(host.pdfBlockByUrl(URL), "pdfblock1");
  assert.equal(queries.some((row) => row[0].includes(URL)), false);
  assert.equal(queries.some((row) => row[1] === "pageUid01" && row[2] === URL), true);
  assert.equal(fetches.length, 0);
  assert.equal(host.stats.writes, 0);
});

test("an outgoing miss uses the backref, and two misses return empty", () => {
  const back = setup((text) => {
    if (text.includes(":pdf/url")) return [["pageUid01", "Paper.pdf"]];
    if (text.includes(":block/page")) return [];
    if (text.includes("[?p :block/refs ?b]")) return [["pageUid01"]];
    if (text.includes("[?b :block/refs ?p]")) return [["otherblk1"]];
    return [];
  });
  assert.equal(back.host.pdfBlockByUrl(URL), "otherblk1");
  assert.equal(back.fetches.length, 0);
  assert.equal(back.host.stats.writes, 0);

  const none = setup((text) => {
    if (text.includes(":pdf/url")) return [["pageUid01", "Paper.pdf"]];
    return [];
  });
  assert.equal(none.host.pdfBlockByUrl(URL), "");
  assert.equal(none.fetches.length, 0);
  assert.equal(none.host.stats.writes, 0);
});
