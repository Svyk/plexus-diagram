// Read-only look at a live Roam window for native tables and Roam Grid.
// Does not inject or unload Plexus, and does not click or write.
// usage: node tools/live/tables-check.mjs [titleSubstring]
// Default substring is Readwisenotes. Refuses "plx typing bench" and a Svy window.

const PORT = process.env.CDP_PORT || 9223;
const sel = process.argv[2] || "Readwisenotes";

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

const expression = `(() => {
  const title = document.title || "";
  const text = document.body?.innerText || "";
  const scripts = [...document.scripts || []].map((node) => node.src || "");
  return {
    title,
    rmTable: document.querySelectorAll(".rm-table").length,
    tableMacro: /\\{\\{\\s*(?:\\[\\[table\\]\\]|table)\\s*\\}\\}/i.test(text),
    roamGridUid: document.querySelectorAll("[data-roam-grid-uid]").length,
    rgRoot: document.querySelectorAll(".rg-root").length,
    depotScript: scripts.some((src) => /roam-grid/i.test(src)),
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
const result = await rpc(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
ws.close();
if (result.exceptionDetails) {
  console.error(JSON.stringify({ ok: false, reason: "eval", detail: String(result.exceptionDetails.exception?.description || "eval failed").slice(0, 500) }));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, ...result.result?.value }, null, 1));
