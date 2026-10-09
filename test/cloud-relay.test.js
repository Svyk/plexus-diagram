// The undeployed relay: allowlist, region host, and CORS. No network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import worker, { MAX_BODY_BYTES, readLimitedBody } from "../tools/cloud-relay/src/index.js";

const script = readFileSync(new URL("../tools/cloud-relay/src/index.js", import.meta.url), "utf8");

test("the relay script stays under 150 lines", () => {
  assert.ok(script.split("\n").length < 150, script.split("\n").length);
});

test("the relay script does not log", () => {
  assert.equal(/console\./.test(script), false);
});

test("the relay forwards only parse routes and does not keep the key", async () => {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers });
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": "session=secret" },
    });
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
    assert.equal(pre.headers.get("vary"), "Origin");
    assert.equal(calls.length, 2);

    const cooked = await worker.fetch(new Request("https://relay.example/api/v2/parse/job9", {
      method: "GET",
      headers: {
        Origin: "https://roamresearch.com",
        Authorization: "Bearer test-cloud-key",
        Cookie: "session=secret",
      },
    }));
    assert.equal(cooked.status, 200);
    assert.equal(calls[2].headers.get("Cookie"), null);
    assert.equal(calls[2].headers.get("Authorization"), "Bearer test-cloud-key");
    assert.equal(cooked.headers.get("set-cookie"), null);

    const huge = await worker.fetch(new Request("https://relay.example/api/v2/parse", {
      method: "POST",
      headers: {
        Origin: "https://roamresearch.com",
        Authorization: "Bearer test-cloud-key",
        "Content-Type": "application/json",
        "Content-Length": String(MAX_BODY_BYTES + 1),
      },
      body: "{}",
    }));
    assert.equal(huge.status, 413);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = prev;
  }
});

test("a body with no length is refused once it passes the cap", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      controller.close();
    },
  });
  const request = new Request("https://relay.example/api/v2/parse", {
    method: "POST",
    body: stream,
    duplex: "half",
  });
  const limited = await readLimitedBody(request, 3);
  assert.equal(limited.status, 413);
});
