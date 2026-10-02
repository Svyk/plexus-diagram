// Live harness for Plexus Diagram 1.0 over Roam Desktop CDP (:9223).
// usage: node tools/live/plexus-live.mjs <cmd> <titleSubstringOrTargetIdPrefix> [arg]
//   Never target the window titled "plx typing bench" (another session owns it).
//   inject   — load ~/plexus-Diagram/extension.js (+css) into the window via blob import with an extensionAPI shim
//   unload   — call onunload and remove css
//   eval     — evaluate arg (JS expression, awaited)
//   evalfile — evaluate the JS file at arg (awaited)
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";

const PORT = process.env.CDP_PORT || 9223;
const [, , cmd, sel, arg] = process.argv;

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

async function evaluate(expression) {
  const ts = await targets();
  const t = ts.find((x) => x.id.startsWith(sel)) || ts.find((x) => (x.title || "").includes(sel));
  if (t && /plx typing bench/.test(t.title || "")) { console.error("refused: another session owns", t.title); process.exit(1); }
  if (!t) { console.error("no target", sel, ts.map((x) => x.title)); process.exit(1); }
  const ws = await connect(t.webSocketDebuggerUrl);
  const r = await rpc(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, timeout: 60000 });
  ws.close();
  if (r.exceptionDetails) {
    console.log("EXCEPTION:", JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails).slice(0, 3000));
    process.exit(2);
  }
  const v = r.result?.value;
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 1));
}

const repo = `${homedir()}/plexus-Diagram`;

if (cmd === "inject") {
  const code = await readFile(`${repo}/extension.js`, "utf8");
  const css = await readFile(`${repo}/extension.css`, "utf8");
  await evaluate(`(async () => {
    if (window.__plexusDiagram && !window.__pxdLive) return "REFUSED: an installed Plexus " + window.__plexusDiagram.version + " is running in this window. Remove its Developer Extension URL first, or use another window.";
    if (window.__pxdLive?.unload) { try { await window.__pxdLive.unload(); } catch (e) { console.error(e); } }
    document.querySelectorAll("#pxd-live-css").forEach((node) => node.remove());
    const style = document.createElement("style"); style.id = "pxd-live-css"; style.textContent = ${JSON.stringify(css)}; document.head.append(style);
    const url = URL.createObjectURL(new Blob([${JSON.stringify(code)}], { type: "text/javascript" }));
    const mod = await import(url);
    const saved = JSON.parse(localStorage.getItem("pxd-live-settings") || "{}");
    const store = new Map(Object.entries(saved));
    const persist = () => localStorage.setItem("pxd-live-settings", JSON.stringify(Object.fromEntries(store)));
    let panelConfig = null;
    const R = window.roamAlphaAPI.ui;
    const wrap = (ns) => ns ? { addCommand: (c) => ns.addCommand(c), removeCommand: (c) => ns.removeCommand(c) } : undefined;
    const extensionAPI = {
      settings: {
        get: (k) => store.has(k) ? store.get(k) : null,
        set: async (k, v) => { store.set(k, v); persist(); },
        getAll: () => Object.fromEntries(store),
        panel: { create: async (config) => { panelConfig = config; } },
      },
      ui: { commandPalette: wrap(R.commandPalette), slashCommand: wrap(R.slashCommand), blockContextMenu: wrap(R.blockContextMenu) },
    };
    const t0 = performance.now();
    await mod.default.onload({ extensionAPI, extension: { version: "live" } });
    const loadMs = Math.round(performance.now() - t0);
    window.__pxdLive = { mod, extensionAPI, panel: () => panelConfig, unload: async () => { await mod.default.onunload(); document.querySelectorAll("#pxd-live-css").forEach((node) => node.remove()); URL.revokeObjectURL(url); } };
    return "injected in " + loadMs + " ms; version " + (window.__plexusDiagram?.version || "?");
  })()`);
} else if (cmd === "unload") {
  await evaluate(`(async () => { if (!window.__pxdLive) return "none"; await window.__pxdLive.unload(); delete window.__pxdLive; return JSON.stringify({ pxdNodes: document.querySelectorAll("[class*=pxd-]").length, globals: typeof window.__plexusDiagram }); })()`);
} else if (cmd === "eval") {
  await evaluate(arg);
} else if (cmd === "evalfile") {
  await evaluate(await readFile(arg, "utf8"));
} else if (cmd !== "shot" && cmd !== "input") {
  console.error("usage: inject|unload|eval|evalfile <title> [arg]");
  process.exit(1);
}

