// Block-uid ledger for live writes on Roam test pages.
//   node tools/live/ledger.mjs add <uid> <why> [--page TITLE] [--graph NAME]
//   node tools/live/ledger.mjs list
//   node tools/live/ledger.mjs cleanup [titleSubstring]
//   node tools/live/ledger.mjs roundtrip [titleSubstring]
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const LEDGER_PATH = join(repo, ".live/svy-ledger.jsonl");
export const TEST_PAGES = ["Plexus Diagram/Test Lab", "diagram testing"];
const TEST_PAGE_SET = new Set(TEST_PAGES);
const live = join(dirname(fileURLToPath(import.meta.url)), "plexus-live.mjs");

export function parseLedger(text) {
  const entries = [];
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row && typeof row.uid === "string" && row.uid) entries.push(row);
    } catch { /* skip a torn line */ }
  }
  return entries;
}

export function readLedger(path = LEDGER_PATH) {
  try { return parseLedger(readFileSync(path, "utf8")); } catch { return []; }
}

export function appendEntry(entry, path = LEDGER_PATH) {
  const row = {
    uid: entry.uid,
    why: entry.why || "",
    page: entry.page || "",
    graph: entry.graph || "",
    at: entry.at || new Date().toISOString(),
  };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
  return row;
}

export function writeLedger(entries, path = LEDGER_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, entries.map((row) => JSON.stringify(row)).join("\n") + (entries.length ? "\n" : ""));
}

// Newest first. Missing blocks are dropped. Pages and non-test pages stay.
export function planCleanup(entries, { graph, pagesOf }) {
  const drop = new Set();
  const remove = [];
  const skip = [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (graph && entry.graph && entry.graph !== graph) continue;
    const info = pagesOf(entry.uid) || { exists: false };
    if (!info.exists) { drop.add(i); continue; }
    if (info.isPage) { skip.push({ uid: entry.uid, reason: "page", page: info.page || "" }); continue; }
    if (!TEST_PAGE_SET.has(info.page)) {
      skip.push({ uid: entry.uid, reason: "not-test-page", page: info.page || "" });
      continue;
    }
    remove.push(entry.uid);
    drop.add(i);
  }
  return { remove, skip, keep: entries.filter((_, i) => !drop.has(i)) };
}

export function roamEval(windowSel, expression) {
  const result = spawnSync(process.execPath, [live, "eval", windowSel, expression], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const err = new Error((result.stderr || result.stdout || "eval failed").trim());
    err.status = result.status;
    throw err;
  }
  const text = (result.stdout || "").trim();
  try { return JSON.parse(text); } catch { return text; }
}

function graphName(windowSel) {
  return roamEval(windowSel, `(location.hash.match(/#\\/app\\/([^/]+)/) || [])[1] || ""`);
}

