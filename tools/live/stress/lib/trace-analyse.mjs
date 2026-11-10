// Split a Chrome trace of the renderer main thread into script / style / layout / paint / gc / other / idle.
//   node trace-analyse.mjs <file.json|file.json.gz> [--json]
//   node trace-analyse.mjs --selftest
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";
import { ownerOf } from "./names.mjs";

const SCRIPT = new Set(["FunctionCall", "EvaluateScript", "v8.run", "v8.callFunction", "V8.Execute", "TimerFire", "FireAnimationFrame", "EventDispatch", "RunMicrotasks", "FireIdleCallback", "XHRReadyStateChange", "XHRLoad", "v8.compile", "V8.CompileCode", "v8.parseOnBackground", "v8.produceCache"]);
const SCRIPT_PREFIX = ["MutationObserver", "IntersectionObserver", "ResizeObserver"];
const STYLE = new Set(["UpdateLayoutTree", "RecalculateStyles", "ParseAuthorStyleSheet"]);
const PAINT = new Set(["Paint", "PrePaint", "Layerize", "UpdateLayer", "UpdateLayerTree", "CompositeLayers", "Commit", "PaintImage", "Decode Image", "ImageDecodeTask", "HitTest"]);
const GC = /^(MinorGC|MajorGC|V8\.GC|BlinkGC|CppGC)/;
const isTask = (n) => n === "RunTask" || n === "ThreadControllerImpl::RunTask";

function category(name) {
  if (SCRIPT.has(name) || SCRIPT_PREFIX.some((p) => name.startsWith(p))) return "script";
  if (STYLE.has(name) || name.startsWith("InvalidateStyle")) return "style";
  if (name === "Layout" || (name.startsWith("UpdateLayout") && name !== "UpdateLayoutTree")) return "layout";
  if (PAINT.has(name)) return "paint";
  if (GC.test(name)) return "gc";
  return null;
}

async function loadEvents(file) {
  let buf = await readFile(file);
  if (file.endsWith(".gz") || (buf[0] === 0x1f && buf[1] === 0x8b)) buf = gunzipSync(buf);
  const d = JSON.parse(buf.toString("utf8"));
  buf = null;
  return Array.isArray(d) ? d : d.traceEvents || [];
}

const r3 = (x) => Math.round(x * 1000) / 1000;

