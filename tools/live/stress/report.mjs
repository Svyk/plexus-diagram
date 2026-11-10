// Round report from the stress result files (PXD-25). Offline: reads OUT_DIR, never connects.
//   node tools/live/stress/report.mjs [--label base] [--out report.md] [--rec rec/real-1.analysis.json] [--findings f.jsonl] [--notes n.jsonl] [--dev-label dev]
//        [--title "..."] [--write-budgets] [--selftest]
// OUT_DIR is STRESS_OUT or ~/wo/pxd-fast.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdtempSync } from "node:fs";
import { join, resolve, basename, dirname, isAbsolute } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { median, summarize } from "./lib/stats.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUDGETS_FILE = join(HERE, "budgets.json");

// Quick check rows: edit here. [command, what it should print, how long]
export const QUICK_CHECKS = [
  ["node tools/live/stress/run.mjs --list", "one line per scenario, grouped move / open / edit / idle", "instant"],
  ["node tools/live/stress/run.mjs --quick", "one JSON-like line per scenario, then `N lines in .../results.jsonl`; exit 0", "about 6 min"],
  ["node tools/live/stress/run.mjs --cleanup", "a JSON line containing `\"clean\": true`", "under 1 min"],
  ["node tools/live/stress/analyse.mjs <recording> --selftest", "`selftest ok`", "instant"],
  ["node tools/live/stress/ab.mjs --aa --a deploy --scenario zoom-btn --dry", "a plan of 10 arms (n 5, A1/A2 interleaved), nothing connects", "instant"],
  ["node tools/live/stress/lib/stats.mjs --selftest", "`selftest ok`", "instant"],
  ["node tools/live/stress/lib/trace-analyse.mjs --selftest", "`selftest ok`", "instant"],
  ["node tools/live/stress/report.mjs --selftest", "`selftest ok`", "instant"],
];