function describeUids(windowSel, uids) {
  const expr = `(${describeInPage.toString()})(${JSON.stringify(uids)})`;
  const raw = roamEval(windowSel, expr);
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

function describeInPage(uids) {
  const api = window.roamAlphaAPI;
  const get = (obj, key) => obj?.[key] ?? obj?.[":" + key];
  const out = {};
  for (const uid of uids) {
    const asPage = api.data.pull("[:node/title :block/uid]", [":block/uid", uid]);
    const title = get(asPage, "node/title");
    if (title) { out[uid] = { exists: true, isPage: true, page: title }; continue; }
    const block = api.data.pull("[:block/uid {:block/page [:node/title]}]", [":block/uid", uid]);
    if (!get(block, "block/uid")) { out[uid] = { exists: false }; continue; }
    const page = get(block, "block/page");
    out[uid] = { exists: true, isPage: false, page: get(page, "node/title") || "" };
  }
  return JSON.stringify(out);
}

function deleteUids(windowSel, uids) {
  const expr = `(async () => {
    const api = window.roamAlphaAPI;
    const gone = [];
    const failed = [];
    for (const uid of ${JSON.stringify(uids)}) {
      try {
        await api.data.block.delete({ block: { uid } });
        gone.push(uid);
      } catch (error) {
        failed.push({ uid, error: String(error && error.message || error) });
      }
    }
    return JSON.stringify({ gone, failed });
  })()`;
  const raw = roamEval(windowSel, expr);
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export function cleanup(windowSel, path = LEDGER_PATH) {
  const entries = readLedger(path);
  const graph = graphName(windowSel);
  const mine = entries.filter((entry) => !graph || !entry.graph || entry.graph === graph);
  const described = mine.length ? describeUids(windowSel, mine.map((entry) => entry.uid)) : {};
  const plan = planCleanup(entries, { graph, pagesOf: (uid) => described[uid] });
  const deleted = plan.remove.length ? deleteUids(windowSel, plan.remove) : { gone: [], failed: [] };
  const failed = new Set((deleted.failed || []).map((row) => row.uid));
  const keptUids = new Set(plan.keep.map((entry) => entry.uid));
  const restored = entries.filter((entry) => failed.has(entry.uid) && !keptUids.has(entry.uid));
  const next = plan.keep.concat(restored);
  writeLedger(next, path);
  return { graph, removed: (deleted.gone || []).length, failed: deleted.failed || [], skipped: plan.skip, left: next.length };
}

function roundtripInPage() {
  return (async () => {
    const api = window.roamAlphaAPI;
    const title = "Plexus Diagram/Test Lab";
    const graph = (location.hash.match(/#\/app\/([^/]+)/) || [])[1] || "";
    const get = (obj, key) => obj?.[key] ?? obj?.[":" + key];
    let page = api.data.pull("[:block/uid]", [":node/title", title]);
    let pageUid = get(page, "block/uid") || null;
    let createdPage = false;
    if (!pageUid) {
      pageUid = api.util.generateUID();
      await api.data.page.create({ page: { title, uid: pageUid } });
      createdPage = true;
    }
    const uid = api.util.generateUID();
    await api.data.block.create({
      location: { "parent-uid": pageUid, order: "last" },
      block: { uid, string: "PRE-2 scratch" },
    });
    const check = api.data.pull("[:block/string]", [":block/uid", uid]);
    return JSON.stringify({
      ok: get(check, "block/string") === "PRE-2 scratch",
      graph, page: title, pageUid, createdPage, uid,
    });
  })();
}

function blockExists(windowSel, uid) {
  const raw = roamEval(windowSel, `(() => {
    const block = window.roamAlphaAPI.data.pull("[:block/uid]", [":block/uid", ${JSON.stringify(uid)}]);
    return JSON.stringify(Boolean(block && (block[":block/uid"] || block.uid)));
  })()`);
  return raw === true || raw === "true";
}

export function roundtrip(windowSel) {
  const raw = roamEval(windowSel, `(${roundtripInPage.toString()})()`);
  const created = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!created.ok) throw new Error("scratch block was not created");
  if (created.createdPage) appendEntry({ uid: created.pageUid, why: "page", page: created.page, graph: created.graph });
  appendEntry({ uid: created.uid, why: "PRE-2 scratch", page: created.page, graph: created.graph });
  const listed = readLedger().some((entry) => entry.uid === created.uid);
  const result = cleanup(windowSel);
  const still = blockExists(windowSel, created.uid);
  return { created, listed, cleanup: result, scratchGone: !still };
}

function print(value) {
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 1));
}

function main(argv) {
  const [cmd, a, b] = argv;
  if (cmd === "add") {
    const uid = a;
    const why = b || "";
    let page = "";
    let graph = "";
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === "--page") page = argv[i + 1] || "";
      if (argv[i] === "--graph") graph = argv[i + 1] || "";
    }
    if (!uid) throw new Error("add <uid> <why>");
    print(appendEntry({ uid, why, page, graph }));
    return;
  }
  if (cmd === "list") { print(readLedger()); return; }
  if (cmd === "cleanup") { print(cleanup(a || "Svy - ")); return; }
  if (cmd === "roundtrip") { print(roundtrip(a || "Svy - ")); return; }
  throw new Error("usage: add|list|cleanup|roundtrip");
}

if (process.argv[1] && process.argv[1].endsWith("ledger.mjs")) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message || error); process.exit(1); }
}