export async function analyseTrace(file, { names = {}, from, to, plexusUrl } = {}) {
  let events = await loadEvents(file);

  // pass 1: find the main thread, collect profile events and selector stats
  const threadName = new Map(), runTask = new Map(), marks = [], profiles = [], selAgg = new Map(), scriptUrls = new Map();
  for (const e of events) {
    const k = e.pid + ":" + e.tid;
    if (e.ph === "M") { if (e.name === "thread_name") threadName.set(k, e.args && e.args.name); continue; }
    if (isTask(e.name) && e.ph === "X") runTask.set(k, (runTask.get(k) || 0) + (e.dur || 0));
    if (e.name === "pxd-stress-trace") marks.push(e);
    if (e.name === "Profile" || e.name === "ProfileChunk") profiles.push(e);
    const ad = e.args && e.args.data;
    if (ad && ad.scriptId != null) { const u = ad.url || ad.scriptName; if (u && typeof u === "string") scriptUrls.set(e.pid + ":" + ad.scriptId, u); }
    const st = e.args && e.args.selector_stats && e.args.selector_stats.selector_timings;
    if (st) for (const s of st) {
      const a = selAgg.get(s.selector) || { us: 0, att: 0, mc: 0 };
      a.us += s["elapsed (us)"] || 0; a.att += s.match_attempts || 0; a.mc += s.match_count || 0;
      selAgg.set(s.selector, a);
    }
  }
  let main = null;
  if (marks.length) {
    const pid = marks[marks.length - 1].pid;
    for (const [k, n] of threadName) if (n === "CrRendererMain" && k.startsWith(pid + ":")) { main = k; break; }
    if (!main) main = pid + ":" + marks[marks.length - 1].tid;
  }
  if (!main) {
    let best = -1;
    for (const [k, n] of threadName) if (n === "CrRendererMain" && (runTask.get(k) || 0) > best) { best = runTask.get(k) || 0; main = k; }
    if (!main) for (const [k, v] of runTask) if (v > best) { best = v; main = k; }
  }
  if (!main) throw new Error("no renderer main thread found in " + file);
  const [mpid, mtid] = main.split(":").map(Number);

  // pass 2: that thread's events, compact
  let t0 = Infinity, tEnd = -Infinity;
  const ev = [];
  for (const e of events) {
    if (e.pid !== mpid || e.tid !== mtid || e.ph === "M") continue;
    if (e.ts < t0) t0 = e.ts;
    const end = e.ts + (e.ph === "X" ? e.dur || 0 : 0);
    if (end > tEnd) tEnd = end;
    if (e.ph === "X" && e.dur != null) ev.push(e);
  }
  events = null;

  const S = from != null ? t0 + from * 1000 : t0;
  const E = to != null ? t0 + to * 1000 : tEnd;
  const clipped = [];
  for (const e of ev) {
    const s = Math.max(e.ts, S), f = Math.min(e.ts + e.dur, E);
    if (f > s) clipped.push({ s, f, e });
  }
  clipped.sort((a, b) => a.s - b.s || (b.f - b.s) - (a.f - a.s) || (isTask(b.e.name) ? 1 : 0) - (isTask(a.e.name) ? 1 : 0));

  const urlOf = (e) => { const d = e.args && e.args.data; return (d && (d.url || d.scriptName || d.fileName)) || ""; };
  const sums = { script: 0, style: 0, layout: 0, paint: 0, gc: 0, other: 0 };
  let hitTest = 0, forced = 0, restyled = 0, recalcs = 0, layouts = 0, taskTotal = 0;
  const fallbackOwner = new Map(); // owner -> ms (only used without profile samples)
  const tasks = [];
  const stack = [];
  let curLabels = null;

  const finalize = (n) => {
    const dur = n.f - n.s;
    const self = Math.max(0, dur - n.child);
    const ms = self / 1000;
    const name = n.e.name;
    let cat = category(name);
    if (isTask(name) && !n.inTask) taskTotal += dur;
    if (!cat && (isTask(name) || n.inTask)) cat = "other";
    if (cat) {
      sums[cat] += ms;
      if (name === "HitTest") hitTest += ms;
      if ((cat === "style" || cat === "layout") && n.underScript) forced += ms;
      if (cat === "script") {
        const o = n.url ? ownerOf(n.url, names) : "(unknown)";
        fallbackOwner.set(o, (fallbackOwner.get(o) || 0) + ms);
      }
    }
    if (self > 0 && n.labelsOwner) {
      let label = name;
      if (cat === "script" && n.url) label += ":" + ownerOf(n.url, names);
      const fn = n.e.args && n.e.args.data && n.e.args.data.functionName;
      if (fn) label += ":" + fn;
      n.labelsOwner.set(label, (n.labelsOwner.get(label) || 0) + ms);
    }
  };
  // the stack frame carries a pointer to the label map of its outermost RunTask
  for (const c of clipped) {
    const e = c.e;
    while (stack.length && stack[stack.length - 1].f <= c.s) closeTop();
    const parent = stack[stack.length - 1];
    const f = parent ? Math.min(c.f, parent.f) : c.f;
    if (parent) parent.child += f - c.s;
    const isT = isTask(e.name);
    const inTask = parent ? parent.inTask || parent.isTask : false;
    const node = { s: c.s, f, e, child: 0, isTask: isT, inTask, underScript: parent ? parent.underScript || category(parent.e.name) === "script" : false, url: urlOf(e) || (parent ? parent.url : "") };
    if (e.name === "UpdateLayoutTree") { recalcs++; const ec = e.args && e.args.elementCount; if (typeof ec === "number") restyled += ec; }
    if (e.name === "Layout") layouts++;
    if (isT && !inTask) { node.labelsOwner = new Map(); node.taskRoot = node; }
    else if (parent) { node.labelsOwner = parent.labelsOwner; node.taskRoot = parent.taskRoot; }
    stack.push(node);
  }
  while (stack.length) closeTop();
  function closeTop() {
    const n = stack.pop();
    finalize(n);
    if (n.isTask && !n.inTask) {
      const d = (n.f - n.s) / 1000;
      if (d >= 50) tasks.push({ st: r3((n.s - S) / 1000), d: r3(d), top: [...n.labelsOwner].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, v]) => [l, r3(v)]) });
    }
  }

  const spanMs = (E - S) / 1000;

  // script by owner
  const prof = ownersFromProfile(profiles, mpid, mtid, S, E, names, scriptUrls, plexusUrl);
  const owners = prof && prof.sampledMs > 0 ? prof.owners : null;
  const script = { plexus: 0, roam: 0, other: {}, unknown: 0 };
  const put = (o, ms) => {
    if (o === "plexus") script.plexus += ms;
    else if (o === "roam") script.roam += ms;
    else if (o === "unknown" || o === "(unknown)") script.unknown += ms;
    else script.other[o] = (script.other[o] || 0) + ms;
  };
  const shares = owners || fallbackOwner;
  const shareTotal = [...shares.values()].reduce((a, b) => a + b, 0);
  if (shareTotal > 0) for (const [o, v] of shares) put(o, (v / shareTotal) * sums.script);
  else put("unknown", sums.script);
  for (const k of Object.keys(script.other)) script.other[k] = r3(script.other[k]);

  const split = {
    ms: r3(spanMs),
    script: { plexus: r3(script.plexus), roam: r3(script.roam), other: script.other, unknown: r3(script.unknown) },
    style: r3(sums.style), layout: r3(sums.layout), paint: r3(sums.paint), gc: r3(sums.gc), other: r3(sums.other),
    idle: r3(spanMs - taskTotal / 1000),
    hitTest: r3(hitTest), restyled, recalcs, layouts, forcedMs: r3(forced),
    tasks, scriptMs: r3(sums.script), ownerSource: prof && prof.sampledMs > 0 ? "profile" : "events",
    profile: { samples: prof ? prof.samples : 0, sampledMs: prof ? r3(prof.sampledMs) : 0, mainTidMatched: prof ? prof.mainTidMatched : false },
  };
  // functions: raw sampled ms, not scaled to the event-walk script time
  split.functions = { self: [], plexus: [] };
  if (prof) {
    const fnName = (cf) => cf.functionName || "(anonymous)";
    const u6 = (a) => (a.url || "").slice(-6);
    split.functions.self = [...prof.selfM.values()].sort((a, b) => b.ms - a.ms).slice(0, 25).map((a) => ({ owner: a.owner, fn: fnName(a.cf), line: a.cf.lineNumber, pos: a.cf.columnNumber, scriptId: a.cf.scriptId, url6: u6(a), ms: r3(a.ms) }));
    split.functions.plexus = [...prof.inclM.values()].sort((a, b) => b.ms - a.ms).slice(0, 25).map((a) => ({ fn: fnName(a.cf), line: a.cf.lineNumber, pos: a.cf.columnNumber, scriptId: a.cf.scriptId, url6: u6(a), ms: r3(a.ms), selfMs: r3(a.self) }));
    split.profile.topBlob = prof.topBlob;
    split.profile.plexusUrl = prof.plexusUrl;
  }
  if (selAgg.size) split.selectors = [...selAgg].sort((a, b) => b[1].us - a[1].us).slice(0, 30).map(([selector, a]) => ({ selector, ms: r3(a.us / 1000), attempts: a.att, matches: a.mc }));
  return split;
}

