#!/usr/bin/env node
// Verify a PhD stress build against its blueprint, or that a cleanup left nothing behind.
//   node tools/live/phd/verify.mjs <blueprintDir> [--state name|path] [--plexus] [--json out.json]
//   node tools/live/phd/verify.mjs --empty
// --plexus also loads every board through Plexus's own session (window.__plexusDiagram.session) and compares
// its item and edge counts with the blueprint.
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadBlueprint, validate } from "./lib/blueprint.mjs";
import { buildPlan } from "./lib/plan.mjs";
import { loadState, statePathFor } from "./lib/state.mjs";
import { Cdp } from "./lib/cdp.mjs";
import { existing, sidebarCount } from "./lib/page.mjs";

// Everything in the namespace: PhD/ pages, blocks carrying the phd-stress prop, PDF pages still holding our uploads.
export function namespaceCensus() {
  const a = window.roamAlphaAPI;
  const pages = a.q("[:find ?u ?t :where [?p :node/title ?t] [(clojure.string/starts-with? ?t \"PhD/\")] [?p :block/uid ?u]]") || [];
  const marked = a.q("[:find ?u :where [?b :block/props ?p] [(get ?p :phd-stress) ?v] [?b :block/uid ?u]]") || [];
  const blocks = a.q("[:find (count ?b) . :where [?p :node/title ?t] [(clojure.string/starts-with? ?t \"PhD/\")] [?b :block/page ?p]]") || 0;
  return { pages: pages.length, pageTitles: pages.slice(0, 20).map((r) => r[1]), marked: marked.length, blocks };
}