const STEP_KEYS = ["clickByBand", "downByBand", "press", "release", "hover", "presses", "fast", "tail", "keys", "typing"];
const outDir = (o = {}) => (o.outDir ? resolve(o.outDir) : process.env.STRESS_OUT || join(homedir(), "wo", "pxd-fast"));
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const get = (o, path) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const r1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
const f = (x) => (x == null ? "-" : String(r1(x)));
const med = (list) => median(list.filter((x) => num(x) != null));
const medOf = (lines, path) => med(lines.map((l) => get(l, path)));
const sumVals = (o) => Object.values(o || {}).reduce((s, x) => s + (num(x) || 0), 0);
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map((c) => esc(c)).join(" | ")} |`)].join("\n");
const rng = (list) => { const s = summarize(list); return s.n ? `${f(s.p50)} (${f(s.min)}..${f(s.max)})` : "-"; };

function readJsonl(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const l of readFileSync(file, "utf8").split("\n")) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* torn line */ } }
  return out;
}
const key = (l) => `${l.group}/${l.scenario}`;
// newest line per scenario by `at` (a re-analysed copy appended later replaces the original)
function newestPerScenario(lines) {
  const m = new Map();
  for (const l of lines) { const p = m.get(key(l)); if (!p || String(l.at || "") >= String(p.at || "")) m.set(key(l), l); }
  return [...m.values()];
}
function byScenario(lines) {
  const m = new Map();
  for (const l of lines) { if (!m.has(key(l))) m.set(key(l), []); m.get(key(l)).push(l); }
  return m;
}
const ok = (l) => !l.err && !l.skip && l.stalls;

// blob urls carry no name; match each url's script ms to the line's owner totals to say plexus / roam / other
function ownersOfLine(l) {
  const per = new Map();
  for (const st of l.stalls?.list || []) for (const sc of st.scripts || []) per.set(sc.u, (per.get(sc.u) || 0) + (sc.d - (sc.f || 0)));
  const map = {};
  const used = new Set();
  const want = [["plexus", l.owner?.plexus], ["roam", l.owner?.roam], ...Object.entries(l.owner?.other || {})];
  for (const [u] of [...per].sort((p, q) => q[1] - p[1])) {
    if (u && !u.startsWith("blob:")) { map[u] = u.includes("roamresearch.com") ? "roam" : u.replace(/^https?:\/\//, "").split("/")[0] || "(unknown)"; continue; }
    const ms = per.get(u);
    const hit = want.find(([n, v]) => !used.has(n) && num(v) != null && Math.abs(v - ms) <= 1.5);
    if (hit) { used.add(hit[0]); map[u] = hit[0]; } else map[u] = "ext:" + String(u || "").slice(-6);
  }
  return map;
}

// an unnamed extension gets a new blob url on every reload: name it by what it ran instead
const posOf = (sc) => (sc.pos == null ? "" : ` @${Math.round(sc.pos / 1000)}k`);
function ownerLabel(own, sc) {
  if (!own.startsWith("ext:")) return own;
  return `ext (${sc.fn || "(anon)"}, ${(sc.inv || sc.it || "").replace(/blob:\S+/, "blob")}${posOf(sc)})`.replace(/\s+/g, " ");
}

// largest script of a stall, as a group key
function stallKey(st, owners) {
  const sc = (st.scripts || []).slice().sort((p, q) => q.d - p.d)[0];
  if (!sc) return { k: "(no script: style, layout, paint or unattributed)", owner: "-" };
  const own = ownerLabel(owners[sc.u] || "(unknown)", sc);
  if (own.startsWith("ext (")) return { k: own, owner: own };
  return { k: `${own} ${sc.fn || "(anon)"} ${sc.inv || sc.it || ""}${posOf(sc)}`.replace(/\s+/g, " ").trim(), owner: own };
}

// evidence: first token of an entry is a path under OUT_DIR (one * per segment); "report ..." entries are not paths
function resolveGlob(dir, path) {
  let cur = [dir];
  for (const seg of path.split("/").filter(Boolean)) {
    const next = [];
    for (const d of cur) {
      if (!seg.includes("*")) { const q = join(d, seg); if (existsSync(q)) next.push(q); continue; }
      const re = new RegExp("^" + seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      let names = [];
      try { names = readdirSync(d); } catch { /* not a directory */ }
      for (const n of names) if (re.test(n)) next.push(join(d, n));
    }
    cur = next;
  }
  return cur.filter((q) => { try { return statSync(q).isFile(); } catch { return false; } });
}
export function checkEvidence(findings, dir) {
  const seen = new Map();
  for (const x of findings) for (const e of [].concat(x.evidence || [])) {
    const tok = String(e).trim().split(/\s+/)[0].replace(/[,;:]+$/, "");
    if (!tok || /^report/i.test(tok) || !/[./]/.test(tok)) { seen.set("(report section)", null); continue; }
    if (!seen.has(tok)) seen.set(tok, resolveGlob(dir, tok).length);
  }
  return seen;
}

function flatNums(obj, prefix = "", out = {}) {
  if (obj == null) return out;
  if (num(obj) != null) { out[prefix] = obj; return out; }
  if (typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) flatNums(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

function stepTables(lines) {
  const out = [];
  for (const [sc, ls] of byScenario(lines)) {
    for (const k of STEP_KEYS) {
      const have = ls.filter((l) => l.extra && l.extra[k] != null);
      if (!have.length) continue;
      const acc = {};
      for (const l of have) for (const [p, v] of Object.entries(flatNums(l.extra[k]))) (acc[p] = acc[p] || []).push(v);
      const rows = {}, cols = [];
      for (const [p, vals] of Object.entries(acc)) {
        const parts = p.split("."), col = parts.length > 1 ? parts.pop() : "value", row = parts.join(".") || "(all)";
        if (!cols.includes(col)) cols.push(col);
        (rows[row] = rows[row] || {})[col] = med(vals);
      }
      if (!Object.keys(rows).length) continue;
      out.push(`### ${sc}: ${k}\n\n${table(["row", ...cols], Object.entries(rows).map(([r, v]) => [r, ...cols.map((c) => f(v[c]))]))}`);
    }
  }
  return out;
}

export function ratioWord(bench, rec) {
  if (bench == null || rec == null || rec <= 0) return "-";
  const q = bench / rec;
  return q >= 0.6 && q <= 1.6 ? "yes" : q >= 0.4 && q <= 2.5 ? "partly" : "no";
}