const HEUR = ["sharedBgBudget", "createTaskProbe", "armSettle", "recomputeDerived", "keepModel"];

// Raw sampled ms (never scaled): owner shares, per-function self time, and plexus-inclusive time, from the CPU profile of the main thread
// inside [S, E]. Chunks are linked to their Profile by id and are emitted on other tids, so chunk tids are never used. Returns null without profile data.
function ownersFromProfile(profEvents, mpid, mtid, S, E, names, scriptUrls, plexusUrl) {
  const key = (e) => e.pid + ":" + String(e.id ?? (e.id2 && (e.id2.local ?? e.id2.global)) ?? "0");
  const byId = new Map();
  for (const p of profEvents) {
    const k = key(p);
    let pr = byId.get(k);
    if (!pr) byId.set(k, (pr = { pid: p.pid, tid: null, start: null, chunks: [], samples: 0 }));
    if (p.name === "Profile") { pr.tid = p.tid; pr.start = p.args && p.args.data && p.args.data.startTime != null ? p.args.data.startTime : p.ts; }
    else { pr.chunks.push(p); const cp = p.args && p.args.data && p.args.data.cpuProfile; pr.samples += (cp && cp.samples ? cp.samples.length : 0); }
  }
  const cands = [...byId.values()].filter((x) => x.pid === mpid && x.chunks.length);
  if (!cands.length) return null;
  const exact = cands.filter((x) => x.tid === mtid);
  const pool = exact.length ? exact : cands;
  const pr = pool.sort((a, b) => b.samples - a.samples)[0];
  const mainTidMatched = exact.length > 0;

  pr.chunks.sort((a, b) => a.ts - b.ts);
  const nodes = new Map(), scriptOf = new Map(), smp = [];
  let t = pr.start != null ? pr.start : pr.chunks[0].ts;
  for (const ch of pr.chunks) {
    const d = ch.args && ch.args.data;
    if (!d) continue;
    const cp = d.cpuProfile || {};
    for (const n of cp.nodes || []) {
      const cf = n.callFrame || {};
      nodes.set(n.id, { parent: n.parent, cf });
      if (cf.url && cf.scriptId != null) scriptOf.set(String(cf.scriptId), cf.url);
    }
    for (const n of cp.nodes || []) for (const c of n.children || []) { const cn = nodes.get(c); if (cn && cn.parent == null) cn.parent = n.id; }
    const samples = cp.samples || [], deltas = d.timeDeltas || [];
    for (let i = 0; i < samples.length; i++) {
      t += deltas[i] || 0;
      if (t >= S && t <= E) smp.push([samples[i], (deltas[i] || 0) / 1000]);
    }
  }
  // frames often carry only a scriptId: resolve through the trace-wide map, then the profile's own frames
  for (const n of nodes.values()) {
    const cf = n.cf;
    n.url = cf.url || (cf.scriptId != null && (scriptUrls.get(mpid + ":" + cf.scriptId) || scriptOf.get(String(cf.scriptId)))) || "";
  }
  let nm = names || {};
  let plexusU = plexusUrl || null;
  if (plexusU) nm = { ...nm, [plexusU]: { name: "plexus-diagram" } };
  else if (!Object.keys(nm).length) {
    const per = new Map();
    for (const n of nodes.values()) if (n.url.startsWith("blob:") && HEUR.includes(n.cf.functionName)) { const st = per.get(n.url) || new Set(); st.add(n.cf.functionName); per.set(n.url, st); }
    const hit = [...per].filter(([, st]) => st.size >= 2);
    if (hit.length === 1) { plexusU = hit[0][0]; nm = { [plexusU]: { name: "plexus-diagram" } }; }
  }
  const fkey = (n) => n.url + "|" + (n.cf.functionName || "") + "|" + n.cf.lineNumber + "|" + n.cf.columnNumber + "|" + n.cf.scriptId;
  const out = new Map(), selfM = new Map(), inclM = new Map(), blobMs = new Map();
  let sampledMs = 0, count = 0;
  for (const [id, dt] of smp) {
    const leaf = nodes.get(id);
    if (!leaf) continue;
    if (/^\((idle|program|garbage collector)\)$/.test(leaf.cf.functionName || "")) continue;
    let outer = null, roam = false;
    const seen = new Set();
    for (let n = leaf, g = 0; n && g < 4000; n = n.parent != null ? nodes.get(n.parent) : null, g++) {
      const u = n.url;
      if (u.startsWith("blob:")) outer = u;
      else if (u.includes("roamresearch.com")) roam = true;
      if (u && ownerOf(u, nm) === "plexus") {
        const k = fkey(n);
        if (!seen.has(k)) { seen.add(k); const a = inclM.get(k) || { cf: n.cf, url: u, ms: 0, self: 0 }; a.ms += dt; if (n === leaf) a.self += dt; inclM.set(k, a); }
      }
    }
    const o = outer ? ownerOf(outer, nm) : roam ? "roam" : "unknown";
    if (outer) blobMs.set(outer, (blobMs.get(outer) || 0) + dt);
    out.set(o, (out.get(o) || 0) + dt);
    const sk = fkey(leaf), sa = selfM.get(sk) || { cf: leaf.cf, url: leaf.url, owner: o, ms: 0 };
    sa.ms += dt; selfM.set(sk, sa);
    sampledMs += dt; count++;
  }
  const top = [...blobMs].sort((a, b) => b[1] - a[1])[0];
  return { owners: out, selfM, inclM, sampledMs, samples: count, mainTidMatched, topBlob: top ? { url: top[0], ms: r3(top[1]) } : null, plexusUrl: plexusU };
}

