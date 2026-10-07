// Dev only: print a fixture HTML to PDF with headless Chrome and real running headers/footers.
// usage: node tools/fixtures/print-pdf.mjs <in.html> <out.pdf> [headerText]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [input, output, header = ""] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9341;
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, "--user-data-dir=/tmp/pxd-fixture-chrome", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 50 && !target; i += 1) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const call = (method, params = {}) => new Promise((done) => {
  const my = ++id;
  const on = (ev) => { const m = JSON.parse(ev.data); if (m.id === my) { ws.removeEventListener("message", on); done(m.result); } };
  ws.addEventListener("message", on);
  ws.send(JSON.stringify({ id: my, method, params }));
});
await call("Page.enable");
await call("Page.navigate", { url: `file://${resolve(input)}` });
await sleep(1500);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const res = await call("Page.printToPDF", {
  paperWidth: 8.5, paperHeight: 11, marginTop: 0.8, marginBottom: 0.8, marginLeft: 0.7, marginRight: 0.7,
  displayHeaderFooter: true, printBackground: true,
  headerTemplate: `<div style="font-size:8px;width:100%;padding:0 0.7in;color:#555;font-family:Arial">${esc(header)}</div>`,
  footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#555;font-family:Arial">Page <span class="pageNumber"></span> of <span class="totalPages"></span> — Internal use</div>`,
});
writeFileSync(output, Buffer.from(res.data, "base64"));
ws.close();
proc.kill();
console.log("wrote", output);
