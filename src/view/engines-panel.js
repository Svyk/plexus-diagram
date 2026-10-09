// P-ONBOARD. The Engines panel: what can read a PDF here, and the one step to get each ready.
// Opened from the status strip and from the reading pane's gear. A row that is not ready has
// exactly one button; a row with no button is ready or not available yet. The Cloud row keeps
// Set up or Edit, because that sheet holds the LlamaParse key and the Mistral key.
//
// Contract (the orchestrator wires it in; this module imports nothing from Roam):
//   loadEngineState({ client, device, force }) -> { device, helper }
//   engineRows(state, { platform }) -> [{ id, name, dot, text, progress?, button?, disabled?, tip }]
//   helperSheet(helperState, platform) -> { title, command, note, copyLabel }
//   renderEnginesPanel(doc, parent, deps) -> { el, refresh(), setVisible(bool), showSheet(), dispose() }
// deps: {
//   client,                 // createHelperClient(): status, pair, downloadModels, cancelModels, invalidate
//   device?,                // { status(): { state: "ready"|"not-downloaded"|"downloading"|"unavailable", progress?, mb? },
//                           //   download(), cancel() }  (injected: the in-browser OCR source)
//   setSetting?(id, value), // for the manual token under Advanced
//   copy?(text), toast?(text), onUpdate?(),
//   setInterval?, clearInterval?, pollMs? (3000), platform? ("mac" | other)
// }
// Nothing is fetched until the panel is rendered. It re-checks the helper on open and every
// pollMs while visible. The cloud key is localStorage on this device, never a Roam setting.

import {
  llamaRoute,
  readCloudPrefs,
  readMistralKey,
  writeCloudPrefs,
  writeMistralKey,
  TIER_LABELS,
  TIER_CREDITS,
  MISTRAL_PRICE_CHECKED,
} from "../host/cloud-parse.js";

export const INSTALL_COMMAND = "curl -fsSL https://svyk.github.io/plexus-diagram/helper/install.sh | sh";
export const RESTART_COMMAND = "plexus-parse-helper install-agent";
export const MANUAL_COMMAND = 'uv tool install "git+https://github.com/Svyk/plexus-diagram#subdirectory=tools/parse-helper" && plexus-parse-helper serve';

const HELPER_MB_FALLBACK = 500;
const DEFAULT_POLL_MS = 3000;