// ---- CLI
function table(s, file) {
  const f = (x) => String(r3(x)).padStart(10);
  const pctOf = (x) => ((x / s.ms) * 100).toFixed(1).padStart(5) + "%";
  const lines = [file, `span ${s.ms} ms (owner source: ${s.ownerSource})`, ""];
  const row = (n, v) => lines.push(n.padEnd(22) + f(v) + "  " + pctOf(v));
  row("script", s.script.plexus + s.script.roam + s.script.unknown + Object.values(s.script.other).reduce((a, b) => a + b, 0));
  row("  plexus", s.script.plexus); row("  roam", s.script.roam); row("  unknown", s.script.unknown);
  for (const [k, v] of Object.entries(s.script.other).sort((a, b) => b[1] - a[1])) row("  " + k, v);
  row("style", s.style); row("layout", s.layout); row("paint", s.paint); row("  of which hitTest", s.hitTest);
  row("gc", s.gc); row("other", s.other); row("idle", s.idle);
  lines.push("", `restyled ${s.restyled} elements in ${s.recalcs} recalcs, ${s.layouts} layouts, forced style/layout ${s.forcedMs} ms`);
  if (s.tasks.length) { lines.push("", "tasks >= 50 ms:"); for (const t of s.tasks) lines.push(`  at ${String(t.st).padStart(9)}  ${String(t.d).padStart(8)} ms  ` + t.top.map(([l, v]) => `${l} ${v}`).join(", ")); }
  if (s.profile) {
    lines.push("", `profile: ${s.profile.samples} samples, ${s.profile.sampledMs} ms sampled, main tid matched: ${s.profile.mainTidMatched}`);
    if (s.profile.topBlob) lines.push(`  blob with most sampled time: ${s.profile.topBlob.url} (${s.profile.topBlob.ms} ms)${s.profile.plexusUrl ? "; plexus: " + s.profile.plexusUrl : "; pass --plexus-url <url> if that is plexus"}`);
  }
  if (s.functions && s.functions.self.length) {
    lines.push("", "functions by self time (raw sampled ms):");
    for (const x of s.functions.self.slice(0, 15)) lines.push(`  ${String(x.ms).padStart(9)}  ${x.owner.padEnd(10)} ${x.fn.slice(0, 40)}  pos ${x.pos} (line ${x.line}, ${x.url6})`);
    lines.push("", "plexus functions by inclusive time (ms, self):");
    for (const x of s.functions.plexus.slice(0, 15)) lines.push(`  ${String(x.ms).padStart(9)}  ${String(x.selfMs).padStart(8)}  ${x.fn.slice(0, 40)}  pos ${x.pos} (line ${x.line})`);
  }
  if (s.selectors) { lines.push("", "selectors (ms, attempts, matches):"); for (const x of s.selectors.slice(0, 15)) lines.push(`  ${String(x.ms).padStart(8)} ${String(x.attempts).padStart(8)} ${String(x.matches).padStart(7)}  ${x.selector.slice(0, 110)}`); }
  return lines.join("\n");
}
export const oneLine = (s) => `span ${s.ms}ms script ${r3(s.script.plexus + s.script.roam + s.script.unknown + Object.values(s.script.other).reduce((a, b) => a + b, 0))} (plexus ${s.script.plexus}, roam ${s.script.roam}, other ${r3(Object.values(s.script.other).reduce((a, b) => a + b, 0))}, unknown ${s.script.unknown}) style ${s.style} layout ${s.layout} paint ${s.paint} gc ${s.gc} other ${s.other} idle ${s.idle} restyled ${s.restyled} forced ${s.forcedMs}`;

