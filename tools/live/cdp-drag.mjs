// node cdp-drag.mjs <targetIdPrefix> x1 y1 x2 y2 — real HTML5 drag via Input.setInterceptDrags
const [sel, x1, y1, x2, y2] = process.argv.slice(2).map((v, i) => (i ? Number(v) : v));
const t = (await (await fetch("http://127.0.0.1:9223/json")).json()).find((x) => x.id.startsWith(sel));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); let intercepted = null;
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Input.dragIntercepted") intercepted = m.params.data; };
const rpc = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc("Input.setInterceptDrags", { enabled: true });
await rpc("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1, button: "none" });
await rpc("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", buttons: 1, clickCount: 1 });
for (let i = 1; i <= 10; i++) { await rpc("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1 + ((x2 - x1) * i) / 10, y: y1 + ((y2 - y1) * i) / 10, button: "left", buttons: 1 }); await sleep(30); if (intercepted) break; }
await sleep(200);
if (!intercepted) { console.log("no drag intercepted"); await rpc("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left" }); process.exit(0); }
console.log("dragData", JSON.stringify(intercepted).slice(0, 600));
await rpc("Input.dispatchDragEvent", { type: "dragEnter", x: x2, y: y2, data: intercepted });
await rpc("Input.dispatchDragEvent", { type: "dragOver", x: x2, y: y2, data: intercepted });
await sleep(100);
const r = await rpc("Input.dispatchDragEvent", { type: "drop", x: x2, y: y2, data: intercepted });
console.log("drop result", JSON.stringify(r.error || "ok"));
await rpc("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left" });
await rpc("Input.setInterceptDrags", { enabled: false });
ws.close(); process.exit(0);
