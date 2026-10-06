import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendEntry, readLedger } from "../tools/live/ledger.mjs";
import { dropLedgerUids, exitCode, parseArgs, runSmoke, stepLine, STEPS } from "../tools/live/smoke.mjs";

function harness(script) {
  const calls = [];
  const lines = [];
  const recorded = [];
  const forgotten = [];
  const evaluate = async (request) => {
    calls.push(request);
    if (request.op === "install" || request.op === "release") return { ok: true };
    if (request.op === "delete") return { gone: [...(request.uids || [])], failed: [] };
    return script(request);
  };
  return {
    calls,
    lines,
    recorded,
    forgotten,
    async run(argv) {
      return runSmoke(argv, {
        evaluate,
        log: (line) => lines.push(line),
        warn: () => {},
        record: (entry) => { recorded.push(entry); },
        forget: (uids) => { forgotten.push(...uids); },
      });
    },
  };
}

function passingStep(request) {
  return {
    ok: true,
    page: "Plexus Diagram/Test Lab",
    graph: "readwisenotes",
    uids: [{ uid: `uid-${request.step}`, why: request.step }],
  };
}

test("parseArgs reads the window and --fail", () => {
  assert.deepEqual(parseArgs([]), { windowSel: "Readwisenotes - ", fail: null });
  assert.deepEqual(parseArgs(["--fail", "undo", "Readwisenotes - "]), { windowSel: "Readwisenotes - ", fail: "undo" });
  assert.deepEqual(parseArgs(["Svy - ", "--fail", "sidebar"]), { windowSel: "Svy - ", fail: "sidebar" });
  assert.equal(parseArgs(["--fail"]).fail, "");
  assert.equal(STEPS.length, 10);
  assert.equal(stepLine("edit-text", { ok: true }), "pass edit-text");
  assert.equal(stepLine("edit-text", { ok: false, reason: "no card\nnext" }), "fail edit-text: no card next");
});

test("every step prints pass and the run exits 0", async () => {
  const box = harness(passingStep);
  const result = await box.run(["Readwisenotes - "]);
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(exitCode(result), 0);
  assert.deepEqual(box.lines, STEPS.map((step) => `pass ${step}`));
  assert.deepEqual(box.calls.filter((call) => call.op === "step").map((call) => call.step), [...STEPS]);
  assert.deepEqual(box.recorded.map((entry) => entry.uid), STEPS.map((step) => `uid-${step}`));
  assert.equal(box.recorded[0].why, "REL-2 smoke create-board");
  assert.equal(box.recorded[0].page, "Plexus Diagram/Test Lab");
  assert.deepEqual(box.forgotten, [...STEPS].reverse().map((step) => `uid-${step}`));
  const ops = box.calls.map((call) => call.op);
  assert.equal(ops[0], "install");
  assert.equal(ops.at(-2), "release");
  assert.equal(ops.at(-1), "delete");
});

test("a failed step prints fail, exits non-zero, and still deletes this run", async () => {
  const box = harness((request) => {
    if (request.step === "add-arrow") return { ok: false, reason: "addEdge returned nothing" };
    return passingStep(request);
  });
  const result = await box.run(["Readwisenotes - "]);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(exitCode(result), 1);
  assert.deepEqual(box.lines, [
    "pass create-board",
    "pass create-card",
    "pass edit-text",
    "fail add-arrow: addEdge returned nothing",
  ]);
  assert.deepEqual(box.calls.filter((call) => call.op === "step").map((call) => call.step), [
    "create-board", "create-card", "edit-text", "add-arrow",
  ]);
  assert.deepEqual(box.forgotten, ["uid-edit-text", "uid-create-card", "uid-create-board"]);
  assert.ok(box.calls.some((call) => call.op === "release"));
  assert.ok(box.calls.some((call) => call.op === "delete"));
});

test("a thrown step is a failure and cleanup still runs", async () => {
  const box = harness((request) => {
    if (request.step === "edit-text") throw new Error("boom");
    return passingStep(request);
  });
  const result = await box.run(["Readwisenotes - "]);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(box.lines, [
    "pass create-board",
    "pass create-card",
    "fail edit-text: boom",
  ]);
  assert.deepEqual(box.forgotten, ["uid-create-card", "uid-create-board"]);
});

test("--fail forces that step and does not run it", async () => {
  const box = harness(passingStep);
  const result = await box.run(["--fail", "undo", "Readwisenotes - "]);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  const steps = box.calls.filter((call) => call.op === "step").map((call) => call.step);
  assert.deepEqual(steps, ["create-board", "create-card", "edit-text", "add-arrow", "add-section", "move-card"]);
  assert.equal(box.lines.at(-1), "fail undo: forced");
  assert.ok(box.lines.slice(0, -1).every((line) => line.startsWith("pass ")));
  assert.equal(box.forgotten.length, 6);
  assert.ok(box.calls.some((call) => call.op === "delete"));
});

test("a delete that fails stays out of the forget list", async () => {
  const forgotten = [];
  const result = await runSmoke(["--fail", "create-card"], {
    evaluate: async (request) => {
      if (request.op === "install" || request.op === "release") return { ok: true };
      if (request.op === "delete") return { gone: [], failed: (request.uids || []).map((uid) => ({ uid, error: "blocked" })) };
      if (request.step === "create-board") return { ok: true, uids: [{ uid: "board1", why: "board" }], page: "Plexus Diagram/Test Lab", graph: "g" };
      return { ok: true };
    },
    log: () => {},
    warn: () => {},
    record: () => {},
    forget: (uids) => { forgotten.push(...uids); },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(forgotten, []);
});

test("dropLedgerUids removes only the uids from this run", () => {
  const dir = mkdtempSync(join(tmpdir(), "pxd-smoke-"));
  const path = join(dir, "ledger.jsonl");
  appendEntry({ uid: "keep-me", why: "hand fixture", page: "Plexus Diagram/Test Lab", graph: "g" }, path);
  appendEntry({ uid: "smoke-board", why: "REL-2 smoke board", page: "Plexus Diagram/Test Lab", graph: "g" }, path);
  dropLedgerUids(["smoke-board"], path);
  assert.deepEqual(readLedger(path).map((entry) => entry.uid), ["keep-me"]);
  dropLedgerUids(["missing"], path);
  assert.deepEqual(readLedger(path).map((entry) => entry.uid), ["keep-me"]);
});

test("the page script drives the session and the sidebar modes", () => {
  const source = readFileSync(new URL("../tools/live/smoke-page.js", import.meta.url), "utf8");
  for (const name of ["createCard", "setString", "addEdge", "createSection", "commitMove", "undo", "duplicateItems", "restoreNative"]) {
    assert.match(source, new RegExp(name));
  }
  assert.match(source, /edit\/time/);
  assert.match(source, /Plexus Diagram\/Test Lab/);
  assert.match(source, /pxd-mode__board/);
  assert.match(source, /pxd-mode__outline/);
  assert.match(source, /removeWindow/);
});
