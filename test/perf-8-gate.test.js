import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { planCleanup, TEST_PAGES } from "../tools/live/ledger.mjs";
import {
  ROW_IDS,
  countPlexusPointerup,
  exitCode,
  fixtureCardSpecs,
  fixtureComplete,
  fixtureEntries,
  formatTable,
  installDataCounter,
  isPlexusSource,
  judge,
  longTaskSummary,
  median,
  parseArgs,
  planText,
  PERF_BUDGETS,
  pointerupRatio,
  runGate,
  sidebarStillIntact,
  typingMedians,
  windowKey,
  windowTitleRefused,
  windowsToRemove,
  worstPointerup,
  FIXTURE_IMAGES,
  FIXTURE_NOTES,
  FIXTURE_PAGE_CARDS,
  FIXTURE_PDFS,
  MAIN_IDLE_LONG_TASK_MS,
  PAGE,
  POINTERUP_PER_MOUNTED_BOARD,
  TYPING_MOUNTED_MEDIAN_MS,
  TYPING_ROUNDS,
  SIDEBAR_PARKED_LONG_TASK_MS,
  TYPING_PARKED_MEDIAN_MS,
} from "../tools/live/perf-gate.mjs";

const passing = {
  main: { longMs: 0, frames: 181 },
  sidebar: { loadedLongMs: 0, parkedLongMs: 0, boardLongMs: 0, outlineAfter2s: 0 },
  typing: { mountedMedian: 0.4, parkedMedian: 0.05 },
  pointerup: { listeners: 1, boards: 1 },
  dataCalls: 18,
};

test("parseArgs and the dry plan name the four rows without connecting", () => {
  assert.deepEqual(parseArgs(["--dry", "Readwisenotes - "]), { dry: true, windowSel: "Readwisenotes - " });
  assert.equal(parseArgs([]).windowSel, "Readwisenotes - ");
  const plan = planText("Readwisenotes - ");
  for (const id of ROW_IDS) assert.match(plan, new RegExp(id));
  assert.match(plan, /does not connect/);
  assert.match(plan, /plx typing bench/);
  assert.match(plan, new RegExp(String(FIXTURE_NOTES)));
  assert.match(plan, new RegExp(PAGE.replace("/", "\\/")));
  assert.match(plan, new RegExp(String(TYPING_MOUNTED_MEDIAN_MS)));
  assert.match(plan, new RegExp(String(TYPING_PARKED_MEDIAN_MS)));
  assert.match(plan, new RegExp(String(POINTERUP_PER_MOUNTED_BOARD)));
  assert.match(plan, /never close the sidebar/);
  assert.equal(plan.includes("\npass"), false);
});

test("--dry prints the plan and does not connect", async () => {
  let connected = false;
  const lines = [];
  const result = await runGate(["--dry", "Readwisenotes - "], {
    connect: async () => { connected = true; },
    log: (line) => lines.push(line),
  });
  assert.equal(connected, false);
  assert.equal(result.ok, true);
  assert.match(lines.join("\n"), /main-idle/);
  assert.equal(exitCode(result), 0);
});

test("the cli dry run exits 0", () => {
  const result = spawnSync(process.execPath, ["tools/live/perf-gate.mjs", "--dry", "Readwisenotes - "], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /does not connect/);
  assert.match(result.stdout, /sidebar-board-outline/);
});

test("a window titled plx typing bench is refused", () => {
  assert.equal(windowTitleRefused("plx typing bench"), true);
  assert.equal(windowTitleRefused("Notes - plx typing bench"), true);
  assert.equal(windowTitleRefused("Readwisenotes - Daily Notes"), false);
  assert.equal(windowTitleRefused(""), false);
});

test("sidebar removal keeps every window that was already open", () => {
  const before = Array.from({ length: 140 }, (_, i) => ({
    type: "outline",
    "block-uid": `old${i}`,
    "window-id": `sidebar-outline-old${i}`,
  }));
  const after = before.concat([
    { type: "block", "block-uid": "board", "window-id": "sidebar-block-board" },
    { type: "block", "block-uid": "other", "window-id": "sidebar-block-other" },
  ]);
  const remove = windowsToRemove(before, after, "board");
  assert.deepEqual(remove.map(windowKey), ["block:board"]);
  assert.equal(windowsToRemove(before, before, "board").length, 0);
  const already = [{ type: "block", "block-uid": "board", "window-id": "sidebar-block-board" }];
  const duplicate = already.concat([{ type: "block", "block-uid": "board", "window-id": "sidebar-block-board-2" }]);
  assert.deepEqual(windowsToRemove(already, duplicate, "board").map(windowKey), []);
  const gone = sidebarStillIntact(before, before, ["block:board"]);
  assert.equal(gone.ok, true);
  assert.equal(sidebarStillIntact(before, before.slice(1), []).ok, false);
  assert.equal(sidebarStillIntact(before, after, ["block:board"]).stillThere[0], "block:board");
});

