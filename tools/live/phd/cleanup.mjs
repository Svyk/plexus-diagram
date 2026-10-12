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

// Maximal subtrees of at most `limit` blocks: a block is cut when it fits and its parent does not (or is the page).
// Deleting those, then the page, keeps every Roam mutation small; one page.delete of a 16k-block page ran > 10 min.
// nodes: [{ uid, parent, size }] where size = 1 + descendants and parent is null for top-level blocks.
export function cutPlan(nodes, limit = 250) {
  const size = new Map(nodes.map((n) => [n.uid, n.size]));
  return nodes.filter((n) => n.size <= limit && (!n.parent || (size.get(n.parent) ?? Infinity) > limit)).map((n) => n.uid);
}

// Blocks of one page with parent and subtree size (read only).
function pageTree(pageUid) {
  const a = window.roamAlphaAPI;
  const parents = a.data.q("[:find ?u ?pu :in $ ?pg :where [?p :block/uid ?pg] [?b :block/page ?p] [?par :block/children ?b] [?b :block/uid ?u] [?par :block/uid ?pu]]", pageUid) || [];
  const desc = a.data.q("[:find ?u (count ?d) :in $ ?pg :where [?p :block/uid ?pg] [?b :block/page ?p] [?d :block/parents ?b] [?b :block/uid ?u]]", pageUid) || [];
  const dmap = new Map(desc);
  return parents.map(([uid, pu]) => ({ uid, parent: pu === pageUid ? null : pu, size: 1 + (dmap.get(uid) || 0) }));
}

// What the namespace holds now (read only).
function census() {
  const a = window.roamAlphaAPI;
  const pages = a.q("[:find ?u ?t :where [?p :node/title ?t] [(clojure.string/starts-with? ?t \"PhD/\")] [?p :block/uid ?u]]") || [];
  const marked = (a.q("[:find ?u ?pt :where [?b :block/props ?p] [(get ?p :phd-stress) ?v] [?b :block/uid ?u] [?b :block/page ?pg] [?pg :node/title ?pt]]") || [])
    .filter(([, pt]) => !String(pt).startsWith("PhD/"));
  return { pages, marked: marked.map((r) => r[0]) };
}

// One mutation per entry. Returns how many went through; stops at Roam's mutation cap.
async function deleteMany({ blocks = [], pages = [], files = [] }) {
  const a = window.roamAlphaAPI;
  let n = 0;
  let limited = false;
  const errors = [];
  const run = async (fn) => {
    if (limited) return;
    try { await fn(); n += 1; } catch (e) {
      const m = String(e?.message || e);
      if (/maximum mutation rate limit/i.test(m)) limited = true; else errors.push(m.slice(0, 120));
    }
  };
  for (const uid of blocks) await run(() => a.data.block.delete({ block: { uid } }));
  for (const uid of pages) await run(() => a.data.page.delete({ page: { uid } }));
  for (const url of files) await run(() => a.file.delete({ url }));
  return { n, limited, errors };
}

// Daily pages the build created that are empty again, and pages only the build's refs made that nothing links to.
function leftovers({ createdDaily, strays, startedAt }) {
  const a = window.roamAlphaAPI;
  const out = { daily: [], strays: [] };
  for (const uid of createdDaily || []) {
    const p = a.pull("[:node/title {:block/children [:block/uid]}]", [":block/uid", uid]);
    const t = a.pull("[:node/title]", [":block/uid", uid]);
    if (t?.[":node/title"] && !(p?.[":block/children"] || []).length) out.daily.push(uid);
  }
  for (const title of strays || []) {
    const p = a.pull("[:block/uid :create/time {:block/children [:block/uid]} {:block/_refs [:block/uid]}]", [":node/title", title]);
    if (!p || (p[":create/time"] || 0) < startedAt) continue;
    if ((p[":block/children"] || []).length || (p[":block/_refs"] || []).length) continue;
    out.strays.push([p[":block/uid"], title]);
  }
  return out;
}

async function deleteAll(cdp, kind, list, chunk = 100) {
  let n = 0;
  for (let i = 0; i < list.length;) {
    const part = list.slice(i, i + chunk);
    const r = await cdp.mut(part.length, deleteMany, { [kind]: part }, 600000);
    n += r.n;
    if (r.errors.length) console.warn(`cleanup ${kind}:`, r.errors.slice(0, 3));
    if (r.limited) {
      const { limiter } = await import("./lib/limit.mjs");
      await limiter.saturate();
      i += r.n;
      continue;
    }
    i += part.length;
  }
  return n;
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
  const t0 = Date.now();
  const c = await cdp.call(census);
  let r;
  if (args.dry) r = { pages: c.pages.length, marked: c.marked.length, sample: c.pages.slice(0, 10).map((x) => x[1]), strays: strays.length };
  else {
    r = { marked: await deleteAll(cdp, "blocks", c.marked) };
    // Big pages first lose their subtrees in bounded pieces.
    r.cuts = 0;
    for (const [uid, title] of c.pages) {
      const nodes = await cdp.call(pageTree, uid, 600000);
      if (nodes.length <= 300) continue;
      const cuts = cutPlan(nodes);
      console.log(`cleanup: ${title}: ${nodes.length} blocks -> ${cuts.length} subtree deletes`);
      r.cuts += await deleteAll(cdp, "blocks", cuts, 25);
    }
    r.pages = await deleteAll(cdp, "pages", c.pages.map((x) => x[0]), 50);
    const left = await cdp.call(leftovers, { createdDaily: st?.createdDaily || [], strays, startedAt: st?.startedAt || Date.now() });
    r.daily = await deleteAll(cdp, "pages", left.daily);
    r.strays = await deleteAll(cdp, "pages", left.strays.map((x) => x[0]));
    r.strayTitles = left.strays.map((x) => x[1]).slice(0, 20);
    r.files = await deleteAll(cdp, "files", files);
    const after = await cdp.call(census);
    r.left = { pages: after.pages.length, marked: after.marked.length };
  }
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