export function libraryCensus(urls) {
  const a = window.roamAlphaAPI;
  const out = {};
  for (const [id, url] of Object.entries(urls)) {
    const page = a.data.q("[:find ?u ?t :in $ ?url :where [?p :pdf/url ?url] [?p :block/uid ?u] [?p :node/title ?t]]", url)?.[0];
    if (!page) { out[id] = { page: null }; continue; }
    const hl = a.data.q("[:find (count ?b) . :in $ ?url :where [?p :pdf/url ?url] [?b :annotation/origin ?p]]", url) || 0;
    const tree = a.pull("[:pdf/content-hash {:block/children [:block/string :block/order]}]", [":block/uid", page[0]]);
    const kids = (tree?.[":block/children"] || []).slice().sort((x, y) => x[":block/order"] - y[":block/order"]);
    out[id] = { page: page[0], title: page[1], highlights: hl, hash: Boolean(tree?.[":pdf/content-hash"]), pdfFirst: /^\{\{\[\[pdf\]\]:/.test(kids[0]?.[":block/string"] || "") };
  }
  return out;
}

export async function plexusCounts(boardUids) {
  const out = {};
  for (const uid of boardUids) {
    const s = window.__plexusDiagram?.session(uid);
    if (!s) { out[uid] = null; continue; }
    const t0 = performance.now();
    for (let i = 0; i < 100 && !s.board; i += 1) await new Promise((r) => setTimeout(r, 50));
    const b = s.board;
    out[uid] = b ? { items: b.items.size, edges: b.edges.size, ms: Math.round(performance.now() - t0) } : null;
    s.release();
  }
  return out;
}

const log = (...m) => console.log(...m);

export async function verify(argv) {
  const args = { dir: null, state: null, plexus: false, json: null, empty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--state") args.state = argv[++i];
    else if (a === "--plexus") args.plexus = true;
    else if (a === "--json") args.json = argv[++i];
    else if (a === "--empty") args.empty = true;
    else if (!args.dir) args.dir = a;
  }
  const cdp = new Cdp({ log });
  await cdp.connect();
  const report = { at: new Date().toISOString(), checks: [], ok: true };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass, detail });
    if (!pass) report.ok = false;
    log(`${pass ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  };
  const sidebar = await cdp.call(sidebarCount);
  check("right sidebar empty", sidebar === 0, `${sidebar} windows`);
  if (args.empty) {
    const c = await cdp.call(namespaceCensus);
    check("no PhD/ pages", c.pages === 0, c.pageTitles);
    check("no phd-stress blocks", c.marked === 0, `${c.marked}`);
    if (args.state) {
      const st = loadState(args.state.includes("/") ? args.state : statePathFor(args.state));
      if (Object.keys(st.uploads || {}).length) {
        const lib = await cdp.call(libraryCensus, st.uploads);
        const left = Object.values(lib).filter((x) => x.page).length;
        check("no Roam PDF pages for our uploads", left === 0, `${left}`);
      }
    }
  } else {
    const dir = resolve(args.dir);
    const bp = await loadBlueprint(dir);
    const v = validate(bp);
    const statePath = args.state?.includes("/") ? args.state : statePathFor(args.state || bp.meta?.stateName || "real");
    if (!existsSync(statePath)) throw new Error(`no state at ${statePath}`);
    const st = loadState(statePath);
    const plan = buildPlan(bp, { salt: st.salt, author: bp.meta?.author || "Svy" });
    const alias = st.alias || {};
    const uids = plan.ops.map((op) => alias[op.uid] || op.uid);
    const have = new Set();
    for (let i = 0; i < uids.length; i += 2000) for (const u of await cdp.call(existing, uids.slice(i, i + 2000))) have.add(u);
    const missing = plan.ops.filter((op) => !have.has(alias[op.uid] || op.uid));
    const byStage = {};
    for (const op of missing) byStage[op.stage] = (byStage[op.stage] || 0) + 1;
    check("every planned block/page exists", missing.length === 0, missing.length ? { missing: missing.length, byStage, first: missing.slice(0, 5).map((m) => m.key) } : `${plan.ops.length} ops`);
    const hlPlanned = plan.pdfs.reduce((n, p) => n + p.highlights.length, 0);
    const hlMade = Object.keys(st.hl || {}).length;
    const lib = await cdp.call(libraryCensus, st.uploads || {});
    const roamHl = Object.values(lib).reduce((n, x) => n + (x.highlights || 0), 0);
    check("PDFs uploaded", Object.keys(st.uploads || {}).length === plan.pdfs.length, `${Object.keys(st.uploads || {}).length}/${plan.pdfs.length}`);
    check("Roam highlights == state", roamHl === hlMade, `roam ${roamHl}, state ${hlMade}, planned ${hlPlanned}, text not found ${Object.values(st.hlMissed || {}).filter((x) => x === "text not found").length}`);
    const bad = Object.entries(lib).filter(([, x]) => x.page && (!x.pdfFirst || !x.hash || !String(x.title).startsWith("PhD/Library/")));
    check("library pages: PhD/Library title, :pdf/content-hash, pdf block first", bad.length === 0, bad.slice(0, 5));
    const counts = await cdp.call((root) => {
      const a = window.roamAlphaAPI;
      const desc = a.data.q("[:find (count ?c) . :in $ ?u :where [?r :block/uid ?u] [?c :block/parents ?r]]", root) || 0;
      const props = a.pull("[:block/props]", [":block/uid", root])?.[":block/props"];
      return { desc, v: props?.[":plexus"]?.[":v"] ?? props?.plexus?.v };
    }, alias[plan.boardUidOf(v.rootId)] || plan.boardUidOf(v.rootId));
    const rootOps = plan.ops.filter((op) => op.stage !== "pages" && op.kind === "block").length;
    check("root board block is enhanced (plexus.v 2)", counts.v === 2, `v=${counts.v}`);
    report.counts = { blueprint: v.counts, planOps: plan.ops.length, rootDescendants: counts.desc, rootPlanned: rootOps, highlights: { planned: hlPlanned, made: hlMade, roam: roamHl } };
    log(`root board has ${counts.desc} descendant blocks (plan ${rootOps} structure/edge/extra blocks incl. off-board ones)`);
    if (args.plexus) {
      const boardIds = bp.boards.map((b) => b.id).filter((id) => id === v.rootId || bp.cards.some((c) => c.id === bp.boards.find((x) => x.id === id).card));
      const uidOf = (id) => alias[plan.boardUidOf(id)] || plan.boardUidOf(id);
      const got = await cdp.call(plexusCounts, boardIds.map(uidOf), 600000);
      const rows = [];
      for (const id of boardIds) {
        const b = bp.boards.find((x) => x.id === id);
        const wantItems = (b.sections || []).length + bp.cards.filter((c) => c.board === id).length;
        const wantEdges = plan.ops.filter((op) => op.stage === "edges" && op.key.startsWith("edge:") && op.parent === plan.ops.find((o) => o.key === `edges:${id}`)?.uid).length;
        const g = got[uidOf(id)];
        rows.push({ id, wantItems, items: g?.items, wantEdges, edges: g?.edges, ms: g?.ms });
      }
      // The graph itself (datalog, no pull limit): every planned edge sits in its board's Connections block.
      const containers = boardIds.map((id) => ({ id, uid: alias[plan.ops.find((o) => o.key === `edges:${id}`)?.uid] || plan.ops.find((o) => o.key === `edges:${id}`)?.uid })).filter((x) => x.uid);
      const inGraph = await cdp.call((list) => Object.fromEntries(list.map(({ id, uid }) => [id, window.roamAlphaAPI.data.q("[:find (count ?c) . :in $ ?u :where [?p :block/uid ?u] [?p :block/children ?c]]", uid) || 0])), containers);
      for (const r of rows) r.graphEdges = inGraph[r.id] ?? 0;
      const graphOff = rows.filter((r) => r.graphEdges !== r.wantEdges);
      check("graph holds every board's edges (datalog)", graphOff.length === 0, graphOff.length ? graphOff.slice(0, 8) : `${rows.reduce((n, r) => n + r.graphEdges, 0)} edges`);
      const off = rows.filter((r) => r.items !== r.wantItems || r.edges !== r.wantEdges);
      // A Plexus view short of the graph is a Plexus finding (e.g. DataScript pull's default 1000-children limit),
      // reported but not a build failure.
      report.plexusFindings = off;
      log(`${off.length ? "WARN" : "PASS"} Plexus sees every board's items and edges — ${off.length ? JSON.stringify(off.slice(0, 8)) : `${rows.length} boards`}`);
      report.plexus = rows;
    }
  }
  cdp.close();
  if (args.json) await writeFile(args.json, JSON.stringify(report, null, 1));
  log(report.ok ? "VERIFY OK" : "VERIFY FAILED");
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verify(process.argv.slice(2)).then((r) => process.exit(r.ok ? 0 : 1)).catch((e) => { console.error(e.stack || e.message); process.exit(2); });
}
