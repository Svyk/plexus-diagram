// A/B runner: two builds, interleaved and counterbalanced, in the bench window (PXD-25).
//   node tools/live/stress/ab.mjs --a <dirA> --b <dirB> [--scenario x,y | --group g] [--n 5] [--label ab1] [--aa] [--dry]
//        [--out dir] [--target id] [--force] [--keep-going] [--inline] [--quick] [--wait 40]
// An arm is a folder with extension.js and extension.css (this repo: <worktree>/deploy). --aa runs the same build twice
// (arms A1 and A2) to measure the noise floor; an A/B run reads that floor from OUT_DIR/noise.jsonl.
// --dry prints the plan and imports nothing that connects. Every real arm is one in-process run.mjs main() call.
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { summarize, noiseFloor, verdict } from "./lib/stats.mjs";

const VALUE = new Set(["a", "b", "scenario", "group", "n", "label", "out", "target", "wait", "soak-min"]);
const BOOL = new Set(["aa", "dry", "force", "keep-going", "inline", "quick"]);
const METRICS = ["ttnp", "stalls.total", "stalls.worst", "stalls.n", "frames.max", "content.live.p95", "long.total"];

export function parseArgs(argv) {
  const a = { a: null, b: null, scenario: null, group: null, n: 5, label: "ab", aa: false, dry: false, force: false, keepGoing: false, inline: false, quick: false, out: null, target: null, waitS: 40, soakMin: null };
  const camel = (k) => k.replace(/-(\w)/g, (_, c) => c.toUpperCase());
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) throw new Error(`unexpected argument ${t}`);
    const eq = t.indexOf("=");
    const k = t.slice(2, eq < 0 ? undefined : eq);
    if (BOOL.has(k)) { a[camel(k)] = true; continue; }
    if (!VALUE.has(k)) throw new Error(`unknown flag --${k}`);
    const v = eq < 0 ? argv[++i] : t.slice(eq + 1);
    if (v == null) throw new Error(`--${k} needs a value`);
    if (k === "n") a.n = Math.max(1, Number(v) || 1);
    else if (k === "wait") a.waitS = Math.max(0, Number(v));
    else if (k === "soak-min") a.soakMin = Number(v);
    else a[camel(k)] = v;
  }
  return a;
}

const outDirOf = (a) => (a.out ? resolve(a.out) : process.env.STRESS_OUT || join(homedir(), "wo", "pxd-fast"));
const get = (o, path) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const f1 = (x) => (x == null ? "-" : String(Math.round(x * 10) / 10));

// every numeric leaf under extra.metrics, as "extra.metrics.a.b"
function leaves(obj, prefix, out = {}) {
  if (obj == null || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = `${prefix}.${k}`;
    if (num(v) != null) out[p] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) leaves(v, p, out);
  }
  return out;
}

export function planOf(a) {
  const arms = a.aa ? ["A1", "A2"] : ["A", "B"];
  const plan = [];
  for (let k = 0; k < a.n; k++) {
    const order = k % 2 === 0 ? arms : [arms[1], arms[0]];
    for (const arm of order) plan.push({ round: k + 1, arm });
  }
  return { arms, plan };
}

async function readLines(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const l of (await readFile(file, "utf8")).split("\n")) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch { /* torn line */ }
  }
  return out;
}

// metric name -> values for one scenario's lines of one arm
function collect(lines) {
  const m = {};
  for (const l of lines) {
    for (const name of METRICS) { const v = num(get(l, name)); if (v != null) (m[name] = m[name] || []).push(v); }
    for (const [p, v] of Object.entries(leaves(get(l, "extra.metrics"), "extra.metrics"))) (m[p] = m[p] || []).push(v);
  }
  return m;
}

const cell = (s) => (s.n ? `${s.n} ${f1(s.p50)} [${f1(s.min)}..${f1(s.max)}]` : "0 -");

