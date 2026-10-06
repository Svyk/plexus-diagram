// REL-2 live smoke. Prints one line per step and exits 0 only when every step passed.
//   node tools/live/smoke.mjs "Readwisenotes - "
//   node tools/live/smoke.mjs --fail <step> "Readwisenotes - "
// Deletes only the block uids this run created. Does not call ledger cleanup.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEntry, readLedger, roamEval, writeLedger } from "./ledger.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, "smoke-page.js"), "utf8");

export const PAGE = "Plexus Diagram/Test Lab";
export const STEPS = Object.freeze([
  "create-board",
  "create-card",
  "edit-text",
  "add-arrow",
  "add-section",
  "move-card",
  "undo",
  "duplicate",
  "sidebar",
  "restore-native",
]);

export function parseArgs(argv) {
  let fail = null;
  const positional = [];
  for (let i = 0; i < (argv || []).length; i += 1) {
    const arg = argv[i];
    if (arg === "--fail") {
      const next = argv[i + 1];
      fail = next && !next.startsWith("--") ? argv[++i] : "";
    } else positional.push(arg);
  }
  return { windowSel: positional[0] || "Readwisenotes - ", fail };
}

export function stepLine(step, result) {
  if (result?.ok) return `pass ${step}`;
  const reason = String(result?.reason || "failed").replace(/\s+/g, " ").trim().slice(0, 240) || "failed";
  return `fail ${step}: ${reason}`;
}

export function exitCode(result) {
  return result?.ok ? 0 : 1;
}

function asObject(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return { ok: false, reason: raw.replace(/\s+/g, " ").trim().slice(0, 240) || "empty eval" }; }
  }
  return { ok: false, reason: "empty eval" };
}

function deleteExpression(uids) {
  return `(async () => {
    const api = window.roamAlphaAPI;
    const gone = [];
    const failed = [];
    for (const uid of ${JSON.stringify(uids)}) {
      try {
        await api.data.block.delete({ block: { uid } });
        gone.push(uid);
      } catch (error) {
        let still = null;
        try { still = api.data.pull("[:block/uid]", [":block/uid", uid]); } catch { still = null; }
        if (still && (still[":block/uid"] || still.uid)) failed.push({ uid, error: String(error && error.message || error) });
        else gone.push(uid);
      }
    }
    return JSON.stringify({ gone, failed });
  })()`;
}

function liveEvaluate(windowSel, request) {
  if (request?.op === "install") {
    return asObject(roamEval(windowSel, `${pageSource}\nJSON.stringify({ ok: typeof globalThis.__pxdSmokeStep === "function" })`));
  }
  if (request?.op === "release") {
    return asObject(roamEval(windowSel, `globalThis.__pxdSmokeStep(${JSON.stringify({ op: "release" })})`));
  }
  if (request?.op === "delete") {
    return asObject(roamEval(windowSel, deleteExpression(request.uids || [])));
  }
  if (request?.op === "step") {
    return asObject(roamEval(windowSel, `globalThis.__pxdSmokeStep(${JSON.stringify({ step: request.step })})`));
  }
  return { ok: false, reason: "bad request" };
}

// Drop only these uids. Leaves every other ledger row, including other Test Lab fixtures.
export function dropLedgerUids(uids, path) {
  const drop = new Set((uids || []).filter(Boolean));
  if (!drop.size) return [];
  const entries = readLedger(path);
  const next = entries.filter((entry) => !drop.has(entry.uid));
  if (next.length !== entries.length) writeLedger(next, path);
  return next;
}

function takeUids(result, created, record, page, graph) {
  let nextPage = page;
  let nextGraph = graph;
  if (result?.page) nextPage = result.page;
  if (result?.graph) nextGraph = result.graph;
  for (const row of result?.uids || []) {
    const uid = typeof row === "string" ? row : row?.uid;
    if (!uid || created.includes(uid)) continue;
    const why = typeof row === "string" ? "block" : (row.why || "block");
    created.push(uid);
    record({ uid, why: `REL-2 smoke ${why}`, page: nextPage, graph: nextGraph });
  }
  return { page: nextPage, graph: nextGraph };
}

