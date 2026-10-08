// P-ONBOARD. The text-status strip under the reading pane header. It appears only when a
// decision is needed, in one line, and every text has its button. The words "Docling" and
// "helper" jargon stay in tooltips and Settings; the label says "local helper".
//
// Contract (the orchestrator wires it in read-pane / parse-view):
//   stripKind(input)            -> kind id or null
//   stripModel(kind, input)     -> { kind, text, tip, buttons:[{id,label,primary}], progress?, autoHideMs? } | null
//   renderParseStatus(doc, parent, input, { onAction, later }) -> { el, update(input), kind(), dispose() }
// input: {
//   scanned: boolean,                 // the current page has no text layer
//   dismissed?: boolean,              // "Not now" was pressed for this page
//   ocr: { state: "idle"|"running"|"done"|"failed", source?: "device"|"helper", ms?, progress? (0..1),
//          modelsCached: boolean, modelMB?: number,
//          deviceAvailable?: boolean },   // false: no in-browser source exists, so only the local helper can read
//   helper: { state: <client.status().state>, paired: boolean },
// }
// Actions (onAction(id)): read-text, use-helper, not-now, start-helper, setup-helper, retry, cancel.

export const STRIP_ACTIONS = ["read-text", "use-helper", "not-now", "start-helper", "setup-helper", "retry", "cancel"];

const DEFAULT_MODEL_MB = 30;
const DONE_VISIBLE_MS = 3000;

const BUTTON_LABEL = {
  "read-text": "Read text",
  "use-helper": "Use local helper",
  "not-now": "Not now",
  "start-helper": "Start helper",
  "setup-helper": "Set up helper",
  retry: "Retry",
  cancel: "Cancel",
};

function secondsText(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "";
  return `${(Math.round(n / 100) / 10).toFixed(1)} s`;
}

// First match wins. A page with text and no running read gives null: no strip.
export function stripKind(input = {}) {
  const ocr = input.ocr || {};
  const helper = input.helper || {};
  if (ocr.state === "failed") return "unreadable";
  if (ocr.state === "running") return "reading";
  if (ocr.state === "done" && ocr.source === "helper") return "helper-done";
  if (!input.scanned || input.dismissed) return null;
  if (helper.paired && helper.state === "not-running") return "helper-off";
  return ocr.modelsCached ? "scan-cached" : "scan-first";
}

const btn = (id, primary = false) => ({ id, label: BUTTON_LABEL[id], primary });

export function stripModel(kind, input = {}) {
  const ocr = input.ocr || {};
  const mb = Number(ocr.modelMB) > 0 ? Math.round(Number(ocr.modelMB)) : DEFAULT_MODEL_MB;
  switch (kind) {
    case "reading":
      return {
        kind,
        text: "Reading text on this page…",
        tip: "parse.strip.cancel",
        buttons: [btn("cancel")],
        progress: Number.isFinite(ocr.progress) ? Math.max(0, Math.min(1, ocr.progress)) : null,
      };
    case "scan-first":
    case "scan-cached":
      if (ocr.deviceAvailable === false) {
        return input.helper?.state === "ready"
          ? { kind, text: "This page is an image. Read its text with the local helper.", tip: "parse.strip.use-helper", buttons: [btn("read-text", true), btn("not-now")] }
          : { kind, text: "This page is an image. Its text needs the local helper.", tip: "parse.strip.setup-helper", buttons: [btn("setup-helper", true), btn("not-now")] };
      }
      return kind === "scan-cached" ? {
        kind,
        text: "This page is an image. Read its text on this device.",
        tip: "parse.strip.read-text",
        buttons: [btn("read-text", true), btn("not-now")],
      } : {
        kind,
        text: `This page is an image. Read its text on this device (one-time ${mb} MB download).`,
        tip: "parse.strip.read-text",
        buttons: [btn("read-text", true), btn("use-helper"), btn("not-now")],
      };
    case "helper-done": {
      const t = secondsText(ocr.ms);
      return {
        kind,
        text: t ? `Read with local helper · ${t}` : "Read with local helper",
        tip: "engines.helper",
        buttons: [],
        autoHideMs: DONE_VISIBLE_MS,
      };
    }
    case "helper-off":
      if (ocr.deviceAvailable === false) {
        return { kind, text: "Local helper is off. Start it to read this page.", tip: "parse.strip.start-helper", buttons: [btn("start-helper", true), btn("not-now")] };
      }
      return {
        kind,
        text: "Local helper is off. Reading on this device instead.",
        tip: "parse.strip.start-helper",
        buttons: ocr.modelsCached ? [btn("start-helper", true)] : [btn("read-text", true), btn("start-helper")],
      };
    case "unreadable":
      return {
        kind,
        text: "Could not read this page. Try the local helper or a higher zoom.",
        tip: "parse.strip.retry",
        buttons: [btn("setup-helper", true), btn("retry")],
      };
    default:
      return null;
  }
}

