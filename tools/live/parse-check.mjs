// Live check for the parsed view. Does not inject, unload, or reload Plexus.
// usage: node tools/live/parse-check.mjs [titleSubstring]
// Default substring is Readwisenotes. Refuses "plx typing bench" and a Svy window.
// Opens the Test Lab PDF reader if a PDF card is on screen, presses Parsed, and
// reports block counts. If the Parsed control is missing, Depot is still 3.4.0.

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = process.env.CDP_PORT || 9223;
const sel = process.argv[2] || "Readwisenotes";
const outDir = join(tmpdir(), "pxd9-parse-check");

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  return (await res.json()).filter((t) => t.type === "page");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

let nextId = 1;
function rpc(ws, method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) { ws.removeEventListener("message", onMsg); resolve(msg.result || msg); }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await rpc(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    const detail = String(result.exceptionDetails.exception?.description || "eval failed").slice(0, 500);
    throw new Error(detail);
  }
  return result.result?.value;
}

async function shot(ws, name) {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, name);
  const shotResult = await rpc(ws, "Page.captureScreenshot", { format: "png" });
  const data = shotResult?.data || shotResult?.result?.data;
  if (data) writeFileSync(path, Buffer.from(data, "base64"));
  return path;
}

const expression = `(() => {
  const title = document.title || "";
  const mode = document.querySelector(".pxd-read__modes [data-mode='parsed']");
  const pdf = document.querySelector(".pxd-pdf-cover, button.pxd-pdf-open");
  return { title, hasParsed: Boolean(mode), hasPdf: Boolean(pdf), plexus: Boolean(document.querySelector(".pxd-root")) };
})()`;

const press = `(() => {
  const open = document.querySelector("button.pxd-pdf-open");
  if (!document.querySelector(".pxd-read") && open) open.click();
  const parsed = document.querySelector(".pxd-read__modes [data-mode='parsed']");
  if (!parsed) return { pressed: false };
  parsed.click();
  return { pressed: true };
})()`;

const report = `(() => {
  const root = document.querySelector(".pxd-parse");
  const blocks = [...document.querySelectorAll(".pxd-parse__block")];
  const tables = [...document.querySelectorAll(".pxd-parse__table")];
  return {
    blocks: blocks.length,
    types: blocks.map((node) => node.getAttribute("data-type")),
    tables: tables.length,
    cells: tables.map((table) => ({
      cells: table.querySelectorAll("th, td").length,
      spans: [...table.querySelectorAll("[rowspan], [colspan]")].map((cell) => ({
        rowspan: cell.getAttribute("rowspan"),
        colspan: cell.getAttribute("colspan"),
        text: (cell.textContent || "").slice(0, 40),
      })),
    })),
    chip: document.querySelector(".pxd-parse__engine")?.textContent || "",
  };
})()`;

const list = await targets();
const refused = (title) => /plx typing bench/i.test(title || "") || /\bSvy\b/.test(title || "");
const hit = list.find((t) => !refused(t.title) && (t.title || "").includes(sel));
if (!hit) {
  console.error(JSON.stringify({ ok: false, reason: "no target", sel, titles: list.map((t) => t.title) }));
  process.exit(1);
}
if (refused(hit.title)) {
  console.error(JSON.stringify({ ok: false, reason: "refused", title: hit.title }));
  process.exit(1);
}

const ws = await connect(hit.webSocketDebuggerUrl);
try {
  const seen = await evaluate(ws, expression);
  if (!seen?.hasParsed) {
    console.log(JSON.stringify({
      ok: false,
      reason: "parsed-control-missing",
      depot: "3.4.0",
      title: seen?.title || hit.title,
      hasPdf: Boolean(seen?.hasPdf),
      plexus: Boolean(seen?.plexus),
    }, null, 1));
    process.exit(0);
  }
  const t0 = Date.now();
  const pressed = await evaluate(ws, press);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const light = await evaluate(ws, report);
  const lightShot = await shot(ws, "parse-light.png");
  await evaluate(ws, `(() => { document.querySelector(".pxd-root")?.classList.add("pxd-root--dark"); return true; })()`);
  const darkShot = await shot(ws, "parse-dark.png");
  await evaluate(ws, `(() => { document.querySelector(".pxd-root")?.classList.remove("pxd-root--dark"); return true; })()`);
  console.log(JSON.stringify({
    ok: true,
    pressed: Boolean(pressed?.pressed),
    ms: Date.now() - t0,
    ...light,
    screenshots: { light: lightShot, dark: darkShot },
  }, null, 1));
} catch (error) {
  console.error(JSON.stringify({ ok: false, reason: "eval", detail: String(error?.message || error).slice(0, 500) }));
  process.exit(1);
} finally {
  ws.close();
}
