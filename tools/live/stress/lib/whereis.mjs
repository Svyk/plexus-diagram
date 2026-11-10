// Map a character position in a built bundle back to a source file by matching nearby string literals.
//   node whereis.mjs <bundle.js> <pos> [--line N] (without --line, pos is an absolute offset in the file) [--src src] [--context 400]
//   node whereis.mjs --selftest
import { readFile, readdir, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

const cache = new Map(); // src dir -> [{file, text}]

async function loadSrc(dir) {
  if (cache.has(dir)) return cache.get(dir);
  const files = [];
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name === "css" || e.name === "node_modules") continue; await walk(p); }
      else if (e.name.endsWith(".js") && e.name !== "changelog-text.js") files.push({ file: relative(dir, p), text: await readFile(p, "utf8") });
    }
  };
  await walk(dir);
  cache.set(dir, files);
  return files;
}

function anchorsOf(snippet, center) {
  const found = new Map();
  const add = (text, idx) => {
    const dist = Math.abs(idx + text.length / 2 - center);
    const o = found.get(text);
    if (!o || dist < o.dist) found.set(text, { text, dist });
  };
  for (const m of snippet.matchAll(/"([^"\\\n]{5,})"|'([^'\\\n]{5,})'|`([^`\\\n]{5,})`/g)) {
    const t = m[1] ?? m[2] ?? m[3];
    if (t.includes("${")) continue;
    add(t, m.index + 1);
  }
  for (const m of snippet.matchAll(/\.pxd-[\w-]+|data-pxd-[\w-]+|pxd:[\w-]+/g)) add(m[0], m.index);
  return [...found.values()].sort((a, b) => a.dist - b.dist);
}

function occurrences(files, text) {
  const by = [];
  for (const f of files) {
    if (!f.text.includes(text)) continue;
    const lines = [];
    let i = -1;
    while ((i = f.text.indexOf(text, i + 1)) !== -1) {
      let ln = 1;
      for (let k = f.text.lastIndexOf("\n", i); k >= 0; k = f.text.lastIndexOf("\n", k - 1)) ln++;
      lines.push(ln);
      if (lines.length >= 20) break;
    }
    by.push({ file: f.file, lines });
    if (by.length > 3) break; // too common
  }
  return by.length <= 3 ? by : null;
}

export async function whereis(bundleFile, pos, { line = 0, src = "src", context = 400 } = {}) {
  // line null: pos is an absolute character offset in the file (what LoAF sourceCharPosition gives); a number: pos is a column on that 0-based line (CPU profile columnNumber)
  const all = await readFile(bundleFile, "utf8");
  const text = line == null ? all : all.split("\n")[line] || "";
  const files = await loadSrc(src);
  let snippet = "", kept = [];
  for (const ctx of [context, Math.max(context, 1500)]) {
    const start = Math.max(0, pos - ctx);
    snippet = text.slice(start, pos + ctx);
    kept = [];
    for (const a of anchorsOf(snippet, pos - start)) {
      const occ = occurrences(files, a.text);
      if (occ && occ.length) kept.push({ ...a, occ });
    }
    if (kept.length || ctx >= 1500) break;
  }
  const hits = [];
  for (const a of kept) for (const o of a.occ) hits.push({ file: o.file, line: o.lines[0], literal: a.text.slice(0, 80), count: o.lines.length });
  let best = null;
  if (kept.length) {
    const near = kept.slice(0, 6), tally = new Map();
    near.forEach((a, rank) => { for (const o of a.occ) { const t = tally.get(o.file) || { n: 0, rank, line: o.lines[0] }; t.n++; tally.set(o.file, t); } });
    const [file, t] = [...tally].sort((a, b) => b[1].n - a[1].n || a[1].rank - b[1].rank)[0];
    const nearest = near.find((a) => a.occ.some((o) => o.file === file));
    best = { file, line: nearest.occ.find((o) => o.file === file).lines[0] };
  }
  return { pos, snippet, hits, best };
}

async function selftest() {
  const dir = await mkdtemp(join(tmpdir(), "pxd-whereis-"));
  try {
    const src = join(dir, "src");
    await mkdir(join(src, "css"), { recursive: true }); await mkdir(join(src, "view"), { recursive: true });
    await writeFile(join(src, "view/a.js"), "const x = 1;\n// pad\nel.className = 'pxd-zebra-card'; log('unique literal alpha');\n");
    await writeFile(join(src, "view/b.js"), "export const other = 'unique literal beta';\nconst c = 'common string';\n");
    await writeFile(join(src, "view/c.js"), "const c = 'common string';\n");
    await writeFile(join(src, "view/d.js"), "const c = 'common string';\n");
    await writeFile(join(src, "view/e.js"), "const c = 'common string';\n");
    await writeFile(join(src, "changelog-text.js"), "const z = 'only in changelog';\n");
    await writeFile(join(src, "css/s.js"), "const z = 'only in css dir';\n");
    const bundle = "x".repeat(2000) + `;f("common string");g('only in changelog');h("only in css dir");el.className="pxd-zebra-card";log("unique literal alpha");` + "y".repeat(500) + `;log("unique literal beta");` + "z".repeat(3000) + "\nsecond line only\n";
    const bf = join(dir, "bundle.js");
    await writeFile(bf, bundle);
    const p1 = bundle.indexOf("unique literal alpha") + 3;
    const r = await whereis(bf, p1, { src, context: 300 });
    assert.deepStrictEqual(r.best, { file: join("view", "a.js"), line: 3 });
    assert.ok(r.snippet.includes("pxd-zebra-card"));
    assert.ok(!r.hits.some((h) => /changelog|css/.test(h.file) || h.literal === "common string"));
    const p2 = bundle.indexOf("unique literal beta");
    const r2 = await whereis(bf, p2, { src, context: 100 });
    assert.deepStrictEqual(r2.best, { file: join("view", "b.js"), line: 1 });
    // no anchors in range: widen once, still none -> null
    const r3 = await whereis(bf, 6000, { src, context: 100 });
    assert.strictEqual(r3.best, null);
    // widening finds the anchors 1500 away
    const r4 = await whereis(bf, bundle.indexOf("unique literal beta") + 1300, { src, context: 100 });
    assert.ok(r4.best);
  } finally { await rm(dir, { recursive: true, force: true }); }
  console.log("selftest ok");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
  if (a.includes("--selftest")) await selftest();
  else {
    const pos = Number(a[1]);
    if (!a[0] || !Number.isFinite(pos)) { console.error("usage: whereis.mjs <bundle.js> <pos> [--line N] (without --line, pos is an absolute offset in the file) [--src src] [--context 400] | --selftest"); process.exit(2); }
    const r = await whereis(a[0], pos, { line: opt("--line") == null ? null : Number(opt("--line")), src: opt("--src", "src"), context: Number(opt("--context", 400)) });
    const mid = r.snippet.length ? Math.min(r.snippet.length, pos - Math.max(0, pos - Number(opt("--context", 400)))) : 0;
    console.log((r.snippet.slice(Math.max(0, mid - 80), mid) + "<<HERE>>" + r.snippet.slice(mid, mid + 80)).replace(/\s+/g, " "));
    console.log("best:", r.best ? `${r.best.file}:${r.best.line}` : "none");
    for (const h of r.hits.slice(0, 8)) console.log(`  ${h.file}:${h.line} x${h.count}  ${JSON.stringify(h.literal)}`);
  }
}