function recSection(rec, timed) {
  const rp = rec.reproduce || {};
  const rows = [];
  const replay = timed.filter((l) => l.scenario === "replay-nav" && ok(l));
  const zb = timed.filter((l) => l.scenario === "zoom-btn" && ok(l));
  const pb = {};
  for (const l of replay) for (const [k2, v] of Object.entries(l.extra?.presses || {})) (pb[k2] = pb[k2] || []).push(v);
  const replayVal = (event, target) => { const vs = pb[`${event}|${target}`] || []; return { p50: med(vs.map((v) => v.p50)), p90: med(vs.map((v) => v.p90)) }; };
  const bandVal = (key, band) => {
    const vs = zb.map((l) => l.extra?.[key]?.[band]).filter(Boolean);
    return vs.length ? { p50: med(vs.map((v) => v.p50)), p90: med(vs.map((v) => v.p90)) } : null;
  };
  const prow = (r) => {
    if (r.n < 3 || r.band === "all" && r.target === "pxd-btn") return null;
    let b = null, src = "replay";
    if (r.target === "pxd-btn" && r.band !== "all") {
      const zk = r.event === "pointerdown" ? "downByBand" : r.event === "click" || r.event === "pointerup" ? "clickByBand" : null;
      if (zk) b = bandVal(zk, r.band);
      if (b) src = "zoom-btn band"; else return null;
    } else if (r.band === "all") b = replayVal(r.event, r.target);
    else return null;
    return [`${r.event} ${r.target} (${r.band})`, r.n, f(r.p50), f(r.p90), f(b.p50), f(b.p90), src, ratioWord(b.p50, r.p50)];
  };
  const prs = Array.isArray(rec.presses) ? rec.presses : Object.entries(rp.presses || {}).map(([k2, v]) => { const [event, target, band] = k2.split("|"); return { event, target, band, ...v }; });
  for (const r of prs) { const x = prow(r); if (x) rows.push(x); }
  const allRow = (event) => prs.find((r) => r.event === event && r.target === "pxd-btn" && r.band === "all");
  for (const dir of ["out", "in"]) {
    for (const [event, key] of [["click", "click"], ["pointerdown", "down"]]) {
      const bv = med(zb.map((l) => l.extra?.fast?.[dir]?.[key]?.p50));
      if (bv == null) continue;
      const r = allRow(event);
      rows.push([`zoom button ${event}, ${dir}, recorded cadence (all bands)`, r ? r.n : "-", r ? f(r.p50) : "-", r ? f(r.p90) : "-", f(bv), f(med(zb.map((l) => l.extra?.fast?.[dir]?.[key]?.p90))), `zoom-btn fast.${dir}`, r ? ratioWord(bv, r.p50) : "-"]);
    }
  }
  let s = rows.length ? table(["press (recording)", "n", "rec p50", "rec p90", "bench p50", "bench p90", "bench source", "reproduced"], rows) : "(the recording has no press rows)";

  const tails = timed.map((l) => l.extra?.tail).filter(Boolean);
  const bt = tails.map((t) => flatNums(t)).sort((p, q) => (q.ms ?? q.total ?? 0) - (p.ms ?? p.total ?? 0))[0];
  if (rp.tail || bt) s += `\n\n${table(["tail after a gesture", "n", "ms", "worst"], [["recording", rp.tail?.n ?? "-", f(rp.tail?.ms), f(rp.tail?.worst)], ["bench (largest)", bt ? f(bt.n) : "-", bt ? f(bt.ms ?? bt.total) : "-", bt ? f(bt.worst) : "-"]])}`;

  // hover: the bench counts moments of 16 ms or more, the recorder 40 ms or more, so only the counts at 40 ms compare
  const hv = timed.filter((l) => l.scenario === "hover-sweep" && ok(l));
  const hrows = (rec.hover?.rows || []).filter((r) => r.where === "board").map((r) => {
    const name = r.band === "close" ? "reading" : r.band;
    const bs = hv.map((l) => l.extra?.hover?.[name]).filter(Boolean);
    return [r.band, r.n, f(med(bs.map((x) => x.over40))), f(med(bs.map((x) => x.over100))), f(med(bs.map((x) => x.p90))), name === r.band ? "" : "(reading used)"];
  });
  if (hrows.length) s += `\n\nHover: the recorder counts hover moments of 40 ms or more, the bench 16 ms or more, so only the counts at 40 ms compare (p50 does not).\n\n${table(["band", "recording: moments >= 40 ms in 150 s of use", "bench: over40 of 588 moves", "bench over100", "bench p90 (ms)", "note"], hrows)}`;

  if (rec.stalls) {
    const rn = (p) => f(medOf(replay, p));
    s += `\n\nSession totals:\n\n${table(["", "stalls n", "stalls total ms", "worst ms"], [["recording (150 s of use)", rec.stalls.n, f(rec.stalls.ms), f(rec.stalls.worst)], ["replay-nav (median over runs)", rn("stalls.n"), rn("stalls.total"), rn("stalls.worst")]])}\n\nThe two freezes of 3.3-3.6 s in the recording are edit tails. replay-nav leaves them out on purpose.`;
  }
  return s;
}

