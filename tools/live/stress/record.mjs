// Passive real-use recorder for a live Roam window. Installs observers and passive listeners only.
//   node tools/live/stress/record.mjs start  <targetIdPrefix>
//   node tools/live/stress/record.mjs status <targetIdPrefix>
//   node tools/live/stress/record.mjs dump   <targetIdPrefix> <out.json> [--stop]
//   node tools/live/stress/record.mjs stop   <targetIdPrefix>
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { connectPassive, sleep } from "./lib/cdp.mjs";

// Name the scripts seen in slow frames: blob url -> {name, len, head}. Debugger domain, read-only.
export async function nameUrls(c, urls) {
  const want = new Set(urls);
  const names = {};
  if (!want.size) return names;
  const scripts = new Map();
  const off = c.on((m) => { if (m.method === "Debugger.scriptParsed" && want.has(m.params.url)) scripts.set(m.params.url, { id: m.params.scriptId, len: m.params.length }); });
  await c.send("Debugger.enable");
  try {
    await sleep(2500);
    for (const [url, sc] of scripts) {
      const got = await Promise.race([c.send("Debugger.getScriptSource", { scriptId: sc.id }), new Promise((r) => setTimeout(() => r({}), 6000))]);
      const src = (got.result && got.result.scriptSource) || "";
      const head = src.slice(0, 400);
      let name = null;
      if (src.includes("__plexusDiagram") && src.includes("pxd-root")) name = "plexus-diagram";
      else {
        const m = head.match(/\/\*!?\s*([A-Za-z][\w .@/-]{2,60}?)\s+v?(\d+\.\d+[\w.-]*)/) || src.slice(0, 4000).match(/name:\s*["']([\w .-]{3,40})["']/);
        name = m ? m[1].trim() : null;
      }
      if (!name) {
        const hints = ["roam-grid", "zoteroRoam", "better-tasks", "bettertasks", "live-ai", "liveai", "workbench", "roamjs", "smartblocks", "reference-path", "task-status", "plexus", "cursor-smith", "readwise", "blueprint", "chief-of-staff", "nautilus", "tldraw", "excalidraw", "mermaid", "pdf"];
        const low = src.slice(0, 200000).toLowerCase();
        name = hints.find((h) => low.includes(h)) || null;
      }
      names[url] = { name: name || "?", len: sc.len, head: head.replace(/\s+/g, " ").slice(0, 120) };
    }
  } finally {
    off();
    try { await c.send("Debugger.disable"); } catch { /* socket gone */ }
  }
  return names;
}

const DUMP = `(() => { const S = window.__pxdRec; if (!S) return "null"; if (S.dump) return S.dump();
  let lt = null, sm = null; try { const v = window.__plexusDiagram.views().find((x) => x.root && x.root.isConnected); lt = v && v.longTasks ? v.longTasks() : null; sm = v && v.slowMounts ? v.slowMounts() : null; } catch (e) {}
  return JSON.stringify({ secs: Math.round((performance.now() - S.t0) / 1000), wall: S.wall, version: window.__plexusDiagram && window.__plexusDiagram.version, dpr: devicePixelRatio, inner: [innerWidth, innerHeight], loaf: S.loaf, ev: S.ev, gest: S.gest, samples: S.samples, marks: S.marks, drop: S.drop, plexusLongTasks: lt, slowMounts: sm, title: document.title }); })()`;

const STATUS = `(() => { const S = window.__pxdRec; if (!S) return JSON.stringify({ started: false });
  const by = (a) => a.reduce((o, g) => (o[g.kind] = (o[g.kind] || 0) + 1, o), {});
  return JSON.stringify({ on: S.on, fmt: S.fmt || 1, secs: Math.round((performance.now() - S.t0) / 1000), loaf: S.loaf.length, ev: S.ev.length, gest: S.gest.length, byKind: by(S.gest), wheel: (S.wheel || []).length, cams: (S.cams || []).length, keys: (S.keys || []).length, ptr: (S.ptr || []).length, samples: S.samples.length, drop: S.drop }); })()`;

const STOP = `(() => { const S = window.__pxdRec; if (S && S.stop) { S.stop(); return "stopped"; } return "not started"; })()`;

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const [cmd, sel, out] = args;
  if (!cmd || !sel || !["start", "status", "dump", "stop"].includes(cmd) || (cmd === "dump" && !out)) {
    console.error("usage: record.mjs start|status|stop <targetIdPrefix> | dump <targetIdPrefix> <out.json> [--stop]");
    process.exit(2);
  }
  let c;
  try { c = await connectPassive(sel); } catch (e) { console.error(e.message); process.exit(3); }
  try {
    if (cmd === "start") {
      const page = await readFile(new URL("./lib/record-page.js", import.meta.url), "utf8");
      console.log(c.id.slice(0, 8), c.title, await c.ev(page));
    } else if (cmd === "status") {
      console.log(await c.ev(STATUS));
    } else if (cmd === "stop") {
      console.log(await c.ev(STOP));
    } else {
      const data = JSON.parse(await c.ev(DUMP));
      if (!data) { console.error("recorder not started"); process.exit(4); }
      const urls = new Set();
      for (const f of data.loaf) for (const s of f.s || []) if (s.u) urls.add(s.u);
      data.scriptNames = await nameUrls(c, urls);
      if (process.argv.includes("--stop")) await c.ev(STOP);
      await writeFile(out, JSON.stringify(data));
      console.log("wrote", out, "fmt", data.fmt || 1, "secs", data.secs, "loaf", data.loaf.length, "ev", data.ev.length, "gest", data.gest.length, "wheel", (data.wheel || []).length, "scripts named", Object.keys(data.scriptNames).length);
    }
  } finally { c.close(); }
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