async function selftest() {
  const meta = [{ ph: "M", name: "thread_name", pid: 1, tid: 1, args: { name: "CrRendererMain" } }, { ph: "M", name: "thread_name", pid: 1, tid: 9, args: { name: "Compositor" } }];
  const X = (name, ts, dur, args) => ({ ph: "X", cat: "devtools.timeline", name, pid: 1, tid: 1, ts, dur, args });
  const blobA = "blob:https://roamresearch.com/aaaaaa", blobB = "blob:https://roamresearch.com/bbbbbb";
  const prof = [
    { ph: "P", name: "Profile", cat: "disabled-by-default-v8.cpu_profiler", pid: 1, tid: 1, ts: 2000, id: "0x1", args: { data: { startTime: 2000 } } },
    { ph: "P", name: "ProfileChunk", cat: "disabled-by-default-v8.cpu_profiler", pid: 1, tid: 1, ts: 3000, id: "0x1", args: { data: { cpuProfile: { nodes: [
      { id: 1, callFrame: { functionName: "(root)", url: "" } },
      { id: 2, parent: 1, callFrame: { functionName: "f", url: blobA } },
      { id: 3, parent: 1, callFrame: { functionName: "g", url: "https://roamresearch.com/app.js" } },
      { id: 4, parent: 1, callFrame: { functionName: "(idle)", url: "" } }], samples: [2, 2] }, timeDeltas: [500, 500] } } },
    { ph: "P", name: "ProfileChunk", cat: "disabled-by-default-v8.cpu_profiler", pid: 1, tid: 1, ts: 6000, id: "0x1", args: { data: { cpuProfile: { nodes: [
      { id: 5, parent: 2, callFrame: { functionName: "h", url: blobB } }], samples: [3, 5, 4] }, timeDeltas: [1000, 1000, 1000] } } },
  ];
  const trace = [...meta,
    { ph: "R", cat: "blink.user_timing", name: "pxd-stress-trace", pid: 1, tid: 1, ts: 500, args: {} },
    X("RunTask", 1000, 10000),
    X("FunctionCall", 2000, 6000, { data: { url: blobA, functionName: "run" } }),
    X("UpdateLayoutTree", 3000, 2000, { elementCount: 50 }),
    X("Layout", 8500, 1000),
    X("RunTask", 11500, 2000), X("MajorGC", 12000, 1000),
    X("RunTask", 20000, 60000), X("Layout", 21000, 55000),
    { ph: "X", name: "RunTask", pid: 1, tid: 9, ts: 0, dur: 500000 },
    ...prof];
  const dir = await mkdtemp(join(tmpdir(), "pxd-trana-"));
  try {
    const plain = join(dir, "t.json"), gz = join(dir, "t.json.gz");
    await writeFile(plain, JSON.stringify({ traceEvents: trace }));
    await writeFile(gz, gzipSync(JSON.stringify(trace)));
    const names = { [blobA]: { name: "plexus-diagram" }, [blobB]: { name: "Other Ext" } };
    const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.002, `${m}: ${a} vs ${b}`);
    for (const f of [plain, gz]) {
      const s = await analyseTrace(f, { names });
      near(s.ms, 79.5, "ms");
      // samples: 2 x 500 us on blobA, then roam 1000, blobB-under-blobA 1000 (outermost blob owns it), idle skipped
      near(s.script.plexus, 4 * 2000 / 3000, "script.plexus");
      near(s.script.roam, 4 * 1000 / 3000, "script.roam");
      assert.strictEqual(s.ownerSource, "profile");
    }
    // roam share: one sample of 3 goes to roam
    const s = await analyseTrace(plain, { names });
    near(s.script.plexus + s.script.roam + s.script.unknown, 4, "script total");
    near(s.style, 2, "style"); near(s.layout, 56, "layout"); near(s.paint, 0, "paint"); near(s.gc, 1, "gc");
    near(s.other, 3 + 1 + 5, "other");
    near(s.idle, 79.5 - 72, "idle");
    near(s.forcedMs, 2, "forced");
    assert.strictEqual(s.restyled, 50); assert.strictEqual(s.recalcs, 1); assert.strictEqual(s.layouts, 2);
    assert.strictEqual(s.tasks.length, 1);
    near(s.tasks[0].d, 60, "task d"); near(s.tasks[0].st, 19.5, "task st");
    assert.deepStrictEqual(s.tasks[0].top.map((x) => x[0]), ["Layout", "RunTask"]);
    near(s.script.plexus + s.style + s.layout + s.paint + s.gc + s.other + s.idle + s.script.roam + s.script.unknown, s.ms, "sum");
    // from/to window: only the first task
    const w = await analyseTrace(plain, { names, from: 0, to: 13 });
    near(w.ms, 13, "window ms"); assert.strictEqual(w.tasks.length, 0); near(w.layout, 1, "window layout");
    // profile owner split: remove the profile -> fall back to event urls
    await writeFile(join(dir, "np.json"), JSON.stringify(trace.filter((e) => e.ph !== "P")));
    const np = await analyseTrace(join(dir, "np.json"), { names });
    assert.strictEqual(np.ownerSource, "events"); near(np.script.plexus, 4, "fallback plexus");
    // roam attribution: a sample whose stack has only a roam frame
    const roamOnly = trace.map((e) => (e.name === "ProfileChunk" && e.ts === 6000 ? { ...e, args: { data: { cpuProfile: { nodes: [{ id: 5, parent: 3, callFrame: { functionName: "h", url: blobB } }], samples: [3, 5, 3] }, timeDeltas: [1000, 1000, 1000] } } } : e));
    await writeFile(join(dir, "r.json"), JSON.stringify(roamOnly));
    const ro = await analyseTrace(join(dir, "r.json"), { names });
    // samples: plexus 500+500, roam 1000, blobB (parent roam frame, outermost blob = B) 1000, roam 1000 -> 1000 plexus, 2000 roam, 1000 Other Ext
    near(ro.script.plexus, 4 * 1000 / 4000, "r plexus"); near(ro.script.roam, 4 * 2000 / 4000, "r roam"); near(ro.script.other["Other Ext"], 1, "r other");
    // function level: A (plexus) -> B (plexus) -> C (roam)
    const cfn = (id, parent, functionName, url, col) => ({ id, parent, callFrame: { functionName, url, lineNumber: 0, columnNumber: col } });
    const ft = trace.filter((e) => e.ph !== "P").concat([
      { ph: "P", name: "Profile", pid: 1, tid: 1, ts: 2000, id: "0x2", args: { data: { startTime: 2000 } } },
      { ph: "P", name: "ProfileChunk", pid: 1, tid: 1, ts: 3000, id: "0x2", args: { data: { cpuProfile: { nodes: [cfn(1, null, "(root)", "", 0), cfn(2, 1, "A", blobA, 100), cfn(3, 2, "B", blobA, 200), cfn(4, 3, "C", "https://roamresearch.com/app.js", 300), cfn(5, 1, "(idle)", "", 0)], samples: [2, 3, 4, 5] }, timeDeltas: [1000, 2000, 4000, 8000] } } }]);
    await writeFile(join(dir, "f.json"), JSON.stringify(ft));
    const fs = (await analyseTrace(join(dir, "f.json"), { names })).functions;
    const inc = (n) => fs.plexus.find((x) => x.fn === n);
    near(inc("A").ms, 7, "A inclusive"); near(inc("A").selfMs, 1, "A self"); near(inc("B").ms, 6, "B inclusive"); near(inc("B").selfMs, 2, "B self");
    assert.strictEqual(fs.plexus.length, 2); assert.strictEqual(inc("A").pos, 100);
    const c = fs.self.find((x) => x.fn === "C"); near(c.ms, 4, "C self"); assert.strictEqual(c.owner, "plexus"); /* the outermost blob frame owns the sample */ assert.strictEqual(c.url6, "app.js"); assert.strictEqual(c.pos, 300);
    assert.ok(!fs.self.some((x) => x.fn === "(idle)")); assert.strictEqual(fs.self.length, 3);
    assert.deepStrictEqual((await analyseTrace(plain, { names, from: 0, to: 13 })).functions.plexus.length, 1);
    assert.deepStrictEqual((await analyseTrace(join(dir, "np.json"), { names })).functions, { self: [], plexus: [] });
    // real-trace shape: Profile on the main tid, chunks on another tid with the same id, frames with a scriptId and no url
    const bf = (id, parent, functionName, scriptId, col) => ({ id, parent, callFrame: { codeType: "JS", functionName, scriptId, lineNumber: 0, columnNumber: col } });
    const rt = [...meta, { ph: "M", name: "thread_name", pid: 1, tid: 7, args: { name: "ProfilerThread" } },
      { ph: "R", cat: "blink.user_timing", name: "pxd-stress-trace", pid: 1, tid: 1, ts: 500, args: {} },
      X("RunTask", 1000, 20000), X("FunctionCall", 1500, 100, { data: { scriptId: 77, url: blobA } }), X("EvaluateScript", 1600, 50, { data: { scriptId: 88, url: "https://roamresearch.com/app.js" } }),
      { ph: "P", name: "Profile", pid: 1, tid: 1, ts: 900, id: "0x5", args: { data: { startTime: 900 } } },
      { ph: "P", name: "Profile", pid: 1, tid: 9, ts: 900, id: "0x6", args: { data: { startTime: 900 } } },
      { ph: "P", name: "ProfileChunk", pid: 1, tid: 7, ts: 3000, id: "0x5", args: { data: { cpuProfile: { nodes: [bf(1, null, "(root)", 0, 0), bf(2, 1, "sharedBgBudget", 77, 10), bf(3, 2, "armSettle", 77, 20), bf(4, 3, "domWork", 88, 30), bf(5, 1, "(idle)", 0, 0)], samples: [2, 3, 4, 5] }, timeDeltas: [1100, 1000, 2000, 5000] } } },
      { ph: "P", name: "ProfileChunk", pid: 1, tid: 7, ts: 3500, id: "0x6", args: { data: { cpuProfile: { nodes: [bf(1, null, "(root)", 0, 0), bf(2, 1, "other", 88, 1)], samples: [2] }, timeDeltas: [1000] } } }];
    await writeFile(join(dir, "rt.json"), JSON.stringify(rt));
    const rr = await analyseTrace(join(dir, "rt.json"));
    assert.strictEqual(rr.ownerSource, "profile"); assert.strictEqual(rr.profile.mainTidMatched, true); assert.strictEqual(rr.profile.samples, 3); near(rr.profile.sampledMs, 4.1, "sampled");
    assert.strictEqual(rr.profile.plexusUrl, blobA); // heuristic: two named functions in the one blob
    const pf = rr.functions.plexus.find((x) => x.fn === "sharedBgBudget"); near(pf.ms, 4.1, "heur incl"); near(pf.selfMs, 1.1, "heur self"); assert.strictEqual(pf.scriptId, 77); assert.strictEqual(pf.url6, blobA.slice(-6));
    const dw = rr.functions.self.find((x) => x.fn === "domWork"); assert.strictEqual(dw.owner, "plexus"); assert.strictEqual(dw.pos, 30); assert.ok(!rr.functions.self.some((x) => x.fn === "other"));
    near(rr.script.plexus, rr.scriptMs, "all script is plexus");
    // explicit plexusUrl, and unknown owner when nothing resolves
    const ex = await analyseTrace(join(dir, "rt.json"), { plexusUrl: blobA }); assert.strictEqual(ex.profile.plexusUrl, blobA);
    const nx = await analyseTrace(join(dir, "rt.json"), { names: { [blobB]: { name: "x" } } }); assert.ok(nx.script.other["ext:" + blobA.slice(-6)] > 0);
    // no Profile on the main tid: pick the main pid's profile with the most samples
    const rt2 = rt.map((e) => (e.name === "Profile" && e.id === "0x5" ? { ...e, tid: 8 } : e));
    await writeFile(join(dir, "rt2.json"), JSON.stringify(rt2));
    const r2x = await analyseTrace(join(dir, "rt2.json")); assert.strictEqual(r2x.profile.mainTidMatched, false); assert.strictEqual(r2x.profile.samples, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
  console.log("synthetic ok");
  const real = join(homedir(), "wo/pxd-20/tr-nm1.json");
  try { await readFile(real, { encoding: null, flag: "r" }).then(() => 0); } catch { console.log("selftest ok (real trace not found, skipped)"); return; }
  const r = await analyseTrace(real);
  const sum = r.script.plexus + r.script.roam + r.script.unknown + Object.values(r.script.other).reduce((a, b) => a + b, 0) + r.style + r.layout + r.paint + r.gc + r.other + r.idle;
  assert.ok(Math.abs(sum - r.ms) / r.ms < 0.01, `categories sum ${sum} vs span ${r.ms}`);
  assert.ok(r.restyled > 0, "restyled > 0");
  console.log(oneLine(r));
  console.log("selftest ok");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) await selftest();
  else {
    const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
    const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--plexus-url" && args[i - 1] !== "--names");
    if (!file) { console.error("usage: trace-analyse.mjs <file.json[.gz]> [--json] [--plexus-url <url>] [--names <file.json>] | --selftest"); process.exit(2); }
    const names = opt("--names") ? JSON.parse(await readFile(opt("--names"), "utf8")) : {};
    const s = await analyseTrace(file, { names, plexusUrl: opt("--plexus-url") });
    console.log(args.includes("--json") ? JSON.stringify(s) : table(s, file));
  }
}