function loadBudgets() {
  try { return JSON.parse(readFileSync(BUDGETS_FILE, "utf8")); } catch { return { targets: {}, scenarios: {} }; }
}

export function buildReport(opts = {}) {
  const label = opts.label || "base";
  const dir = outDir(opts);
  const all = opts.lines || readJsonl(join(dir, "results.jsonl"));
  const mine = all.filter((l) => l.label === label);
  const timed = mine.filter((l) => !l.traced);
  const traced = mine.filter((l) => l.traced === true && l.trace);
  const good = timed.filter(ok);
  const noise = opts.noise || readJsonl(join(dir, "noise.jsonl"));
  const budgets = opts.budgets || loadBudgets();
  let rec = opts.recData || null;
  if (!rec && opts.rec) { const p = isAbsolute(opts.rec) ? opts.rec : join(dir, opts.rec); try { rec = JSON.parse(readFileSync(p, "utf8")); } catch (e) { rec = { error: e.message }; } }
  let findings = opts.findingsData || null;
  if (!findings && opts.findings) { const p = isAbsolute(opts.findings) ? opts.findings : join(dir, opts.findings); findings = readJsonl(p); }

  const first = mine[0] || {};
  const runs = [...new Set(mine.map((l) => l.run))];
  const win = first.window || {};
  const out = [];

  // 1
  out.push(`# ${opts.title || `Stress board round: ${label}`}`);
  out.push(`${(first.at || new Date().toISOString()).slice(0, 10)}. Plexus ${first.version || "?"}. Window ${win.inner ? win.inner.join("x") : "?"}, dpr ${win.dpr ? r1(win.dpr) : "?"}, ${win.hz || "?"} Hz. ${mine.length} result lines (${timed.length} timed, ${traced.length} traced). Build sha ${[...new Set(mine.map((l) => l.build && l.build.sha).filter(Boolean))].join(", ") || "none (installed build)"}. ${runs.length} distinct run ids for label ${label}: ${runs.join(", ") || "none"}.`);

  // 2
  out.push(`## Quick check\n\n${table(["Command", "Should print", "Takes"], QUICK_CHECKS.map((r) => r.map((c, i) => (i === 0 ? `\`${c}\`` : c))))}`);

  // 3
  const groups = [...new Set(timed.map((l) => l.group))];
  const base = [];
  for (const g of groups) {
    const rows = [];
    const notes = [];
    for (const [sc, ls] of byScenario(timed.filter((l) => l.group === g))) {
      for (const l of ls) { if (l.err) notes.push(`- ${sc}: error: ${l.err}`); else if (l.skip) notes.push(`- ${sc}: skipped: ${l.skip}`); }
      const gl = ls.filter(ok);
      const nIn = ls.filter((l) => l.ctx?.fullscreen === false).length;
      if (nIn && ls.some((l) => l.ctx?.fullscreen === true)) notes.push(`- ${sc}: ${nIn} runs inline`);
      const nSkip = ls.filter((l) => l.skip).length, nFail = ls.filter((l) => !l.skip && (l.err || l.extra?.ok === false)).length;
      const nOk = ls.filter((l) => !l.skip && !l.err && l.extra?.ok !== false).length;
      const okCol = `${nOk} / ${nSkip} / ${nFail}`;
      if (!gl.length) { rows.push([sc.split("/")[1], 0, okCol, "-", "-", "-", "-", "-"]); continue; }
      const oth = gl.map((l) => sumVals(l.owner?.other));
      rows.push([
        sc.split("/")[1], gl.length, okCol, rng(gl.map((l) => l.ttnp)),
        `${f(medOf(gl, "stalls.n"))} / ${f(medOf(gl, "stalls.total"))} / ${f(medOf(gl, "stalls.worst"))}`,
        `${f(medOf(gl, "frames.p95"))} / ${f(medOf(gl, "frames.max"))}`,
        `${f(medOf(gl, "content.readable.p95"))} / ${f(medOf(gl, "content.live.p95"))}`,
        `${f(medOf(gl, "owner.plexus"))} / ${f(medOf(gl, "owner.roam"))} / ${f(med(oth))} / ${f(medOf(gl, "owner.render"))} / ${f(medOf(gl, "owner.unattributed"))}`,
      ]);
    }
    base.push(`### ${g}\n\n${table(["scenario", "runs", "ok / skipped / failed", "time to next paint p50 (min..max) ms", "stalls per run (n / ms / worst)", "frames p95 / max (ms)", "cards readable p95 / live p95 (ms)", "ms inside stalls: Plexus / Roam / other / style+layout / unattributed"], rows)}${notes.length ? `\n\n${notes.join("\n")}` : ""}`);
  }
  out.push(`## Baseline\n\n${base.join("\n\n") || "(no timed lines for this label)"}`);

  // 4
  const steps = stepTables(good);
  out.push(`## Steps\n\n${steps.join("\n\n") || "(no scenario has step tables yet)"}`);

  // 5
  const trows = newestPerScenario(traced).map((l) => {
    const t = l.trace;
    const script = (t.script?.plexus || 0) + (t.script?.roam || 0) + sumVals(t.script?.other) + (t.script?.unknown || 0);
    const busy = script + (t.style || 0) + (t.layout || 0) + (t.paint || 0) + (t.gc || 0) + (t.other || 0);
    const sh = (x) => (busy > 0 ? f((100 * (x || 0)) / busy) : "-");
    return [key(l), f(t.script?.plexus), f(t.script?.roam), f(sumVals(t.script?.other)), f(t.style), f(t.layout), f(t.paint), f(t.gc), f(t.other), f(t.restyled), f(t.forcedMs), t.hitTest != null ? f(t.hitTest) : "-", t.profile?.sampledMs != null ? f(t.profile.sampledMs) : "-", sh(script), sh(t.style), sh(t.layout), sh(t.paint), sh(t.gc), t.file ? basename(t.file) : "-"];
  });
  out.push(`## Where the time goes (traces)\n\nNewest traced line per scenario. Shares are of the busy time (script + style + layout + paint + gc + other).\n\n${trows.length ? table(["scenario", "script Plexus", "script Roam", "script other", "style", "layout", "paint", "gc", "other", "elements restyled", "forced style+layout ms", "hit test ms", "profile ms", "script %", "style %", "layout %", "paint %", "gc %", "trace file"], trows) : "(no traced lines)"}`);

  // 5b
  const devLabel = opts.devLabel || "dev";
  const dev = newestPerScenario(all.filter((l) => l.label === devLabel && l.traced === true && l.trace));
  const hot = dev.map((l) => {
    const fx = l.trace.functions || {};
    const keep = (r) => !(/^\(anonymous\)$/.test(r.fn || "") && (r.ms ?? r.selfMs ?? 0) < 5);
    const pl = (fx.plexus || []).filter(keep).slice(0, 12).map((r) => [r.fn, f(r.ms), f(r.selfMs)]);
    const sf = (fx.self || []).filter(keep).slice(0, 8).map((r) => [r.owner, r.fn, f(r.ms)]);
    if (!pl.length && !sf.length) return null;
    return `### ${key(l)}\n\n${pl.length ? table(["function", "inclusive ms", "self ms"], pl) : "(no Plexus functions)"}\n\n${sf.length ? table(["owner", "function", "self ms"], sf) : "(no self-time rows)"}`;
  }).filter(Boolean);
  out.push(`## Hot functions (unminified build)\n\nSampled CPU time under tracing; use it to see which functions carry a scenario, not as timings.\n\n${hot.length ? hot.join("\n\n") : "(no traces from the unminified build)"}`);

  // 6
  const src = new Map();
  const roamOther = new Map();
  for (const l of good) {
    const owners = ownersOfLine(l);
    const bySc = key(l);
    for (const st of l.stalls.list || []) {
      const { k, owner } = stallKey(st, owners);
      const e = src.get(k) || { n: 0, ms: 0, worst: 0, sc: new Map() };
      e.n++; e.ms += st.d; e.worst = Math.max(e.worst, st.d); e.sc.set(bySc, (e.sc.get(bySc) || 0) + st.d);
      src.set(k, e);
      for (const sc of st.scripts || []) {
        const o = ownerLabel(owners[sc.u] || "(unknown)", sc);
        if (o === "plexus") continue;
        const r = roamOther.get(o) || { ms: 0, n: 0, sc: new Map() };
        const d = sc.d - (sc.f || 0);
        r.ms += d; r.n++; r.sc.set(bySc, (r.sc.get(bySc) || 0) + d); roamOther.set(o, r);
      }
    }
  }
  const srcRows = [...src].sort((p, q) => q[1].ms - p[1].ms).slice(0, 25).map(([k, e]) => [k, e.n, f(e.ms), f(e.worst), [...e.sc].sort((p, q) => q[1] - p[1]).slice(0, 5).map(([n]) => n).join(", ")]);
  out.push(`## Stall sources\n\nEach stall is grouped by its biggest script. Position is the character offset in the bundle, in thousands.\n\n${srcRows.length ? table(["source (owner, function, invoker, position)", "n", "total ms", "worst ms", "scenarios (top 5)"], srcRows) : "(no stalls)"}`);

  // 7
  out.push(`## Bench against the recording\n\n${rec ? (rec.error ? `(could not read the recording analysis: ${rec.error})` : recSection(rec, timed)) : "(--rec not given)"}`);

  // 8
  const frows = (findings || []).slice().sort((p, q) => (p.rank ?? 99) - (q.rank ?? 99)).slice(0, 10).map((x) => [x.rank, x.title, x.cost, x.owner, [].concat(x.evidence || []).join("; "), x.fix, [].concat(x.code || []).join(", ")]);
  let evBlock = "";
  if (findings && frows.length) {
    const ev = checkEvidence(findings.slice(0, 10), dir);
    const missing = [...ev].filter(([, n]) => n === 0).map(([k]) => k);
    evBlock = `\n\nEvidence files:\n\n${[...ev].map(([k, n]) => (n == null ? `- (report section)` : n > 0 ? `- ${k}: ok (${n} file${n === 1 ? "" : "s"})` : `- ${k}: MISSING`)).join("\n")}`;
    if (missing.length) console.error(`WARNING missing evidence: ${missing.join(", ")}`);
  }
  out.push(`## Ranked top 10\n\n${findings ? (frows.length ? table(["#", "What", "Cost", "Owner", "Evidence", "Suggested fix", "Code"], frows) + evBlock : "(findings file is empty)") : "(findings file not given)"}`);

  // 9
  const orows = [...roamOther].sort((p, q) => q[1].ms - p[1].ms).map(([o, r]) => [o, f(r.ms), r.n, [...r.sc].sort((p, q) => q[1] - p[1]).slice(0, 3).map(([n, v]) => `${n} (${f(v)})`).join(", ")]);
  out.push(`## Roam and other extensions\n\nMilliseconds inside stalls for every owner except Plexus, summed over all timed lines.\n\n${orows.length ? table(["owner", "ms inside stalls", "stalls", "top 3 scenarios (ms)"], orows) : "(none)"}`);

  // 10
  const nl = new Map();
  for (const x of noise) nl.set(`${x.scenario}|${x.metric}`, x);
  out.push(`## Noise floor\n\n${nl.size ? table(["scenario", "metric", "floor", "delta", "spread", "n", "label", "when"], [...nl.values()].map((x) => [x.scenario, x.metric, f(x.floor), f(x.delta), f(x.spread), x.n, x.label, String(x.at || "").slice(0, 16)])) : "(no A/A run yet: run ab.mjs --aa)"}`);

  // 11
  const trows2 = Object.entries(budgets.targets || {}).map(([k, v]) => [k, v]);
  const brows = [];
  for (const [sc, ms] of Object.entries(budgets.scenarios || {})) {
    const ls = good.filter((l) => key(l) === sc);
    for (const [m, spec] of Object.entries(ms)) {
      const b = medOf(ls, m);
      brows.push([sc, m, spec.max, f(b), b != null && b > spec.max ? "over" : ""]);
    }
  }
  out.push(`## Budgets\n\nGoals from the plan:\n\n${trows2.length ? table(["target", "value"], trows2) : "(none)"}\n\nPer-scenario limits (baseline = median of the timed runs):\n\n${brows.length ? table(["scenario", "metric", "max", "baseline", "over"], brows) : "(not written yet: run report.mjs --label base --write-budgets)"}`);

  // 12
  let notes = opts.notesData || null;
  if (!notes && opts.notes) { const p = isAbsolute(opts.notes) ? opts.notes : join(dir, opts.notes); if (existsSync(p)) notes = readJsonl(p); }
  if (notes && notes.length) out.push(`## Notes and limits\n\n${notes.map((n) => `**${String(n.title).replace(/\.$/, "")}.** ${n.text}`).join("\n\n")}`);

  return out.join("\n\n") + "\n";
}

