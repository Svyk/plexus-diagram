// Dev only: page-first UX budgets in headless Chrome (U2 text layer mount, U5 ghost move frame).
// usage: node tools/bench/page-ux.mjs   (Chrome at the default macOS path; port 9342; writes nothing to any graph)
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = mkdtempSync(join(tmpdir(), "pxd-page-ux-"));
writeFileSync(join(dir, "entry.js"), `import { mountWords, createTextLayer, ocrWords, orderWords } from ${JSON.stringify(join(repo, "src/view/text-layer.js"))};
import { createDragGhost } from ${JSON.stringify(join(repo, "src/view/drag-ghost.js"))};
window.PXB = { mountWords, createTextLayer, ocrWords, orderWords, createDragGhost };
`);
buildSync({ entryPoints: [join(dir, "entry.js")], bundle: true, format: "iife", outfile: join(dir, "bundle.js"), platform: "browser" });
copyFileSync(join(repo, "extension.css"), join(dir, "extension.css"));
writeFileSync(join(dir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="extension.css">
<style>.page{position:relative;width:918px;height:1182px;margin:8px}.textLayer{position:absolute;inset:0;overflow:hidden;line-height:1}</style>
</head><body><div class="pxd-root" style="position:relative;width:1400px;height:900px;--pxd-screen-px:0.8"><div class="pxd-viewport"></div>
<div id="reader"></div></div><script src="bundle.js"></script></body></html>`);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9342;
const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${join(dir, "chrome")}`, "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 50 && !target; i += 1) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const call = (method, params = {}) => new Promise((done) => { const my = ++id; const on = (ev) => { const m = JSON.parse(ev.data); if (m.id === my) { ws.removeEventListener("message", on); done(m.result); } }; ws.addEventListener("message", on); ws.send(JSON.stringify({ id: my, method, params })); });
await call("Page.enable");
await call("Page.navigate", { url: `file://${join(dir, "index.html")}` });
await sleep(1200);
const ocr = readFileSync(join(repo, "test/fixtures/pdf/report-scan.ocr.json"), "utf8");
const expr = `(async () => {
  const OCR = ${ocr};
  const out = {};
  const reader = document.getElementById("reader");
  const mk = (n) => { const page = document.createElement("div"); page.className = "page"; page.setAttribute("data-page-number", String(n)); const layer = document.createElement("div"); layer.className = "textLayer"; page.append(layer); reader.append(page); return { page, layer }; };
  // 600-word synthetic page (like a dense scan) + the real Vision page 1 (457 words)
  const items = [];
  for (let i = 0; i < 600; i++) { const row = Math.floor(i / 12), col = i % 12; const x = 40 + col * 44, base = 40 + row * 14; items.push({ str: "word" + i, transform: [10,0,0,10,x,base], width: 30, height: 10, y0: base - 8, y1: base + 2 }); }
  const synth = { n: 1, w: 612, h: 792, items };
  const runs = (rec, k) => { const t = []; const tl = [];
    for (let i = 0; i < k; i++) { const { page, layer } = mk(1); const fresh = { ...rec };
      const t0 = performance.now(); PXB.mountWords(layer, fresh, { widthPx: page.clientWidth }); const t1 = performance.now(); void layer.offsetHeight; layer.lastChild.getBoundingClientRect(); const t2 = performance.now();
      t.push(t1 - t0); tl.push(t2 - t0); page.remove(); }
    t.sort((a,b)=>a-b); tl.sort((a,b)=>a-b); return { medianJsMs: +t[k>>1].toFixed(3), maxJsMs: +t[k-1].toFixed(3), medianWithLayoutMs: +tl[k>>1].toFixed(3) }; };
  out.synth600 = runs(synth, 21);
  out.vision457 = runs(OCR.pages[0], 21);
  // alignment check: one span's measured box vs its OCR box
  { const { page, layer } = mk(1); PXB.mountWords(layer, OCR.pages[0], { widthPx: page.clientWidth }); const scale = page.clientWidth / OCR.pages[0].w; const pr = page.getBoundingClientRect();
    const spans = [...layer.querySelectorAll(".pxd-tl-word")]; const words = PXB.orderWords(PXB.ocrWords(OCR.pages[0])).words;
    let worst = 0, worstW = 0, worstTop = 0, n = 0;
    spans.forEach((s, i) => { const r = s.getBoundingClientRect(); const w = words[i]; const dx = Math.abs((r.left - pr.left) - w.x * scale); const dy = Math.abs((r.top - pr.top) - w.y * scale);
      const rg = document.createRange(); rg.setStart(s.firstChild, 0); rg.setEnd(s.firstChild, w.text.length); const dw = Math.abs(rg.getBoundingClientRect().width - w.w * scale); worst = Math.max(worst, dx); worstTop = Math.max(worstTop, dy); worstW = Math.max(worstW, dw); n++; });
    out.alignment = { checked: n, worstLeftPx: +worst.toFixed(2), worstTopPx: +worstTop.toFixed(2), worstWidthPxApprox: +worstW.toFixed(2) };
    // selection text across first 12 spans
    const sel = getSelection(); const range = document.createRange(); range.setStart(spans[0].firstChild, 0); const last = spans[11]; range.setEnd(last.firstChild, last.firstChild.length); sel.removeAllRanges(); sel.addRange(range);
    out.selectionText = sel.toString();
    page.remove(); sel.removeAllRanges(); }
  // ghost: 180 frames
  const root = document.querySelector(".pxd-root");
  const g = PXB.createDragGhost({ root, from: { left: 900, top: 200, width: 300, height: 60, right: 1200, bottom: 260 }, pointer: { x: 950, y: 220 }, content: { kind: "text", text: "A selected passage from a scanned page that runs long enough to clamp at six lines in the card ghost. ".repeat(4), page: 3 } });
  const frameDeltas = [];
  await new Promise((resolve) => { let i = 0; let last = performance.now(); const step = () => { const t = performance.now(); frameDeltas.push(t - last); last = t; g.move(950 - i * 4, 220 + (i % 60) * 3); i++; if (i < 180) requestAnimationFrame(step); else resolve(); }; requestAnimationFrame(step); });
  await new Promise((r) => requestAnimationFrame(() => r()));
  out.ghost = { ...g.stats(), transform: g.element().style.transform, zone: g.zone(), height: g.element().offsetHeight };
  g.land();
  return JSON.stringify(out);
})()`;
const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
console.log(res.result?.value || JSON.stringify(res));
ws.close(); proc.kill();
