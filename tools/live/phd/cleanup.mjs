#!/usr/bin/env node
// Remove a PhD stress build from Readwisenotes: every page titled PhD/…, every block with the phd-stress prop,
// daily pages the build created that are empty again, pages the build's own refs created that nothing links to any
// more, and the uploaded PDF/PNG files. Nothing else.
//   node tools/live/phd/cleanup.mjs [--state name|path] [--blueprint DIR] [--dry] [--keep-files]
// The state file is renamed to *.cleaned-<time>.json, so the next build starts with a fresh salt.
import { existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { loadBlueprint } from "./lib/blueprint.mjs";
import { buildPlan } from "./lib/plan.mjs";
import { loadState, saveState, statePathFor } from "./lib/state.mjs";
import { Cdp } from "./lib/cdp.mjs";
import { goDaily } from "./lib/page.mjs";

// [[Title]] / #[[Title]] / #tag titles in strings (the pages a build may have created through refs).
export function refTitles(strings) {
  const out = new Set();
  for (const s of strings) {
    const str = String(s ?? "");
    for (const m of str.matchAll(/\[\[([^[\]]+)\]\]/g)) out.add(m[1]);
    for (const m of str.matchAll(/(?:^|\s)#([^\s#[\]]+)/g)) out.add(m[1]);
  }
  return out;
}

async function sweep({ dry, createdDaily, strays, startedAt, files }) {
  const a = window.roamAlphaAPI;
  const out = { pages: 0, marked: 0, daily: 0, strays: 0, files: 0, fileErrors: 0, ms: 0 };
  const t0 = performance.now();
  const pages = a.q("[:find ?u ?t :where [?p :node/title ?t] [(clojure.string/starts-with? ?t \"PhD/\")] [?p :block/uid ?u]]") || [];
  const marked = (a.q("[:find ?u ?pt :where [?b :block/props ?p] [(get ?p :phd-stress) ?v] [?b :block/uid ?u] [?b :block/page ?pg] [?pg :node/title ?pt]]") || [])
    .filter(([, pt]) => !String(pt).startsWith("PhD/"));
  if (dry) return { pages: pages.length, marked: marked.length, sample: pages.slice(0, 10).map((r) => r[1]) };
  const pool = async (list, fn, conc = 6) => {
    const q = [...list];
    await Promise.all(Array.from({ length: conc }, async () => { for (;;) { const x = q.shift(); if (x === undefined) return; try { await fn(x); } catch (e) { console.warn("cleanup", e); } } }));
  };
  await pool(marked, async ([u]) => { await a.data.block.delete({ block: { uid: u } }); out.marked += 1; });
  await pool(pages, async ([u]) => { await a.data.page.delete({ page: { uid: u } }); out.pages += 1; }, 4);
  await new Promise((r) => setTimeout(r, 500));
  for (const uid of createdDaily || []) {
    const p = a.pull("[:node/title {:block/children [:block/uid]}]", [":block/uid", uid]);
    if (p && !(p[":block/children"] || []).length) { await a.data.page.delete({ page: { uid } }); out.daily += 1; }
  }
  for (const title of strays || []) {
    const p = a.pull("[:block/uid :create/time {:block/children [:block/uid]} {:block/_refs [:block/uid]}]", [":node/title", title]);
    if (!p || (p[":create/time"] || 0) < startedAt) continue;
    if ((p[":block/children"] || []).length || (p[":block/_refs"] || []).length) continue;
    await a.data.page.delete({ page: { uid: p[":block/uid"] } });
    out.strays += 1;
  }
  for (const url of files || []) {
    try { await a.file.delete({ url }); out.files += 1; } catch { out.fileErrors += 1; }
  }
  out.ms = Math.round(performance.now() - t0);
  return out;
}

export async function cleanup(argv) {
  const args = { state: null, blueprint: null, dry: false, keepFiles: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--state") args.state = argv[++i];
    else if (a === "--blueprint") args.blueprint = argv[++i];
    else if (a === "--dry") args.dry = true;
    else if (a === "--keep-files") args.keepFiles = true;
  }
  const statePath = args.state ? (args.state.includes("/") ? args.state : statePathFor(args.state)) : null;
  const st = statePath && existsSync(statePath) ? loadState(statePath) : null;
  let strays = [];
  const bpDir = args.blueprint || st?.blueprint;
  if (st && bpDir && existsSync(resolve(bpDir))) {
    const bp = await loadBlueprint(resolve(bpDir));
    const plan = buildPlan(bp, { salt: st.salt });
    strays = [...refTitles([...plan.ops.map((op) => op.string), ...plan.pdfs.flatMap((p) => p.highlights.map((h) => (h.tag ? `#[[PhD/Tags/${h.tag}]]` : "")))])].filter((t) => !t.startsWith("PhD/"));
  }
  const files = args.keepFiles || !st ? [] : [...Object.values(st.uploads || {}), ...Object.values(st.images || {})];
  const cdp = new Cdp({ log: console.log });
  await cdp.connect();
  await cdp.call(goDaily);
  const t0 = Date.now();
  const r = await cdp.call(sweep, { dry: args.dry, createdDaily: st?.createdDaily || [], strays, startedAt: st?.startedAt || Date.now(), files }, 1800000);
  cdp.close();
  console.log(JSON.stringify({ ...r, wallMs: Date.now() - t0 }));
  if (!args.dry && st && statePath) {
    st.cleanedAt = Date.now();
    st.cleanup = r;
    saveState(statePath, st);
    renameSync(statePath, statePath.replace(/\.json$/, `.cleaned-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  }
  return r;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cleanup(process.argv.slice(2)).catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