// budgets only tighten: a lower existing number is kept
export function writeBudgets(opts = {}) {
  const label = opts.label || "base";
  const all = opts.lines || readJsonl(join(outDir(opts), "results.jsonl"));
  const good = all.filter((l) => l.label === label && !l.traced && ok(l));
  const b = loadBudgets();
  b.scenarios = b.scenarios || {};
  const up10 = (x) => Math.ceil(x / 10) * 10;
  let changed = 0;
  for (const [sc, ls] of byScenario(good)) {
    for (const m of ["ttnp", "stalls.total", "stalls.worst"]) {
      const v = medOf(ls, m);
      if (v == null) continue;
      const mx = up10(v);
      const cur = b.scenarios[sc]?.[m]?.max;
      if (cur != null && cur <= mx) continue;
      (b.scenarios[sc] = b.scenarios[sc] || {})[m] = { max: mx };
      changed++;
    }
  }
  const file = opts.budgetsFile || BUDGETS_FILE;
  writeFileSync(file, JSON.stringify(b, null, 2) + "\n");
  return { file, changed };
}

function selftest() {
  const mk = (scenario, group, i, extra = {}) => ({
    run: "r1", at: "2026-11-09T10:00:00Z", label: "base", build: { dir: "installed", sha: null }, version: "3.39.1", group, scenario, i, n: 4, traced: false, window: { inner: [1095, 701], dpr: 2, hz: 60 },
    stalls: { n: 2, total: 100 + i * 10, worst: 60 + i, list: [{ st: 1, d: 60 + i, sl: 2, scripts: [{ d: 50, f: 0, u: "blob:x/abcdef", fn: "Bt", inv: "IdleRequestCallback", it: "user-callback", pos: 350891 }] }, { st: 2, d: 40, sl: 0, scripts: [{ d: 30, f: 0, u: "https://roamresearch.com/m.js", fn: "q", inv: "x", pos: 1 }] }, { st: 3, d: 9, sl: 0, scripts: [{ d: 7, f: 0, u: "blob:y/zzzzzz", fn: "Q", inv: "MessagePort.onmessage", pos: 31200 }] }] },
    long: { n: 1, total: 100, worst: 100 }, frames: { p95: 30, max: 60 }, content: { readable: { p95: 10 }, live: { p95: 20 } },
    owner: { plexus: 50, roam: 30, other: { foo: 5 }, render: 2, unattributed: 8 }, ttnp: 40 + i, extra,
  });
  const lines = [
    mk("zoom-btn", "move", 1, { clickByBand: { reading: { n: 4, p50: 40, p90: 60, max: 70 } }, fast: { out: { click: { p50: 40, p90: 50 } } } }),
    mk("zoom-btn", "move", 2),
    mk("replay-nav", "move", 1, { presses: { "click|pxd-btn": { p50: 50, p90: 80 } } }),
    { ...mk("reload", "open", 1), traced: true, trace: { file: "/x/traces/r1-open-reload-1.json.gz", script: { plexus: 10, roam: 20, other: { a: 1 } }, style: 1, layout: 2, paint: 3, gc: 4, other: 5, restyled: 600, forcedMs: 7 } },
    { ...mk("reload", "open", 1), skip: "nope", stalls: undefined },
    { ...mk("reload", "open", 1), at: "2026-11-09T12:00:00Z", traced: true, reanalysed: true, trace: { file: "/x/traces/r2-open-reload-1.json.gz", script: { plexus: 40, roam: 20, other: {} }, style: 10, layout: 10, paint: 10, gc: 10, other: 0, restyled: 5, forcedMs: 1, hitTest: 2, profile: { sampledMs: 99 } } },
    { ...mk("zoom-btn", "move", 3), ctx: { fullscreen: true } },
    { ...mk("zoom-btn", "move", 4), ctx: { fullscreen: false } },
    { ...mk("zoom-btn", "move", 1), label: "dev", traced: true, trace: { file: "/x/d.json.gz", script: { plexus: 1 }, functions: { plexus: [{ fn: "hotFn", ms: 30, selfMs: 12 }, { fn: "(anonymous)", ms: 2, selfMs: 1 }], self: [{ owner: "plexus", fn: "selfFn", ms: 9 }] } } },
  ];
  const tmp = mkdtempSync(join(tmpdir(), "report-selftest-"));
  writeFileSync(join(tmp, "results.jsonl"), "");
  const md = buildReport({
    outDir: tmp, label: "base", lines, noise: [{ scenario: "move/zoom-btn", metric: "ttnp", floor: 3, delta: 2, spread: 1, n: 5, label: "aa1", at: "2026-11-09T10:00:00Z" }],
    budgets: { targets: { "any gesture stall (ms)": 50 }, scenarios: { "move/zoom-btn": { ttnp: { max: 10 } } } },
    recData: { presses: [{ event: "click", target: "pxd-btn", band: "reading", n: 20, p50: 48, p90: 90 }], stalls: { n: 5, ms: 500, worst: 100 }, hover: { rows: [{ band: "small", where: "board", n: 5, p50: 48, p90: 60 }] }, reproduce: { tail: { n: 3, ms: 150, worst: 60 } } },
    findingsData: [{ rank: 1, title: "t", cost: "c", owner: "plexus", evidence: ["results.jsonl label base: x", "nope/missing-*.json", "report section Stall sources: y"], fix: "f", code: ["src/a.js"] }],
    notesData: [{ title: "Limit one.", text: "plain words" }],
  });
  assert.ok(md.includes("## Notes and limits") && md.includes("**Limit one.** plain words"), "notes");
  assert.ok(md.includes("ok / skipped / failed") && md.includes("| 0 / 1 / 0 |") && md.includes("| 4 / 0 / 0 |"), "ok column");
  assert.ok(md.includes("results.jsonl: ok (1 file)") && md.includes("nope/missing-*.json: MISSING") && md.includes("- (report section)"), "evidence");
  assert.ok(md.includes("zoom-btn band"), "bench source");
  assert.ok(md.includes("r2-open-reload-1.json.gz") && !md.includes("r1-open-reload-1.json.gz"), "newest traced line wins");
  assert.ok(md.includes("| 99 |") && md.includes("| 60 |"), "profile ms and script share");
  assert.ok(md.includes("## Hot functions (unminified build)") && md.includes("hotFn") && md.includes("selfFn") && !md.includes("(anonymous) |"), "hot functions");
  assert.ok(md.includes("move/zoom-btn: 1 runs inline"), "inline note");
  assert.ok(md.includes("ext (Q, MessagePort.onmessage @31k)") && !md.includes("ext:abcdef"), "ext grouped");
  assert.ok(md.includes("(not written yet") === false);
  for (const h of ["# ", "## Quick check", "## Baseline", "## Steps", "## Where the time goes (traces)", "## Stall sources", "## Bench against the recording", "## Ranked top 10", "## Roam and other extensions", "## Noise floor", "## Budgets"]) assert.ok(md.includes(h), `missing ${h}`);
  assert.ok(md.indexOf("## Quick check") < md.indexOf("## Baseline") && md.indexOf("## Noise floor") < md.indexOf("## Budgets"), "order");
  assert.ok(md.includes("| over |") || /\| over \|/.test(md), "budget over");
  assert.ok(md.includes("plexus Bt IdleRequestCallback @351k"), "stall source row");
  assert.ok(md.includes("skipped: nope"), "skip note");
  assert.equal(ratioWord(50, 48), "yes");
  assert.equal(ratioWord(100, 48), "partly");
  assert.equal(ratioWord(300, 48), "no");
  console.log("selftest ok");
}

function parse(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--selftest" || t === "--write-budgets") { o[t.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = true; continue; }
    if (!t.startsWith("--")) throw new Error(`unexpected argument ${t}`);
    const k = t.slice(2);
    if (!["label", "out", "rec", "findings", "title", "notes", "dev-label"].includes(k)) throw new Error(`unknown flag --${k}`);
    if (argv[i + 1] == null) throw new Error(`--${k} needs a value`);
    o[k.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return o;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = parse(process.argv.slice(2));
    if (o.selftest) selftest();
    else {
      if (o.writeBudgets) { const w = writeBudgets(o); console.log(`${w.file}: ${w.changed} limits written or tightened`); }
      const md = buildReport(o);
      const file = resolve(o.out || join(outDir(o), `report-${o.label || "base"}.md`));
      writeFileSync(file, md);
      console.log(file);
    }
  } catch (e) { console.error(e.message); process.exit(2); }
}