async function cleanupOwned(uids, { evaluate, warn, forget }) {
  try { await evaluate({ op: "release" }); }
  catch (error) { warn?.(`release failed: ${error?.message || error}`); }
  if (!uids.length) return { ok: true, gone: [], failed: [] };
  let deleted = null;
  try {
    deleted = await evaluate({ op: "delete", uids: [...uids].reverse() });
  } catch (error) {
    return { ok: false, reason: error?.message || String(error), gone: [], failed: [] };
  }
  const failed = Array.isArray(deleted?.failed) ? deleted.failed : [];
  const failedSet = new Set(failed.map((row) => row?.uid).filter(Boolean));
  const gone = (Array.isArray(deleted?.gone) ? deleted.gone : []).filter((uid) => uid && !failedSet.has(uid));
  if (!deleted || typeof deleted !== "object") return { ok: false, reason: "cleanup returned nothing", gone, failed };
  if (gone.length) {
    try {
      const drop = forget || ((list) => dropLedgerUids(list));
      drop(gone);
    } catch (error) {
      return { ok: false, reason: error?.message || String(error), gone, failed };
    }
  }
  if (failed.length) return { ok: false, reason: failed[0]?.error || "delete failed", gone, failed };
  if (!gone.length) return { ok: false, reason: "cleanup deleted nothing", gone, failed };
  return { ok: true, gone, failed };
}

export async function runSmoke(argv = [], deps = {}) {
  const { windowSel, fail } = parseArgs(argv);
  const log = deps.log || ((line) => console.log(line));
  const warn = deps.warn || ((line) => console.error(line));
  const evaluate = deps.evaluate || ((request) => liveEvaluate(windowSel, request));
  const record = deps.record || ((entry) => appendEntry(entry));
  const created = [];
  const result = { ok: false, exitCode: 1, created };
  let page = PAGE;
  let graph = "";
  try {
    if (fail != null && !STEPS.includes(fail)) {
      log(stepLine(fail === "" ? "--fail" : fail, { ok: false, reason: "unknown step" }));
      return result;
    }
    let installed;
    try {
      installed = await evaluate({ op: "install" });
    } catch (error) {
      log(stepLine("install", { ok: false, reason: error?.message || String(error) }));
      return result;
    }
    if (!installed?.ok) {
      log(stepLine("install", { ok: false, reason: installed?.reason || "page script did not install" }));
      return result;
    }
    let ok = true;
    for (const step of STEPS) {
      let stepResult;
      if (fail === step) stepResult = { ok: false, reason: "forced" };
      else {
        try { stepResult = await evaluate({ op: "step", step }); }
        catch (error) { stepResult = { ok: false, reason: error?.message || String(error) }; }
      }
      if (!stepResult || typeof stepResult !== "object") stepResult = { ok: false, reason: "empty result" };
      try {
        const kept = takeUids(stepResult, created, record, page, graph);
        page = kept.page;
        graph = kept.graph;
      } catch (error) {
        warn(`ledger record failed: ${error?.message || error}`);
      }
      log(stepLine(step, stepResult.ok ? { ok: true } : stepResult));
      if (!stepResult.ok) { ok = false; break; }
    }
    result.ok = ok;
    result.exitCode = ok ? 0 : 1;
  } catch (error) {
    log(stepLine("smoke", { ok: false, reason: error?.message || String(error) }));
    result.ok = false;
    result.exitCode = 1;
  } finally {
    const cleanup = await cleanupOwned(created, { evaluate, warn, forget: deps.forget });
    if (!cleanup.ok) {
      warn(`cleanup failed: ${cleanup.reason}`);
      result.ok = false;
      result.exitCode = 1;
    }
  }
  return result;
}

if (process.argv[1] && process.argv[1].endsWith("smoke.mjs")) {
  runSmoke(process.argv.slice(2)).then((result) => {
    if (!result?.ok) process.exitCode = exitCode(result) || 1;
  }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