test("fixture spec is 40 notes, 3 images, one pdf, and one page card", () => {
  const cards = fixtureCardSpecs();
  assert.equal(cards.filter((card) => card.kind === "note").length, FIXTURE_NOTES);
  assert.equal(cards.filter((card) => card.kind === "image").length, FIXTURE_IMAGES);
  assert.equal(cards.filter((card) => card.kind === "pdf").length, FIXTURE_PDFS);
  assert.equal(cards.filter((card) => card.kind === "page").length, FIXTURE_PAGE_CARDS);
  assert.match(cards.find((card) => card.kind === "pdf").string, /\{\{\[\[pdf\]\]:/);
  assert.match(cards.find((card) => card.kind === "page").string, /\[\[Plexus Diagram\/Test Lab\]\]/);
  assert.equal(fixtureComplete({ note: 40, image: 3, pdf: 1, page: 1 }), true);
  assert.equal(fixtureComplete({ note: 39, image: 3, pdf: 1, page: 1 }), false);
});

test("ledger rows for this script are test-page blocks cleanup can delete", () => {
  const entries = fixtureEntries({
    page: PAGE,
    graph: "Readwisenotes",
    uids: [
      { uid: "board", why: "board" },
      { uid: "card", why: "note" },
      { uid: "", why: "skip" },
    ],
  });
  const pages = {
    board: { exists: true, isPage: false, page: TEST_PAGES[0] },
    card: { exists: true, isPage: false, page: TEST_PAGES[0] },
  };
  const plan = planCleanup(entries, { graph: "Readwisenotes", pagesOf: (uid) => pages[uid] });
  assert.deepEqual(plan.remove, ["card", "board"]);
  assert.deepEqual(plan.keep, []);
});

test("long tasks after 2s are the outline failure, and earlier ones are not", () => {
  const origin = 1000;
  const summary = longTaskSummary([
    { start: 999, duration: 80 },
    { start: 1000, duration: 50 },
    { start: 3000, duration: 50 },
    { start: 3000.1, duration: 40 },
    { start: 4000, duration: 90 },
  ], origin, 3000, 2000);
  assert.equal(summary.longMs, 140);
  assert.equal(summary.afterSettle, 1);
  assert.equal(longTaskSummary([], origin, 3000).longMs, 0);
});

test("pointerup budget is one Plexus listener per mounted board", () => {
  const sources = new Map([
    ["pxd", "/* Plexus Diagram v2.13.2 */"],
    ["other", "/* some other extension */"],
  ]);
  const listeners = [
    { type: "pointerup", scriptId: "pxd" },
    { type: "pointerup", scriptId: "pxd" },
    { type: "pointerup", scriptId: "other" },
    { type: "click", scriptId: "pxd" },
  ];
  assert.equal(isPlexusSource(sources.get("pxd")), true);
  assert.equal(isPlexusSource("blob:https://roamresearch.com/abc"), false);
  assert.equal(countPlexusPointerup(listeners, sources), 2);
  assert.equal(pointerupRatio(1, 1).ok, true);
  assert.equal(pointerupRatio(2, 1).ok, false);
  assert.equal(pointerupRatio(2, 2).ok, true);
  assert.equal(pointerupRatio(1, 0).ok, false);
  assert.equal(pointerupRatio(0, 0).ok, true);
  const worst = worstPointerup([{ listeners: 1, boards: 1 }, { listeners: 2, boards: 1 }]);
  assert.equal(worst.ok, false);
});

test("typing medians use the bench delta and the stated limits", () => {
  const medians = typingMedians([
    { baseline: 10, mounted: 10.4, parked: 10.05 },
    { baseline: 11, mounted: 11.2, parked: 11.02 },
    { baseline: 9, mounted: 12, parked: 9.2 },
  ]);
  assert.equal(medians.mountedMedian, median([0.4, 0.2, 3]));
  assert.equal(medians.parkedMedian, median([0.05, 0.02, 0.2]));
  assert.equal(typingMedians([{ baseline: 1 }]).mountedMedian, null);
});

test("a build inside the thresholds passes and prints four rows", () => {
  const verdict = judge(passing);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.rows.map((row) => row.id), ROW_IDS);
  const table = formatTable(verdict);
  for (const id of ROW_IDS) assert.match(table, new RegExp(id));
  assert.match(table, /pointerup/);
  assert.match(table, /data-calls/);
  assert.match(table, /\npass$/);
  assert.equal(exitCode(verdict), 0);
});

test("eager sidebar outline and a parked long task exit non-zero", async () => {
  const eager = judge({
    ...passing,
    sidebar: { ...passing.sidebar, outlineAfter2s: 2 },
  });
  assert.equal(eager.ok, false);
  assert.equal(eager.rows[2].checks[1].ok, false);
  const lines = [];
  let cleaned = false;
  const result = await runGate(["Readwisenotes - "], {
    measure: async () => ({ ...passing, sidebar: { ...passing.sidebar, outlineAfter2s: 4 } }),
    cleanup: async () => { cleaned = true; },
    log: (line) => lines.push(line),
    connect: async () => { throw new Error("should not connect"); },
  });
  assert.equal(result.ok, false);
  assert.equal(cleaned, true);
  assert.equal(exitCode(result), 1);
  assert.match(lines.join("\n"), /sidebar-board-outline \| outline long tasks after 2s \| 4/);
  assert.match(lines.join("\n"), /\nfail$/);

  const parked = judge({ ...passing, sidebar: { ...passing.sidebar, parkedLongMs: SIDEBAR_PARKED_LONG_TASK_MS + 1 } });
  assert.equal(parked.ok, false);
  const typing = judge({ ...passing, typing: { mountedMedian: TYPING_MOUNTED_MEDIAN_MS + 0.01, parkedMedian: 0 } });
  assert.equal(typing.ok, false);
  const parkedKeys = judge({ ...passing, typing: { mountedMedian: 0, parkedMedian: TYPING_PARKED_MEDIAN_MS + 0.01 } });
  assert.equal(parkedKeys.ok, false);
  const idle = judge({ ...passing, main: { longMs: MAIN_IDLE_LONG_TASK_MS + 50 } });
  assert.equal(idle.ok, false);
  const atLimit = judge({
    ...passing,
    typing: { mountedMedian: TYPING_MOUNTED_MEDIAN_MS, parkedMedian: TYPING_PARKED_MEDIAN_MS },
  });
  assert.equal(atLimit.ok, true);
});

test("the data-call wrapper counts nested plexus frames and restores", () => {
  const data = {
    pull: (q) => q,
    block: { create: (value) => value, update: true },
    fast: { q: (value) => value },
  };
  const wrapped = installDataCounter(data, "fromPlexus");
  function fromPlexus() {
    data.pull("a");
    data.block.create("b");
    data.fast.q("c");
  }
  fromPlexus();
  data.pull("other");
  assert.equal(wrapped.counts.total, 4);
  assert.equal(wrapped.counts.plexus, 3);
  assert.equal(wrapped.counts.names.pull, 2);
  assert.equal(wrapped.counts.names["block.create"], 1);
  assert.equal(wrapped.counts.names["fast.q"], 1);
  assert.equal(data.block.update, true);
  wrapped.restore();
  data.pull("again");
  data.block.create("z");
  assert.equal(wrapped.counts.total, 4);
});

test("zero plexus data calls fail the row", () => {
  const verdict = judge({ ...passing, dataCalls: 0, dataCallsTotal: 12 });
  assert.equal(verdict.ok, false);
  assert.match(formatTable(verdict), /data-calls \| plexus per board open \| 0 \| report \| fail \| total 12/);
});

test("a sidebar window that stays open does not skip typing, and the exit path removes it", async () => {
  const ops = [];
  const before = [{ type: "outline", "window-id": "sidebar-outline-keep", "page-uid": "keep" }];
  const added = [{ type: "block", "block-uid": "board", "window-id": "sidebar-block-board" }];
  let removes = 0;
  let mainRoots = 1;
  const lines = [];
  const result = await runGate(["192979C1"], {
    log: (line) => lines.push(line),
    warn: (line) => lines.push(line),
    ledger: () => {},
    cleanup: async () => ({ removed: 1, skipped: [] }),
    countPointerup: async () => ({ listeners: 1, boards: 1 }),
    typeSample: async () => 1,
    connect: async () => ({
      title: "Readwisenotes - Daily Notes",
      cdp: {
        rpc: async () => ({}),
        evaluate: async () => null,
        close() {},
      },
    }),
    callPage: async (_cdp, arg) => {
      ops.push(arg.op);
      if (arg.op === "version") return { version: "9.9.9-live" };
      if (arg.op === "create") {
        return {
          ok: true,
          boardUid: "board",
          scratchUid: "scratch",
          folderUid: "folder",
          pageUid: "page",
          version: "should-not-win",
          graph: "Readwisenotes",
          page: PAGE,
          counts: { note: 40, image: 3, pdf: 1, page: 1 },
          uids: [{ uid: "board", why: "board" }],
        };
      }
      if (arg.op === "roots") return { main: mainRoots, side: 0, all: mainRoots };
      if (arg.op === "data-calls") return { total: 80, plexus: 22, items: 40 };
      if (arg.op === "idle") return { supported: true, origin: 0, tasks: [], frames: 30, windowMs: 3000 };
      if (arg.op === "sidebar-add") return { ok: true, before, after: before.concat(added), domId: "sidebar-window-sidebar-block-board" };
      if (arg.op === "sidebar-mode") return { ok: true };
      if (arg.op === "sidebar-outline") return { supported: true, origin: 0, tasks: [], frames: 1 };
      if (arg.op === "sidebar-park") {
        return {
          ok: true,
          roots: 0,
          collapsed: true,
          className: "rm-sidebar-window",
          caret: "rm-caret rm-caret-closed",
          domId: "sidebar-window-sidebar-block-board",
          windowId: "sidebar-block-board",
          height: 41,
        };
      }
      if (arg.op === "sidebar-remove") {
        removes += 1;
        return { ok: true, after: removes === 1 ? before.concat(added) : before };
      }
      if (arg.op === "park-main") { mainRoots = 0; return { roots: 0, started: true }; }
      if (arg.op === "unpark-main") { mainRoots = 1; return { roots: 1, started: true }; }
      return { ok: true };
    },
  });
  const text = lines.join("\n");
  assert.match(text, /version 9\.9\.9-live/);
  assert.match(text, /sidebar windows changed: missing 0, left 1/);
  assert.match(text, /typing round 1/);
  assert.match(text, /sidebar collapse signal is getWindows collapsed\?/);
  assert.equal(ops.filter((op) => op === "sidebar-remove").length, 2);
  assert.ok(ops.indexOf("park-main") > ops.indexOf("sidebar-remove"));
  assert.equal(ops.filter((op) => op === "park-main").length, TYPING_ROUNDS * 2);
  assert.match(text, /PERF-8 9\.9\.9-live/);
  assert.equal(result.ok, true);
  assert.equal(exitCode(result), 0);
});

test("the gate source does not close the right sidebar", () => {
  const src = readFileSync(new URL("../tools/live/perf-gate.mjs", import.meta.url), "utf8");
  assert.equal(/rightSidebar\s*\.\s*close\s*\(/.test(src), false);
  assert.equal(/\.ui\.rightSidebar\.close/.test(src), false);
});

test("parking the main board does not await the diagram move", () => {
  const src = readFileSync(new URL("../tools/live/perf-gate.mjs", import.meta.url), "utf8");
  const park = src.slice(src.indexOf('arg.op === "park-main"'), src.indexOf('arg.op === "unpark-main"'));
  const unpark = src.slice(src.indexOf('arg.op === "unpark-main"'), src.indexOf('arg.op === "caret"'));
  assert.equal(park.includes("await finishCall"), false);
  assert.equal(unpark.includes("await finishCall"), false);
  assert.match(park, /releaseWrite\(\(\) => api\.data\.block\.move/);
  assert.match(unpark, /releaseWrite\(\(\) => api\.data\.block\.move/);
  const mover = src.slice(src.indexOf("function boardMoveExpression"), src.indexOf("function caretExpression"));
  assert.match(mover, /setTimeout/);
  assert.equal(mover.includes("await"), false);
});

test("the gate module reads perf-budgets.json", () => {
  const src = readFileSync(new URL("../tools/live/perf-gate.mjs", import.meta.url), "utf8");
  assert.match(src, /perf-budgets\.json/);
  assert.match(planText("Readwisenotes - "), /perf-budgets\.json/);
  assert.equal(typeof PERF_BUDGETS["40"].dataCallsPerOpen, "number");
  assert.equal(PERF_BUDGETS["40"].dataCallsPerOpen <= 20, true);
});
