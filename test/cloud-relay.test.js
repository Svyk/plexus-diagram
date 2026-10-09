// The undeployed relay: allowlist, region host, and CORS. No network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import worker from "../tools/cloud-relay/src/index.js";

const script = readFileSync(new URL("../tools/cloud-relay/src/index.js", import.meta.url), "utf8");

test("the relay script stays under 150 lines", () => {
  assert.ok(script.split("\n").length < 150, script.split("\n").length);
});

test("the relay forwards only parse routes and does not keep the key", async () => {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const denied = await worker.fetch(new Request("https://relay.example/v1/jobs", {
      method: "POST",
      headers: { Origin: "https://roamresearch.com" },
    }));
    assert.equal(denied.status, 404);
    const evil = await worker.fetch(new Request("https://relay.example/api/v2/parse", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    }));
    assert.equal(evil.status, 403);
    assert.equal(calls.length, 0);

    const ok = await worker.fetch(new Request("https://relay.example/api/v2/parse?expand=items", {
      method: "POST",
      headers: {
        Origin: "https://roamresearch.com",
        Authorization: "Bearer test-cloud-key",
        "Content-Type": "application/json",
        "X-Pxd-Region": "eu",
      },
      body: "{}",
    }));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://roamresearch.com");
    assert.equal(calls[0].url, "https://api.cloud.eu.llamaindex.ai/api/v2/parse?expand=items");
    assert.equal(calls[0].headers.get("Authorization"), "Bearer test-cloud-key");
    assert.equal(calls[0].headers.get("X-Pxd-Region"), null);

    const us = await worker.fetch(new Request("https://relay.example/api/v2/parse/job1", {
      method: "GET",
      headers: { Authorization: "Bearer test-cloud-key" },
    }));
    assert.equal(us.status, 200);
    assert.equal(calls[1].url, "https://api.cloud.llamaindex.ai/api/v2/parse/job1");

    const pre = await worker.fetch(new Request("https://relay.example/api/v2/parse", {
      method: "OPTIONS",
      headers: { Origin: "app://roam" },
    }));
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "app://roam");
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = prev;
  }
});