export async function ab(argv, deps = {}) {
  const log = deps.log || ((s) => console.log(s));
  let a;
  try { a = parseArgs(argv); } catch (e) { console.error(e.message); return 2; }
  if (a.aa && !a.a && a.b) { a.a = a.b; }
  if (!a.a) { console.error("--a <dir> is required (--b <dir> too, unless --aa)"); return 2; }
  if (a.aa || !a.b) {
    if (!a.aa && !a.b) { console.error("--b <dir> is required (or use --aa for the noise floor run)"); return 2; }
    a.b = a.a;
  }
  if (a.a === a.b) a.aa = true;
  if (!a.scenario && !a.group) { console.error("name --scenario x,y or --group g"); return 2; }
  if (a.n < 5 && !a.force) { console.error(`n ${a.n} is below 5: one run is never trusted (add --force to override)`); return 2; }
  const dirA = resolve(a.a), dirB = resolve(a.b);
  const { arms, plan } = planOf(a);
  const dirOf = (arm) => (arm === arms[0] ? dirA : dirB);
  const scen = a.scenario || a.group;
  const OUT = outDirOf(a);

  log(`out ${OUT}  label ${a.label}  n ${a.n}  ${a.aa ? "A/A noise run" : "A/B run"}  ${a.scenario ? "scenario" : "group"} ${scen}`);
  log(`${arms[0]} = ${dirA}`);
  log(`${arms[1]} = ${dirB}`);
  plan.forEach((p, i) => log(`  arm ${i + 1}/${plan.length}  round ${p.round}  ${p.arm}  ${dirOf(p.arm)}`));
  log(`${plan.length} arms, ${a.waitS} s between arms`);
  if (a.dry) return 0;

  for (const d of new Set([dirA, dirB])) {
    for (const f of ["extension.js", "extension.css"]) if (!existsSync(join(d, f))) { console.error(`${join(d, f)} is missing`); return 2; }
  }
  const main = deps.main || (await import("./run.mjs")).main;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  await mkdir(OUT, { recursive: true });

  const flags = [];
  if (a.scenario) flags.push("--scenario", a.scenario); else flags.push("--group", a.group);
  if (a.target) flags.push("--target", a.target);
  flags.push("--out", OUT);
  if (a.keepGoing) flags.push("--keep-going");
  if (a.inline) flags.push("--inline");
  if (a.quick) flags.push("--quick");
  if (a.soakMin != null) flags.push("--soak-min", String(a.soakMin));

  const startedAt = new Date().toISOString();
  let failed = 0;
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const t0 = Date.now();
    log(`arm ${i + 1}/${plan.length}: round ${p.round} ${p.arm}`);
    const code = await main(["--build", dirOf(p.arm), ...flags, "--n", "1", "--label", `${a.label}:${p.arm}`], deps.mainDeps || {});
    if (code) { failed++; console.error(`arm ${p.arm} round ${p.round} exited ${code}`); }
    if (i < plan.length - 1) {
      const left = a.waitS * 1000 - (Date.now() - t0);
      if (left > 0) { log(`waiting ${Math.round(left / 1000)} s before the next arm`); await sleep(left); }
    }
  }

  // ---- read the lines this run produced
  const mine = (await readLines(join(OUT, "results.jsonl"))).filter((l) => typeof l.label === "string" && l.label.startsWith(`${a.label}:`) && (!l.at || l.at >= startedAt) && l.traced !== true);
  const armOf = (l) => l.label.slice(a.label.length + 1);
  const shaOf = (arm) => (mine.find((l) => armOf(l) === arm && l.build && l.build.sha) || { build: {} }).build.sha || null;
  const names = [...new Set(mine.map((l) => `${l.group}/${l.scenario}`))];
  const noise = await readLines(join(OUT, "noise.jsonl"));
  const at = new Date().toISOString();
  const table = [];
  const noiseOut = [];

  for (const sc of names) {
    const lines = mine.filter((l) => `${l.group}/${l.scenario}` === sc && !l.err && !l.skip);
    const bad = mine.filter((l) => `${l.group}/${l.scenario}` === sc && (l.err || l.skip));
    const A = collect(lines.filter((l) => armOf(l) === arms[0])), B = collect(lines.filter((l) => armOf(l) === arms[1]));
    log(`\n${sc}${bad.length ? `   (${bad.length} errored or skipped lines left out)` : ""}`);
    log(a.aa
      ? `| metric | ${arms[0]} n p50 [min..max] | ${arms[1]} n p50 [min..max] | delta | spread | floor |\n|---|---|---|---|---|---|`
      : `| metric | A n p50 [min..max] | B n p50 [min..max] | delta | rel % | floor | verdict |\n|---|---|---|---|---|---|---|`);
    const metrics = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort((x, y) => (METRICS.indexOf(x) < 0 ? 99 : METRICS.indexOf(x)) - (METRICS.indexOf(y) < 0 ? 99 : METRICS.indexOf(y)) || x.localeCompare(y));
    for (const m of metrics) {
      const va = A[m] || [], vb = B[m] || [];
      const sa = summarize(va), sb = summarize(vb);
      const row = { scenario: sc, metric: m, a: sa, b: sb };
      if (a.aa) {
        const nf = noiseFloor(va, vb);
        Object.assign(row, { delta: nf.delta, spread: nf.spread, floor: nf.floor });
        noiseOut.push({ at, label: a.label, scenario: sc, metric: m, floor: nf.floor, delta: nf.delta, spread: nf.spread, n: Math.min(va.length, vb.length), a: sa, b: sb });
        log(`| ${m} | ${cell(sa)} | ${cell(sb)} | ${f1(nf.delta)} | ${f1(nf.spread)} | ${f1(nf.floor)} |`);
      } else {
        const prev = noise.filter((x) => x.scenario === sc && x.metric === m && x.floor != null).pop();
        const floor = prev ? prev.floor : null;
        const v = verdict(va, vb, floor);
        const text = floor == null ? "no floor: run --aa first" : !v.beats ? "within noise" : v.better === "b" ? "B better" : "A better";
        Object.assign(row, { delta: v.delta, rel: v.rel, floor, verdict: text });
        log(`| ${m} | ${cell(sa)} | ${cell(sb)} | ${f1(v.delta)} | ${v.rel == null ? "-" : f1(v.rel * 100)} | ${f1(floor)} | ${text} |`);
      }
      table.push(row);
    }
    if (!metrics.length) log("(no numbers: every line errored, was skipped, or had no summary)");
  }
  if (!names.length) console.error(`no result lines with label ${a.label}:* since ${startedAt} in ${join(OUT, "results.jsonl")}`);

  if (noiseOut.length) await appendFile(join(OUT, "noise.jsonl"), noiseOut.map((x) => JSON.stringify(x)).join("\n") + "\n");
  await appendFile(join(OUT, "ab.jsonl"), JSON.stringify({ at, label: a.label, aa: a.aa, a: { dir: dirA, sha: shaOf(arms[0]) }, b: { dir: dirB, sha: shaOf(arms[1]) }, n: a.n, scenarios: names, table }) + "\n");
  log(`\n${names.length} scenarios, ${table.length} rows${noiseOut.length ? `, ${noiseOut.length} lines appended to ${join(OUT, "noise.jsonl")}` : ""}${failed ? `, ${failed} arms exited non-zero` : ""}`);
  return failed || !names.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ab(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error((e && e.stack) || e); process.exit(1); });
}
