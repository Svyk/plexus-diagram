#!/usr/bin/env node
// Build a `pxd-phd/1` blueprint into the Readwisenotes graph as a real Plexus world.
//   node tools/live/phd/build.mjs <blueprintDir> [--state name|path] [--conc 8] [--stages pages,pdf,images,structure,edges,extras]
//                                 [--force] [--dry]
// Resumable and idempotent: uids are derived from the state's salt, so a re-run skips everything that exists.
// See tools/live/phd/README.md.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadBlueprint, validate } from "./lib/blueprint.mjs";
import { buildPlan, resolveString, MARK } from "./lib/plan.mjs";
import { loadState, saveState, statePathFor, WO } from "./lib/state.mjs";
import { Cdp } from "./lib/cdp.mjs";
import { serveFiles } from "./lib/serve.mjs";
import { loadPdfText, locateLoose } from "./lib/pdftext.mjs";
import { cropUpload, goDaily, readerHighlight, readerOpen, sidebarCount, updateBlocks, uploadFrom, existing } from "./lib/page.mjs";
import { writeAll, sleep } from "./lib/write.mjs";

const ALL_STAGES = ["pages", "pdf", "images", "structure", "edges", "extras"];

export function parseArgs(argv) {
  const args = { dir: null, state: null, conc: 8, stages: ALL_STAGES, force: false, dry: false, hlChunk: 40 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--state") args.state = argv[++i];
    else if (a === "--conc") args.conc = Number(argv[++i]);
    else if (a === "--stages") args.stages = argv[++i].split(",");
    else if (a === "--force") args.force = true;
    else if (a === "--dry") args.dry = true;
    else if (!args.dir) args.dir = a;
  }
  return args;
}

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

