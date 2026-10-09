// Confirm sheet for a cloud read. Anchored to the outline. No network, no graph writes.
// The window listener exists only while the sheet is open.

import { cloudSheetModel } from "../host/cloud-parse.js";

function focusables(root) {
  const nodes = root.querySelectorAll?.("button, [href], input, select, textarea") || [];
  return [...nodes].filter((node) => node.getAttribute?.("disabled") == null && node.getAttribute?.("tabindex") !== "-1");
}

function focusEl(node) {
  try { node?.focus?.(); } catch { /* stub */ }
}

export function openCloudConfirm({
  doc = globalThis.document,
  anchor = null,
  onTier = null,
  provider = "llamaparse",
  region = "us",
  tier = "agentic",
  pageCount = 0,
  currentPage = 1,
  scope = null,
} = {}) {
  let chosenTier = tier;
  let chosenScope = scope;
  let done = false;
  let resolvePromise = () => {};
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  const modelNow = () => cloudSheetModel({
    provider,
    region,
    tier: chosenTier,
    pageCount,
    currentPage,
    scope: chosenScope,
  });
  const initial = modelNow();
  const sheet = doc.createElement("div");
  sheet.className = "pxd-cloud-confirm pxd-chrome";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", `Send this PDF to ${initial.title}`);
  const stop = (event) => event.stopPropagation?.();
  sheet.addEventListener("pointerdown", stop);
  sheet.addEventListener("mousedown", stop);
  sheet.addEventListener("click", stop);

  const title = doc.createElement("div");
  title.className = "pxd-cloud-confirm__title";
  title.setAttribute("data-cloud-provider", initial.provider);
  title.textContent = initial.title;
  sheet.append(title);

  if (initial.region) {
    const where = doc.createElement("p");
    where.className = "pxd-cloud-confirm__region";
    where.setAttribute("data-cloud-region", initial.region);
    where.textContent = `Region · ${initial.region}`;
    sheet.append(where);
  }

  const tiers = doc.createElement("div");
  tiers.className = "pxd-cloud-confirm__tiers";
  tiers.setAttribute("role", "radiogroup");
  tiers.setAttribute("aria-label", "Tier");
  const tierButtons = [];
  for (const row of initial.tiers) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "pxd-cloud-confirm__choice";
    button.setAttribute("role", "radio");
    button.setAttribute("data-tier", row.id);
    const mark = doc.createElement("span");
    mark.className = "pxd-cloud-confirm__check";
    mark.setAttribute("data-cloud-check", "");
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "✓";
    const label = doc.createElement("span");
    label.textContent = row.label;
    button.append(mark, label);
    button.addEventListener("click", (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (chosenTier === row.id) return;
      chosenTier = row.id;
      paint();
      try { onTier?.(row.id); } catch { /* storage */ }
    });
    tierButtons.push(button);
    tiers.append(button);
  }
  if (tierButtons.length) sheet.append(tiers);

  const pages = doc.createElement("p");
  pages.className = "pxd-cloud-confirm__pages";
  pages.setAttribute("data-cloud-pages", "");
  pages.textContent = initial.pageLabel;
  sheet.append(pages);

  const scopes = doc.createElement("div");
  scopes.className = "pxd-cloud-confirm__scopes";
  scopes.setAttribute("role", "radiogroup");
  scopes.setAttribute("aria-label", "Pages");
  const scopeButtons = [];
  const showScope = initial.pageCount > 1;
  if (showScope) {
    for (const [id, label] of [["current", initial.thisPage], ["all", initial.allPages]]) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "pxd-cloud-confirm__choice";
      button.setAttribute("role", "radio");
      button.setAttribute("data-scope", id);
      const mark = doc.createElement("span");
      mark.className = "pxd-cloud-confirm__check";
      mark.setAttribute("data-cloud-check", "");
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = "✓";
      const text = doc.createElement("span");
      text.textContent = label;
      button.append(mark, text);
      button.addEventListener("click", (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        chosenScope = id;
        paint();
      });
      scopeButtons.push(button);
      scopes.append(button);
    }
    sheet.append(scopes);
  }

  const estimate = doc.createElement("p");
  estimate.className = "pxd-cloud-confirm__estimate";
  estimate.setAttribute("data-cloud-estimate", "");
  sheet.append(estimate);

  const pace = doc.createElement("p");
  pace.className = "pxd-cloud-confirm__note";
  pace.setAttribute("data-cloud-pace", "");
  sheet.append(pace);

  if (initial.cache) {
    const cache = doc.createElement("p");
    cache.className = "pxd-cloud-confirm__note";
    cache.setAttribute("data-cloud-cache", "");
    cache.textContent = initial.cache;
    sheet.append(cache);
  }
  const leaves = doc.createElement("p");
  leaves.className = "pxd-cloud-confirm__note";
  leaves.setAttribute("data-cloud-leaves", "");
  leaves.textContent = initial.leaves;
  sheet.append(leaves);

  const actions = doc.createElement("div");
  actions.className = "pxd-cloud-confirm__actions";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "pxd-cloud-confirm__cancel";
  cancel.setAttribute("data-cloud-cancel", "");
  cancel.textContent = "Cancel";
  const send = doc.createElement("button");
  send.type = "button";
  send.className = "pxd-cloud-confirm__send";
  send.setAttribute("data-cloud-send", "");
  send.textContent = "Send";
  const press = (event, run) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    run();
  };
  cancel.addEventListener("click", (event) => press(event, () => finish({ ok: false })));
  send.addEventListener("click", (event) => press(event, () => finish(answer())));
  actions.append(cancel, send);
  sheet.append(actions);

  function paint() {
    const model = modelNow();
    estimate.textContent = model.estimate;
    pace.textContent = model.pace || "";
    if (model.pace) pace.removeAttribute?.("hidden");
    else pace.setAttribute?.("hidden", "");
    const mark = (button, on) => {
      button.classList.toggle("pxd-cloud-confirm__choice--on", on);
      button.setAttribute("aria-checked", on ? "true" : "false");
      const check = button.querySelector?.("[data-cloud-check]");
      if (!check) return;
      if (on) check.removeAttribute?.("hidden");
      else check.setAttribute?.("hidden", "");
    };
    for (const button of tierButtons) mark(button, button.getAttribute("data-tier") === model.tier);
    for (const button of scopeButtons) mark(button, button.getAttribute("data-scope") === model.scope);
  }

  function choiceButtons(node) {
    if (tierButtons.includes(node)) return tierButtons;
    if (scopeButtons.includes(node)) return scopeButtons;
    return null;
  }

  function moveChoice(backward, from) {
    const origin = choiceButtons(from) ? from : doc.activeElement;
    let buttons = choiceButtons(origin);
    let index = buttons ? buttons.indexOf(origin) : -1;
    if (!buttons) {
      buttons = tierButtons.length ? tierButtons : scopeButtons;
      if (!buttons.length) return false;
      index = buttons.findIndex((button) => button.getAttribute("aria-checked") === "true");
    }
    if (index < 0) index = 0;
    const next = buttons[(index + (backward ? -1 : 1) + buttons.length) % buttons.length];
    if (next && next !== origin) next.click?.();
    focusEl(next);
    return true;
  }

  function answer() {
    const model = modelNow();
    return { ok: true, tier: model.tier, scope: model.scope, pages: model.pages };
  }

  function cycle(backward) {
    const list = focusables(sheet);
    if (!list.length) return;
    let index = list.indexOf(doc.activeElement);
    if (index < 0) index = backward ? 0 : -1;
    const next = list[(index + (backward ? -1 : 1) + list.length) % list.length];
    focusEl(next);
  }

  const win = doc.defaultView;
  function onKey(event) {
    if (done) return;
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    if (event.key === "Escape") {
      event.preventDefault?.();
      finish({ ok: false });
    } else if (event.key === "Enter") {
      event.preventDefault?.();
      finish(answer());
    } else if (event.key === "Tab") {
      event.preventDefault?.();
      cycle(Boolean(event.shiftKey));
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault?.();
      moveChoice(event.key === "ArrowUp" || event.key === "ArrowLeft", event.target);
    }
  }

  function finish(value) {
    if (done) return;
    done = true;
    try { win?.removeEventListener?.("keydown", onKey, true); } catch { /* gone */ }
    try { sheet.removeEventListener?.("keydown", onKey); } catch { /* gone */ }
    try { sheet.remove(); } catch { /* gone */ }
    resolvePromise(value);
  }

  paint();
  (anchor || doc.body)?.append?.(sheet);
  try { win?.addEventListener?.("keydown", onKey, true); } catch { /* no window */ }
  sheet.addEventListener("keydown", onKey);
  focusEl(send);
  return { promise, close: () => finish({ ok: false }), el: sheet };
}