const mbText = (bytes) => `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
const pct = (fraction) => `${Math.round(Math.max(0, Math.min(1, Number(fraction) || 0)) * 100)}%`;

export async function loadEngineState({ client, device, force = true } = {}) {
  const [helper, dev] = await Promise.all([
    client ? client.status({ force }).catch(() => ({ state: "not-installed", paired: false })) : { state: "not-installed", paired: false },
    (async () => (device?.status ? device.status() : { state: "unavailable" }))().catch(() => ({ state: "unavailable" })),
  ]);
  return { device: dev || { state: "unavailable" }, helper: helper || { state: "not-installed", paired: false } };
}

const button = (id, label, tip) => ({ id, label, tip });

function deviceOcrRow(device) {
  const row = { id: "device-ocr", name: "In-browser reading (beta)", tip: "engines.ocr" };
  switch (device?.state) {
    case "ready":
      return { ...row, dot: "ok", text: "Ready", button: null };
    case "not-downloaded": {
      const mb = Number(device.mb) > 0 ? Math.round(device.mb) : 30;
      return { ...row, dot: "off", text: `Not downloaded (${mb} MB, once)`, button: button("download-device", "Download", "engines.download-device") };
    }
    case "downloading":
      return {
        ...row, dot: "busy", text: `Downloading · ${pct(device.progress)}`, progress: Math.max(0, Math.min(1, Number(device.progress) || 0)),
        button: button("cancel-device", "Cancel", "engines.cancel"),
      };
    default:
      return { ...row, dot: "off", text: "Not available in this build", button: null, disabled: true };
  }
}

function helperRow(helper) {
  const row = { id: "helper", name: "Local helper", tip: "engines.helper" };
  switch (helper?.state) {
    case "ready":
      return { ...row, dot: "ok", text: helper.version ? `Ready · v${helper.version}` : "Ready", button: null };
    case "not-paired":
      return { ...row, dot: "warn", text: "Running, not paired", button: button("pair", "Pair", "engines.pair") };
    case "wrong-token":
      return { ...row, dot: "warn", text: "Token does not match", button: button("pair", "Pair again", "engines.pair") };
    case "not-running":
      return { ...row, dot: "warn", text: "Not running", button: button("start", "Start", "engines.start") };
    case "models-missing": {
      const bytes = Number(helper.progress?.bytes) || 0;
      const size = bytes ? mbText(bytes) : `${HELPER_MB_FALLBACK} MB`;
      return { ...row, dot: "warn", text: `Models not downloaded (${size})`, button: button("download", "Download", "engines.download") };
    }
    case "downloading": {
      const fraction = Math.max(0, Math.min(1, Number(helper.progress?.fraction) || 0));
      return {
        ...row, dot: "busy", text: `Downloading models · ${pct(fraction)}`, progress: fraction,
        button: button("cancel", "Cancel", "engines.cancel"),
      };
    }
    case "newer-schema":
      return { ...row, dot: "warn", text: "Newer than this Plexus", button: button("update", "Update Plexus", "engines.update") };
    default:
      return { ...row, dot: "off", text: "Not installed", button: button("setup", "Set up", "engines.setup") };
  }
}

const MISTRAL_TRADE = "Mistral OCR: no install, cheaper, weaker tables.";

export function cloudRow(prefs, helper) {
  const row = { id: "cloud", name: "Cloud", tip: "engines.cloud" };
  const key = Boolean(String(prefs?.key || "").trim());
  const mistral = Boolean(String(prefs?.mistralKey || "").trim());
  const trade = mistral ? "Mistral OCR: key saved, no install, cheaper, weaker tables." : MISTRAL_TRADE;
  const route = llamaRoute(prefs, helper);
  const edit = button("cloud-setup", route && key ? "Edit" : "Set up", "engines.cloud-setup");
  if (!key) return { ...row, dot: "warn", text: `Needs a LlamaParse key. ${trade}`, button: edit };
  if (!route) return { ...row, dot: "warn", text: `LlamaParse needs the helper or a relay. ${trade}`, button: edit };
  const region = prefs?.region === "eu" ? "EU" : "US";
  const tier = TIER_LABELS[prefs?.tier] || TIER_LABELS.agentic;
  return { ...row, dot: "ok", text: `LlamaParse · ${tier} · ${region} · ${route}. ${trade}`, button: edit };
}

export function engineRows(state, { platform = "mac" } = {}) {
  void platform;
  return [
    { id: "device", name: "On this device", dot: "ok", text: "Built-in parser · ready", button: null, tip: "engines.builtin" },
    deviceOcrRow(state?.device),
    helperRow(state?.helper),
    cloudRow(state?.cloud, state?.helper),
  ];
}

export function helperSheet(helperState, platform = "mac") {
  if (platform !== "mac") {
    return {
      title: "Set up the local helper",
      command: MANUAL_COMMAND,
      note: "The installer is for macOS. On another system run this in a terminal; it needs uv. Then click Pair.",
      copyLabel: "Copy command",
    };
  }
  if (helperState === "not-running") {
    return {
      title: "Start the local helper",
      command: RESTART_COMMAND,
      note: "Paste this in Terminal. It restarts the helper and keeps it starting at login. Then come back here.",
      copyLabel: "Copy command",
    };
  }
  return {
    title: "Set up the local helper",
    command: INSTALL_COMMAND,
    note: "Paste this in Terminal. It installs the helper and starts it. When it says \"Back to Roam: click Pair\", click Pair here.",
    copyLabel: "Copy command",
  };
}

const DOT_LABEL = { ok: "ready", warn: "needs attention", busy: "working", off: "off" };

function memoryStorage() {
  const bag = new Map();
  return {
    getItem: (id) => (bag.has(id) ? bag.get(id) : null),
    setItem: (id, value) => { bag.set(id, String(value)); },
  };
}

export function renderEnginesPanel(doc, parent, deps = {}) {
  const { client, device, setSetting, copy, toast, onUpdate } = deps;
  const storage = deps.storage || memoryStorage();
  const platform = deps.platform || "mac";
  const pollMs = deps.pollMs > 0 ? deps.pollMs : DEFAULT_POLL_MS;
  const setIv = deps.setInterval || ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearIv = deps.clearInterval || ((id) => globalThis.clearInterval(id));

  const el = doc.createElement("div");
  el.className = "pxd-engines pxd-chrome";
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "Engines");
  const stop = (event) => event.stopPropagation?.();
  // Listeners are tracked so a repaint or dispose leaves none behind.
  const heldStatic = [];
  const heldRows = [];
  const heldSheet = [];
  const bindTo = (store) => (node, type, fn) => { node.addEventListener(type, fn); store.push([node, type, fn]); };
  const release = (store) => { for (const [node, type, fn] of store.splice(0)) node.removeEventListener?.(type, fn); };
  for (const type of ["pointerdown", "mousedown", "dblclick"]) bindTo(heldStatic)(el, type, stop);

  const title = doc.createElement("div");
  title.className = "pxd-engines__title";
  title.textContent = "Engines";
  const list = doc.createElement("div");
  list.className = "pxd-engines__rows";
  const sheetHost = doc.createElement("div");
  sheetHost.className = "pxd-engines__sheet-host";
  el.append(title, list, sheetHost);

  let state = null;
  let sheetKind = null;
  let signature = "";
  let timer = null;
  let visible = true;
  let busy = false;
  let disposed = false;

  const say = (text) => { try { toast?.(text); } catch { /* a toast must never break the panel */ } };

  function paintRows() {
    const rows = engineRows(state, { platform });
    const sig = JSON.stringify(rows);
    if (sig === signature) return;
    signature = sig;
    release(heldRows);
    list.innerHTML = "";
    for (const row of rows) {
      const node = doc.createElement("div");
      node.className = `pxd-engines__row${row.disabled ? " pxd-engines__row--disabled" : ""}`;
      node.setAttribute("data-row", row.id);
      node.setAttribute("data-dot", row.dot);
      const dot = doc.createElement("span");
      dot.className = `pxd-engines__dot pxd-engines__dot--${row.dot}`;
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", DOT_LABEL[row.dot] || row.dot);
      const name = doc.createElement("span");
      name.className = "pxd-engines__name";
      name.setAttribute("data-tip", row.tip);
      name.textContent = row.name;
      const text = doc.createElement("span");
      text.className = "pxd-engines__text";
      text.textContent = row.text;
      node.append(dot, name, text);
      if (row.progress != null) {
        const bar = doc.createElement("span");
        bar.className = "pxd-engines__bar";
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        bar.setAttribute("aria-valuenow", String(Math.round(row.progress * 100)));
        const fill = doc.createElement("span");
        fill.className = "pxd-engines__fill";
        fill.style.width = pct(row.progress);
        bar.append(fill);
        node.append(bar);
      }
      if (row.button) {
        const b = doc.createElement("button");
        b.type = "button";
        b.setAttribute("type", "button");
        b.className = "pxd-engines__btn";
        b.setAttribute("data-action", row.button.id);
        b.setAttribute("data-tip", row.button.tip);
        b.textContent = row.button.label;
        bindTo(heldRows)(b, "click", (event) => {
          event.stopPropagation?.();
          void act(row.button.id);
        });
        node.append(b);
      }
      list.append(node);
    }
    paintSheet();
  }

  function field(tag, attrs) {
    const node = doc.createElement(tag);
    node.className = "pxd-engines__token";
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }

  function cloudRouteSentence(prefs) {
    const route = llamaRoute(prefs, state?.helper);
    if (route === "helper") return "LlamaParse will use the paired helper.";
    if (route === "your relay") return "LlamaParse will use your relay URL.";
    if (route === "hosted relay") return "LlamaParse will use the hosted relay.";
    return "LlamaParse has no route yet. Pair a helper with the cloud engine, or set a relay URL.";
  }

  function paintCloudSheet() {
    const prefs = readCloudPrefs(storage);
    const existing = sheetHost.querySelector?.("[data-cloud-route]");
    if (existing) {
      existing.textContent = cloudRouteSentence(prefs);
      return;
    }
    release(heldSheet);
    sheetHost.innerHTML = "";
    const box = doc.createElement("div");
    box.className = "pxd-engines__sheet";
    box.setAttribute("data-cloud-sheet", "");
    const head = doc.createElement("div");
    head.className = "pxd-engines__sheet-title";
    head.textContent = "Cloud";
    const routeLine = doc.createElement("div");
    routeLine.className = "pxd-engines__note";
    routeLine.setAttribute("data-cloud-route", "");
    routeLine.textContent = cloudRouteSentence(prefs);
    const note = doc.createElement("div");
    note.className = "pxd-engines__note";
    note.textContent = `LlamaParse is the main read. Mistral OCR needs no install, costs $4 / 1,000 pages (checked ${MISTRAL_PRICE_CHECKED}), and its tables are weaker. Keys stay in this browser. They are not written to the graph. Nothing is sent until you confirm the cost on a PDF.`;
    const keyInput = field("input", { type: "password", autocomplete: "off", "aria-label": "LlamaParse API key", placeholder: prefs.key ? "Key saved" : "API key", "data-cloud-key": "" });
    const region = field("select", { "aria-label": "Region", "data-cloud-region": "" });
    for (const [value, label] of [["us", "US"], ["eu", "EU"]]) {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = label;
      if (value === prefs.region) option.setAttribute("selected", "");
      region.append(option);
    }
    region.value = prefs.region;
    const tier = field("select", { "aria-label": "Tier", "data-cloud-tier": "" });
    for (const value of Object.keys(TIER_CREDITS)) {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = TIER_LABELS[value];
      if (value === prefs.tier) option.setAttribute("selected", "");
      tier.append(option);
    }
    tier.value = prefs.tier;
    const relay = field("input", { type: "url", autocomplete: "off", "aria-label": "Relay URL", placeholder: "Relay URL (optional)", "data-cloud-relay": "" });
    relay.value = prefs.relay || "";
    const mistralHead = doc.createElement("div");
    mistralHead.className = "pxd-engines__sheet-title";
    mistralHead.textContent = "Mistral OCR";
    const mistralKey = readMistralKey(storage);
    const mistralInput = field("input", {
      type: "password",
      autocomplete: "off",
      "aria-label": "Mistral OCR API key",
      placeholder: mistralKey ? "Key saved" : "Mistral API key",
      "data-mistral-key": "",
    });
    const save = doc.createElement("button");
    save.type = "button";
    save.setAttribute("type", "button");
    save.className = "pxd-engines__btn pxd-engines__btn--primary";
    save.setAttribute("data-action", "cloud-save");
    save.textContent = "Save on this device";
    bindTo(heldSheet)(save, "click", (event) => {
      event.stopPropagation?.();
      void act("cloud-save");
    });
    const clear = doc.createElement("button");
    clear.type = "button";
    clear.setAttribute("type", "button");
    clear.className = "pxd-engines__btn";
    clear.setAttribute("data-action", "cloud-clear");
    clear.textContent = "Remove LlamaParse key";
    bindTo(heldSheet)(clear, "click", (event) => {
      event.stopPropagation?.();
      void act("cloud-clear");
    });
    const clearMistral = doc.createElement("button");
    clearMistral.type = "button";
    clearMistral.setAttribute("type", "button");
    clearMistral.className = "pxd-engines__btn";
    clearMistral.setAttribute("data-action", "mistral-clear");
    clearMistral.textContent = "Remove Mistral key";
    bindTo(heldSheet)(clearMistral, "click", (event) => {
      event.stopPropagation?.();
      void act("mistral-clear");
    });
    box.append(head, routeLine, note, keyInput, region, tier, relay, mistralHead, mistralInput, save, clear, clearMistral);
    sheetHost.append(box);
  }

  function paintSheet() {
    if (sheetKind === "cloud") {
      paintCloudSheet();
      return;
    }
    release(heldSheet);
    sheetHost.innerHTML = "";
    if (sheetKind !== "helper") return;
    const sheet = helperSheet(state?.helper?.state, platform);
    const box = doc.createElement("div");
    box.className = "pxd-engines__sheet";
    const head = doc.createElement("div");
    head.className = "pxd-engines__sheet-title";
    head.textContent = sheet.title;
    const code = doc.createElement("code");
    code.className = "pxd-engines__command";
    code.textContent = sheet.command;
    const note = doc.createElement("div");
    note.className = "pxd-engines__note";
    note.textContent = sheet.note;
    const copyBtn = doc.createElement("button");
    copyBtn.type = "button";
    copyBtn.setAttribute("type", "button");
    copyBtn.className = "pxd-engines__btn";
    copyBtn.setAttribute("data-action", "copy");
    copyBtn.setAttribute("data-tip", "engines.copy");
    copyBtn.textContent = sheet.copyLabel;
    bindTo(heldSheet)(copyBtn, "click", (event) => {
      event.stopPropagation?.();
      // A script cannot fill the clipboard: only a real click does.
      if (event.isTrusted === false) return;
      Promise.resolve(copy?.(sheet.command)).then(() => say("Command copied")).catch(() => say("Could not copy. Select the command and copy it."));
    });
    box.append(head, code, note, copyBtn);
    if (state?.helper?.state !== "ready") {
      const pairBtn = doc.createElement("button");
      pairBtn.type = "button";
      pairBtn.setAttribute("type", "button");
      pairBtn.className = "pxd-engines__btn pxd-engines__btn--primary";
      pairBtn.setAttribute("data-action", "pair");
      pairBtn.setAttribute("data-tip", "engines.pair");
      pairBtn.textContent = "Pair";
      bindTo(heldSheet)(pairBtn, "click", (event) => {
        event.stopPropagation?.();
        void act("pair");
      });
      box.append(pairBtn);
    }
    sheetHost.append(box);
  }

  // Manual token. Pair is the way; this stays for a helper started by hand.
  const advanced = doc.createElement("details");
  advanced.className = "pxd-engines__advanced";
  const summary = doc.createElement("summary");
  summary.textContent = "Advanced";
  const tokenInput = doc.createElement("input");
  tokenInput.type = "password";
  tokenInput.setAttribute("type", "password");
  tokenInput.className = "pxd-engines__token";
  tokenInput.setAttribute("autocomplete", "off");
  tokenInput.setAttribute("aria-label", "Helper token");
  tokenInput.setAttribute("placeholder", "Token");
  const tokenSave = doc.createElement("button");
  tokenSave.type = "button";
  tokenSave.setAttribute("type", "button");
  tokenSave.className = "pxd-engines__btn";
  tokenSave.setAttribute("data-action", "save-token");
  tokenSave.setAttribute("data-tip", "engines.token-save");
  tokenSave.textContent = "Save token";
  bindTo(heldStatic)(tokenSave, "click", (event) => {
    event.stopPropagation?.();
    void act("save-token");
  });
  advanced.append(summary, tokenInput, tokenSave);
  el.append(advanced);

  async function act(id) {
    if (disposed) return;
    if (id === "setup" || id === "start") {
      sheetKind = sheetKind === "helper" ? null : "helper";
      paintSheet();
      return;
    }
    if (id === "cloud-setup") {
      sheetKind = sheetKind === "cloud" ? null : "cloud";
      if (sheetKind !== "cloud") {
        release(heldSheet);
        sheetHost.innerHTML = "";
      }
      paintSheet();
      return;
    }
    if (id === "cloud-save") {
      const typed = String(el.querySelector("[data-cloud-key]")?.value || "");
      const mistralTyped = String(el.querySelector("[data-mistral-key]")?.value || "");
      writeCloudPrefs(storage, {
        key: typed.trim() ? typed : null,
        region: el.querySelector("[data-cloud-region]")?.value,
        tier: el.querySelector("[data-cloud-tier]")?.value,
        relay: el.querySelector("[data-cloud-relay]")?.value ?? "",
      });
      writeMistralKey(storage, mistralTyped.trim() ? mistralTyped : null);
      say("Saved on this device");
    } else if (id === "cloud-clear") {
      writeCloudPrefs(storage, { key: "" });
      const input = el.querySelector("[data-cloud-key]");
      if (input) input.value = "";
      say("LlamaParse key removed from this device");
    } else if (id === "mistral-clear") {
      writeMistralKey(storage, "");
      const input = el.querySelector("[data-mistral-key]");
      if (input) input.value = "";
      say("Mistral key removed from this device");
    } else if (id === "pair") {
      const result = await client?.pair?.();
      if (result?.ok) say("Helper paired");
      else if (result?.reason === "window-closed") say("Pairing window closed. Run plexus-parse-helper pair, then click Pair.");
      else if (result?.reason === "not-running") say("The helper is not running.");
      else say("Could not pair.");
    } else if (id === "download") {
      await client?.downloadModels?.();
    } else if (id === "cancel") {
      await client?.cancelModels?.();
    } else if (id === "download-device") {
      await device?.download?.();
    } else if (id === "cancel-device") {
      await device?.cancel?.();
    } else if (id === "update") {
      onUpdate?.();
    } else if (id === "save-token") {
      const value = String(tokenInput.value || "").trim();
      if (!value || typeof setSetting !== "function") return;
      await setSetting("parse-helper-token", value);
      tokenInput.value = "";
      client?.invalidate?.();
      say("Token saved");
    }
    await refresh();
  }

  async function refresh() {
    if (disposed || busy) return state;
    busy = true;
    try {
      const next = await loadEngineState({ client, device, force: true });
      if (disposed) return state;
      const cloud = readCloudPrefs(storage);
      cloud.mistralKey = readMistralKey(storage);
      state = { ...next, cloud };
      if (sheetKind === "helper" && state.helper.state === "ready") sheetKind = null;
      paintRows();
      return state;
    } finally {
      busy = false;
    }
  }

  function stopTimer() {
    if (timer != null) clearIv(timer);
    timer = null;
  }

  function startTimer() {
    if (timer == null && visible && !disposed) timer = setIv(() => { void refresh(); }, pollMs);
  }

  function setVisible(value) {
    visible = Boolean(value);
    if (visible) {
      el.removeAttribute("hidden");
      startTimer();
      void refresh();
    } else {
      el.setAttribute("hidden", "");
      stopTimer();
    }
  }

  function showSheet() {
    sheetKind = "helper";
    paintSheet();
  }

  function dispose() {
    disposed = true;
    stopTimer();
    release(heldRows);
    release(heldSheet);
    release(heldStatic);
    el.remove?.();
  }

  parent.append(el);
  startTimer();
  void refresh();
  return { el, refresh, setVisible, showSheet, dispose };
}