export async function build(argv) {
  const args = parseArgs(argv);
  if (!args.dir) throw new Error("usage: build.mjs <blueprintDir> [--state name]");
  const dir = resolve(args.dir);
  const bp = await loadBlueprint(dir);
  const v = validate(bp);
  log(`blueprint ${dir}: ${v.errors.length} errors, ${v.warnings.length} warnings`, JSON.stringify(v.counts));
  if (v.errors.length) {
    for (const e of v.errors.slice(0, 30)) log("  ERROR", e);
    if (!args.force) throw new Error("blueprint invalid (use --force to build what is valid)");
  }
  const statePath = args.state?.includes("/") ? args.state : statePathFor(args.state || bp.meta?.stateName || "real");
  const state = loadState(statePath, { blueprint: dir });
  state.blueprint = dir;
  const save = () => saveState(statePath, state);
  save();
  const plan = buildPlan(bp, { salt: state.salt, author: bp.meta?.author || "Svy" });
  log(`plan: ${plan.ops.length} ops, ${plan.pdfs.length} pdfs, ${plan.warnings.length} warnings; state ${statePath} (salt ${state.salt})`);
  for (const w of plan.warnings.slice(0, 20)) log("  warn", w);
  if (args.dry) return { plan, v };

  const cdp = new Cdp({ log });
  await cdp.connect();
  const sidebar0 = await cdp.call(sidebarCount);
  if (sidebar0) log(`note: right sidebar has ${sidebar0} windows (not touched)`);
  await cdp.call(goDaily);
  const timings = (state.timings ||= {});
  const run = async (name, fn) => {
    if (!args.stages.includes(name)) return;
    const t0 = Date.now();
    log(`stage ${name}`);
    const out = await fn();
    timings[name] = { ms: Date.now() - t0, ...(out || {}), at: new Date().toISOString() };
    state.stages[name] = "done";
    save();
    log(`stage ${name} done in ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(out || {}).slice(0, 400));
  };

  // Placeholder resolution against what the state knows so far.
  const opByCard = new Map();
  for (const op of plan.ops) if (op.card) opByCard.set(op.card, op);
  const memo = new Map();
  const ctx = {
    hl: (s, i) => state.hl[`${s}:${i}`] || null,
    img: (k) => state.images[k] || null,
    cardUid: (k) => opByCard.get(k)?.uid,
    cardString: (k) => {
      if (memo.has(k)) return memo.get(k);
      const op = opByCard.get(k);
      if (!op) return null;
      const s = resolveString(op.string, ctx) ?? op.fallback ?? null;
      memo.set(k, s);
      return s;
    },
  };
  const resolveOps = (ops) => {
    const out = [];
    let fell = 0;
    let dropped = 0;
    for (const op of ops) {
      if (op.kind === "page") { out.push(op); continue; }
      let s = resolveString(op.string, ctx);
      if (s == null) {
        if (op.fallback != null) { s = op.fallback; fell += 1; } else { dropped += 1; continue; }
      }
      out.push({ ...op, string: s });
    }
    return { out, fell, dropped };
  };
  const stageOps = (stage) => plan.ops.filter((op) => op.stage === stage);
  const writeStage = async (stage) => {
    memo.clear();
    const { out, fell, dropped } = resolveOps(stageOps(stage));
    const stats = await writeAll(cdp, out, { alias: state.alias, conc: args.conc, log, label: stage });
    state.failed.push(...stats.failed.map((f) => ({ ...f, stage })));
    if (stage === "extras") {
      for (const op of out) if (op.kind === "page" && op.daily && !state.createdDaily.includes(op.uid) && !state.alias[op.uid]) state.createdDaily.push(op.uid);
    }
    return { ...stats, failed: stats.failed.length, fallbacks: fell, dropped };
  };

  await run("pages", () => writeStage("pages"));

  // ---- PDFs: upload, library page + pdf block, Roam highlights, then the pdf block moves onto Roam's PDF page ----
  await run("pdf", async () => {
    const files = {};
    const libDir = existsSync(join(dir, "pdfs")) ? join(dir, "pdfs") : (bp.meta?.pdfDir ? resolve(dir, bp.meta.pdfDir) : `${WO}/library-pdfs`);
    for (const p of plan.pdfs) files[`${p.id}.pdf`] = { path: p.file.startsWith("/") ? p.file : join(libDir, p.file), append: `\n%phd-stress ${p.id} ${state.salt}\n` };
    const server = await serveFiles(files);
    const out = { pdfs: 0, uploaded: 0, uploadMs: 0, highlights: 0, hlMs: 0, missedText: 0, missedRoam: 0, failedPdfs: [] };
    try {
      for (const p of plan.pdfs) {
        const path = files[`${p.id}.pdf`].path;
        if (!existsSync(path)) { log(`  ${p.id}: file missing ${path}`); out.failedPdfs.push(p.id); continue; }
        // 1. upload
        if (!state.uploads[p.id]) {
          const t0 = Date.now();
          try {
            const r = await cdp.call(uploadFrom, { src: server.url(`${p.id}.pdf`), name: `phd-${p.id}.pdf` }, 300000);
            state.uploads[p.id] = r.url;
            out.uploaded += 1;
            out.uploadMs += Date.now() - t0;
            save();
          } catch (e) { log(`  ${p.id}: upload failed ${e.message}`); out.failedPdfs.push(p.id); continue; }
        }
        const url = state.uploads[p.id];
        // 2. library page + pdf block (skipped when the block already exists anywhere)
        const finalPage = state.pdfPage[p.id];
        const [hasBlock] = await cdp.call(existing, [p.pdfBlockUid]);
        if (!hasBlock) {
          const ops = [
            { kind: "page", uid: p.pageUid, title: p.title, key: `pdfpage:${p.id}` },
            { kind: "block", uid: p.pdfBlockUid, parent: finalPage || p.pageUid, string: `{{[[pdf]]: ${url}}}`, props: { [MARK]: 1 }, key: `pdf:${p.id}` },
          ];
          await writeAll(cdp, finalPage ? ops.slice(1) : ops, { alias: state.alias, log, label: `pdf ${p.id}` });
        }
        // 3. highlights through Roam's reader
        const todo = p.highlights.filter((h) => !state.hl[`${p.id}:${h.i}`] && !state.hlMissed[`${p.id}:${h.i}`]);
        if (todo.length) {
          const text = await loadPdfText(await readFile(path));
          state.hlMeta[p.id] = { pages: text.numPages };
          const items = [];
          for (const h of todo) {
            const pos = locateLoose(text.pages, h.text, h.page);
            if (!pos) { state.hlMissed[`${p.id}:${h.i}`] = "text not found"; out.missedText += 1; continue; }
            if (pos.partial) { (state.hlPartial ||= {})[`${p.id}:${h.i}`] = pos.text; out.partial = (out.partial || 0) + 1; }
            items.push({ key: `${p.id}:${h.i}`, text: pos.text, position: { boundingRect: pos.boundingRect, rects: pos.rects, pageNumber: pos.pageNumber } });
          }
          save();
          if (items.length) {
            const open = await cdp.call(readerOpen, { pdfUid: p.pdfBlockUid });
            if (!open.ok) { log(`  ${p.id}: ${open.reason}`); out.failedPdfs.push(p.id); continue; }
            const t0 = Date.now();
            for (let i = 0; i < items.length; i += args.hlChunk) {
              const r = await cdp.call(readerHighlight, { url, items: items.slice(i, i + args.hlChunk) }, 900000);
              Object.assign(state.hl, r.made);
              for (const k of r.missed) { state.hlMissed[k] = "roam made no block"; out.missedRoam += 1; }
              out.highlights += Object.keys(r.made).length;
              save();
            }
            out.hlMs += Date.now() - t0;
            await cdp.call(goDaily);
          }
        }
        // 4. colour, note
        const updates = [];
        const notes = [];
        for (const h of p.highlights) {
          const uid = state.hl[`${p.id}:${h.i}`];
          if (!uid) continue;
          if (h.color !== "yellow") updates.push({ uid, colour: h.color });
          if (h.note || h.tag) notes.push({ kind: "block", uid: h.noteUid, parent: uid, string: [h.note, h.tag ? `#[[PhD/Tags/${h.tag}]]` : ""].filter(Boolean).join(" "), key: `hlnote:${p.id}:${h.i}` });
        }
        if (updates.length) {
          const cur = await cdp.call((uids) => Object.fromEntries((window.roamAlphaAPI.data.pull_many("[:block/uid :block/string]", uids.map((u) => [":block/uid", u])) || []).filter(Boolean).map((r) => [r[":block/uid"], r[":block/string"]])), updates.map((u) => u.uid));
          const list = updates.filter((u) => typeof cur[u.uid] === "string" && / #h\/yellow$/.test(cur[u.uid])).map((u) => ({ uid: u.uid, string: cur[u.uid].replace(/ #h\/yellow$/, ` #h/${u.colour}`) }));
          if (list.length) await cdp.call(updateBlocks, { list });
        }
        if (notes.length) await writeAll(cdp, notes, { alias: state.alias, conc: args.conc, log, label: `notes ${p.id}` });
        // 5. Roam made its own PDF page (:pdf/url, :pdf/content-hash, Notes by …). Put the pdf block on top of it,
        //    drop our placeholder page, and give Roam's page the library title.
        if (!state.pdfPage[p.id]) {
          const r = await cdp.call(async ({ url, pdfUid, ourPage, title }) => {
            const a = window.roamAlphaAPI;
            const roamPage = a.data.q("[:find ?u . :in $ ?url :where [?p :pdf/url ?url] [?p :block/uid ?u]]", url);
            if (!roamPage || roamPage === ourPage) return { page: ourPage, moved: false };
            await a.data.block.move({ location: { "parent-uid": roamPage, order: 0 }, block: { uid: pdfUid } });
            // pull answers null for a page with no children (and for a missing page).
            const left = a.pull("[:node/title {:block/children [:block/uid]}]", [":block/uid", ourPage]);
            if (left?.[":node/title"] && !(left[":block/children"] || []).length) await a.data.page.delete({ page: { uid: ourPage } });
            else if (!left) {
              const bare = a.pull("[:node/title]", [":block/uid", ourPage]);
              if (bare?.[":node/title"]) await a.data.page.delete({ page: { uid: ourPage } });
            }
            for (let i = 0; i < 50 && a.pull("[:block/uid]", [":node/title", title])?.[":block/uid"] && a.pull("[:block/uid]", [":node/title", title])[":block/uid"] !== roamPage; i += 1) {
              await new Promise((r) => setTimeout(r, 100));
            }
            await a.data.page.update({ page: { uid: roamPage, title } });
            return { page: roamPage, moved: true };
          }, { url, pdfUid: p.pdfBlockUid, ourPage: state.alias[p.pageUid] || p.pageUid, title: p.title });
          if (r.moved) state.pdfPage[p.id] = r.page;
          save();
        }
        out.pdfs += 1;
        log(`  ${p.id}: ${p.highlights.length} highlights planned, ${p.highlights.filter((h) => state.hl[`${p.id}:${h.i}`]).length} in Roam`);
      }
    } finally {
      await server.close();
      await cdp.call(goDaily);
    }
    out.hlPerSec = out.hlMs ? +(out.highlights / (out.hlMs / 1000)).toFixed(2) : 0;
    return out;
  });

  // ---- images: crops of library PDF pages, uploaded as PNG ----
  await run("images", async () => {
    const out = { made: 0, failed: 0, ms: 0 };
    const t0 = Date.now();
    for (const c of bp.cards) {
      if (c.type !== "image" || c.image?.url || state.images[c.id]) continue;
      const pdfUrl = state.uploads[c.image?.source];
      if (!pdfUrl) { out.failed += 1; continue; }
      try {
        const r = await cdp.call(cropUpload, { pdfUrl, page: c.image.page, crop: c.image.crop, name: `phd-${c.id}.png` }, 300000);
        state.images[c.id] = r.url;
        out.made += 1;
        if (out.made % 10 === 0) save();
      } catch (e) {
        out.failed += 1;
        if (out.failed < 5) log(`  image ${c.id}: ${e.message}`);
      }
    }
    out.ms = Date.now() - t0;
    return out;
  });

  await run("structure", () => writeStage("structure"));
  await run("edges", () => writeStage("edges"));
  await run("extras", () => writeStage("extras"));

  const sidebar1 = await cdp.call(sidebarCount);
  state.sidebar = { before: sidebar0, after: sidebar1 };
  state.finishedAt = Date.now();
  save();
  cdp.close();
  log(`build finished; sidebar windows ${sidebar0} -> ${sidebar1}; state ${statePath}`);
  return { plan, v, state };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  build(process.argv.slice(2)).catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