if (cmd === "shot") {
  const ts = await targets();
  const t = ts.find((x) => x.id.startsWith(sel)) || ts.find((x) => (x.title || "").includes(sel));
  if (!t || /plx typing bench/.test(t.title || "")) { console.error("refused or not found:", sel); process.exit(1); }
  const ws = await connect(t.webSocketDebuggerUrl);
  const [out, selector] = [arg, process.argv[5]];
  let clip;
  if (selector) {
    const r = await rpc(ws, "Runtime.evaluate", { expression: `JSON.stringify((() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block: "center"}); const b = e.getBoundingClientRect(); return {x: b.x, y: b.y, width: b.width, height: b.height}; })())`, returnByValue: true });
    const box = JSON.parse(r.result.value || "null");
    if (box) clip = { ...box, scale: 1 };
  }
  const shot = await rpc(ws, "Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(out, Buffer.from(shot.data, "base64"));
  console.log("saved", out, clip ? JSON.stringify(clip) : "full");
  ws.close();
}

// input <title> <stepsJsonOrFile>: trusted CDP input. Steps:
// {t:"move",x,y} {t:"down",x,y} {t:"up",x,y} {t:"click",x,y,count?} {t:"drag",x1,y1,x2,y2,steps?}
// {t:"key",key,code?,mods?} {t:"text",text} {t:"wait",ms} {t:"wheel",x,y,dx,dy,mods?}
if (cmd === "input") {
  const ts = await targets();
  const t = ts.find((x) => x.id.startsWith(sel)) || ts.find((x) => (x.title || "").includes(sel));
  if (!t || /plx typing bench/.test(t.title || "")) { console.error("refused or not found:", sel); process.exit(1); }
  const ws = await connect(t.webSocketDebuggerUrl);
  const { readFile: rf } = await import("node:fs/promises");
  const steps = JSON.parse(arg.trim().startsWith("[") ? arg : await rf(arg, "utf8"));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mods = (m = []) => (m.includes("alt") ? 1 : 0) | (m.includes("ctrl") ? 2 : 0) | (m.includes("meta") ? 4 : 0) | (m.includes("shift") ? 8 : 0);
  const mouse = (type, x, y, extra = {}) => {
    const button = extra.button || "left";
    const mask = button === "right" ? 2 : button === "middle" ? 4 : 1;
    return rpc(ws, "Input.dispatchMouseEvent", { type, x, y, button, buttons: type === "mouseReleased" ? 0 : mask, clickCount: 1, ...extra, button });
  };
  for (const s of steps) {
    if (s.t === "move") await rpc(ws, "Input.dispatchMouseEvent", { type: "mouseMoved", x: s.x, y: s.y, button: "none", buttons: 0 });
    else if (s.t === "down") await mouse("mousePressed", s.x, s.y, { modifiers: mods(s.mods) });
    else if (s.t === "up") await mouse("mouseReleased", s.x, s.y, { modifiers: mods(s.mods) });
    else if (s.t === "click") {
      const count = s.count || 1;
      for (let c = 1; c <= count; c += 1) {
        await mouse("mousePressed", s.x, s.y, { clickCount: c, modifiers: mods(s.mods), button: s.button || "left" });
        await mouse("mouseReleased", s.x, s.y, { clickCount: c, modifiers: mods(s.mods), button: s.button || "left" });
        await sleep(30);
      }
    } else if (s.t === "drag") {
      const n = s.steps || 12;
      await rpc(ws, "Input.dispatchMouseEvent", { type: "mouseMoved", x: s.x1, y: s.y1, button: "none", buttons: 0 });
      await mouse("mousePressed", s.x1, s.y1, { modifiers: mods(s.mods) });
      for (let i = 1; i <= n; i += 1) {
        await rpc(ws, "Input.dispatchMouseEvent", { type: "mouseMoved", x: s.x1 + ((s.x2 - s.x1) * i) / n, y: s.y1 + ((s.y2 - s.y1) * i) / n, button: "left", buttons: 1, modifiers: mods(s.mods) });
        await sleep(s.delay ?? 16);
      }
      await mouse("mouseReleased", s.x2, s.y2, { modifiers: mods(s.mods) });
    } else if (s.t === "key") {
      const base = { key: s.key, code: s.code || s.key, windowsVirtualKeyCode: s.vk || 0, modifiers: mods(s.mods) };
      await rpc(ws, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
      await rpc(ws, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
    } else if (s.t === "text") await rpc(ws, "Input.insertText", { text: s.text });
    else if (s.t === "wheel") await rpc(ws, "Input.dispatchMouseEvent", { type: "mouseWheel", x: s.x, y: s.y, deltaX: s.dx || 0, deltaY: s.dy || 0, modifiers: mods(s.mods) });
    else if (s.t === "wait") await sleep(s.ms || 100);
    if (s.pause) await sleep(s.pause);
  }
  console.log("input done", steps.length);
  ws.close();
}
