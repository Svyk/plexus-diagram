// Idle scenarios: a quiet board for two minutes, the follow refresh, and a 30 minute soak. None of them writes to the graph.
import { sleep } from "../lib/cdp.mjs";
import { mean } from "../lib/stats.mjs";

export const group = "idle";
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

async function idle2min(ctx) {
  const seconds = ctx.opts.quick ? 20 : 120;
  await ctx.show(ctx.at(1.07));
  await ctx.probe.quiet({ gap: 1500, max: 20000 });
  await ctx.probe.arm({ content: false });
  await sleep(seconds * 1000);
  const summary = await ctx.probe.take();
  return { summary, extra: { seconds, stallsPerMin: r1(summary.stalls.n / (seconds / 60)), cpu: null } };
}

const followStats = (ctx) => ctx.c.evJson(`JSON.stringify((${ctx.view} || {followStats: () => null}).followStats() ?? null)`);

async function followRefresh(ctx) {
  const before = await followStats(ctx);
  if (!before) return { skip: "this board has no followed source" };
  const cap = ctx.opts.quick ? 30000 : 120000;
  await ctx.probe.quiet({ gap: 1500, max: 20000 });
  await ctx.probe.arm({ content: false });
  const t0 = Date.now();
  let after = before;
  while (Date.now() - t0 < cap) {
    await sleep(500);
    after = (await followStats(ctx)) || after;
    if ((after.reads || 0) > (before.reads || 0)) break;
  }
  const waited = Date.now() - t0;
  const grew = (after.reads || 0) > (before.reads || 0);
  if (grew) await ctx.probe.quiet({ gap: 1500, max: 15000 });
  const summary = await ctx.probe.take();
  if (!grew) return { summary, skip: `no follow read within ${Math.round(cap / 1000)} s`, extra: { follow: { before, after }, waited } };
  return { summary, extra: { follow: { before, after }, lastMs: after.lastMs, reads: after.reads, waited } };
}

async function sample(ctx, t, summary) {
  const { c } = ctx;
  const m = await c.send("Performance.getMetrics");
  const get = (n) => { const x = ((m.result && m.result.metrics) || []).find((e) => e.name === n); return x ? x.value : null; };
  const info = await ctx.probe.info();
  const heap = get("JSHeapUsedSize");
  return {
    t, heapMB: info.heapMB, jsHeap: heap == null ? null : r1(heap / 1048576), nodes: get("Nodes"), listeners: get("JSEventListeners"), docEls: info.docEls, boardEls: info.boardEls, attached: info.attached,
    stalls: { n: summary.stalls.n, total: summary.stalls.total, worst: summary.stalls.worst },
  };
}

async function drag(ctx, dir) {
  const p = await ctx.freePoint(370, dir);
  if (!p) return false;
  await ctx.input.drag({ x1: p.x, y1: p.y, x2: p.x + dir * 370, y2: p.y, steps: 30, delay: 16 });
  return true;
}

async function soak(ctx) {
  if (ctx.opts.quick) return { skip: "the soak never runs with --quick" };
  const minutes = ctx.opts.soakMin || 30;
  const CYCLE = 30000;
  const cycles = Math.floor((minutes * 60000) / CYCLE);
  const { c, input } = ctx;
  await c.send("Performance.enable");
  ctx.onCleanup(async () => { if (!c.closed) await c.send("Performance.disable"); }, "Performance.disable");
  await ctx.show(ctx.at(1.07));
  await ctx.probe.quiet({ gap: 1500, max: 20000 });
  const t00 = Date.now();
  const samples = [];
  let summary = null, last = null;
  for (let k = 0; k < cycles; k++) {
    const start = Date.now();
    await ctx.probe.arm({ content: false });
    const did = { pan: false, zoom: 0, click: false };
    did.pan = (await drag(ctx, -1)) && (await drag(ctx, 1));
    for (const re of [/zoom out/i, /zoom out/i, /zoom in/i, /zoom in/i]) { if (await ctx.clickBtn(re)) did.zoom++; await sleep(400); }
    const p = await ctx.freePoint(0, 1);
    if (p) { await input.click(p.x, p.y); did.click = true; }
    const rest = start + CYCLE - Date.now();
    if (rest > 0) await sleep(rest);
    summary = await ctx.probe.take();
    last = await sample(ctx, Math.round((Date.now() - t00) / 1000), summary);
    last.did = did;
    samples.push(last);
    if (k % 10 === 9) ctx.log(`soak ${Math.round(((k + 1) / cycles) * 100)}%  heap ${last.heapMB} MB  nodes ${last.nodes}`);
  }
  const win = Math.min(5, minutes / 2) * 60;
  const group = (rows) => {
    if (!rows.length) return null;
    return { heap: r1(mean(rows.map((s) => s.heapMB))), nodes: r1(mean(rows.map((s) => s.nodes))), stallMsPerMin: r1(rows.reduce((a, s) => a + s.stalls.total, 0) / (rows.length * (CYCLE / 60000))) };
  };
  const first5 = group(samples.filter((s) => s.t <= win));
  const last5 = group(samples.filter((s) => s.t >= minutes * 60 - win));
  const pctOf = (a, b) => (a && b != null && a !== 0 ? r1(((b - a) / a) * 100) : null);
  const growth = first5 && last5 ? { heapPct: pctOf(first5.heap, last5.heap), nodesPct: pctOf(first5.nodes, last5.nodes), stallPct: pctOf(first5.stallMsPerMin, last5.stallMsPerMin) } : null;
  return { summary, extra: { minutes, cycles, samples, first5, last5, growth } };
}

export const scenarios = [
  { name: "idle-2min", title: "Two minutes with no input: stalls and frames at rest", heavy: true, run: idle2min },
  { name: "follow-refresh", title: "Follow source refresh while idle", run: followRefresh },
  { name: "soak", title: "30 minute soak: pans, zoom clicks, idle; heap, nodes, listeners, stalls", heavy: true, quick: false, run: soak },
];