const TIP_FOR_ACTION = {
  "read-text": "parse.strip.read-text",
  "use-helper": "parse.strip.use-helper",
  "not-now": "parse.strip.not-now",
  "start-helper": "parse.strip.start-helper",
  "setup-helper": "parse.strip.setup-helper",
  retry: "parse.strip.retry",
  cancel: "parse.strip.cancel",
};

export function renderParseStatus(doc, parent, input, { onAction, later } = {}) {
  const el = doc.createElement("div");
  el.className = "pxd-parse-status pxd-chrome";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  const stop = (event) => event.stopPropagation?.();
  const heldStatic = [];
  const heldButtons = [];
  const release = (store) => { for (const [node, type, fn] of store.splice(0)) node.removeEventListener?.(type, fn); };
  for (const type of ["pointerdown", "mousedown", "dblclick"]) { el.addEventListener(type, stop); heldStatic.push([el, type, stop]); }

  let current = null;
  let hideTimer = null;
  let disposed = false;
  let generation = 0;

  const clearTimer = () => {
    if (typeof hideTimer === "function") hideTimer();
    else if (hideTimer && typeof hideTimer.cancel === "function") hideTimer.cancel();
    hideTimer = null;
    generation += 1;
  };

  const paint = (model) => {
    release(heldButtons);
    el.innerHTML = "";
    const text = doc.createElement("span");
    text.className = "pxd-parse-status__text";
    text.textContent = model.text;
    el.append(text);
    if (model.progress != null) {
      const bar = doc.createElement("span");
      bar.className = "pxd-parse-status__bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(Math.round(model.progress * 100)));
      const fill = doc.createElement("span");
      fill.className = "pxd-parse-status__fill";
      fill.style.width = `${Math.round(model.progress * 100)}%`;
      bar.append(fill);
      el.append(bar);
    }
    for (const b of model.buttons) {
      const node = doc.createElement("button");
      node.type = "button";
      node.setAttribute("type", "button");
      node.className = `pxd-parse-status__btn${b.primary ? " pxd-parse-status__btn--primary" : ""}`;
      node.setAttribute("data-action", b.id);
      node.setAttribute("data-tip", TIP_FOR_ACTION[b.id]);
      node.textContent = b.label;
      const onClick = (event) => {
        event.stopPropagation?.();
        onAction?.(b.id);
      };
      node.addEventListener("click", onClick);
      heldButtons.push([node, "click", onClick]);
      el.append(node);
    }
  };

  function update(next) {
    if (disposed) return;
    const kind = stripKind(next);
    const model = kind ? stripModel(kind, next) : null;
    if (!model) {
      current = null;
      clearTimer();
      release(heldButtons);
      el.innerHTML = "";
      el.setAttribute("hidden", "");
      el.setAttribute("data-kind", "");
      return;
    }
    el.removeAttribute("hidden");
    el.setAttribute("data-kind", model.kind);
    const same = current && current.kind === model.kind && current.text === model.text
      && current.progress === model.progress && current.buttons.map((b) => b.id).join() === model.buttons.map((b) => b.id).join();
    if (!same) paint(model);
    if (model.autoHideMs && (!current || current.kind !== model.kind)) {
      clearTimer();
      if (typeof later === "function") {
        const mine = generation;
        hideTimer = later(() => {
          hideTimer = null;
          if (!disposed && mine === generation && current?.kind === "helper-done") {
            current = null;
            release(heldButtons);
            el.innerHTML = "";
            el.setAttribute("hidden", "");
            el.setAttribute("data-kind", "");
          }
        }, model.autoHideMs);
      }
    } else if (!model.autoHideMs) {
      clearTimer();
    }
    current = model;
  }

  function dispose() {
    disposed = true;
    clearTimer();
    release(heldButtons);
    release(heldStatic);
    el.remove?.();
  }

  parent.append(el);
  update(input);
  return { el, update, kind: () => current?.kind ?? null, dispose };
}
