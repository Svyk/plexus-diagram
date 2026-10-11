// Chart -> table. One figure of a parsed PDF goes to a vision model through Live AI Assistant; the answer comes back as
// JSON and lands on the board as an ordinary table card. Progress and errors are toasts; nothing is written on failure.

import { buildFocusContext } from "../model/ai-context.js";
import { chartContext, chartNote, chartTitle, chartToTable, CHART_PROMPT, CHART_SYSTEM_PROMPT, figureLabel, normalizeChart, parseChartJson, pickVisionModel } from "../model/chart-data.js";
import { parsedDocTitle } from "../model/pdf.js";
import * as liveai from "../host/liveai.js";
import { getFigureImages, noteFor } from "../host/figure-image.js";

export const OFF_TOAST = "Figure images are off in settings. Turn on “Send figure images to AI” to read charts.";
export const NO_MODEL_TOAST = "No model with image input in Live AI Assistant. Add one that accepts images (Claude or Gemini).";
export const READING_TOAST = "Reading chart…";
export const EMPTY_TOAST = (name) => `${name || "The model"} returned nothing. Try another model in Live AI Assistant.`;
export const UNREADABLE_TOAST = (name) => `Could not read a table from ${name || "the model"}'s answer. Try another model in Live AI Assistant.`;
export const NOT_A_CHART_TOAST = "No chart data found in this figure.";

// Errors that may come from the JSON response option itself: those get one plain-text retry.

function nearbyOf(doc, blockId) {
  try {
    const built = buildFocusContext(doc, { blockId }, { tokenCap: 1500, outlineTokens: 1, nearbyChars: 800 });
    const m = /=== Nearby text ===\n([\s\S]*?)(?=\n\n=== |$)/.exec(built.context || "");
    const body = m ? m[1].split("\n").filter((line) => !line.startsWith("Caption of the selected part:")).join("\n").trim() : "";
    return { caption: built.figure?.caption || "", nearby: body };
  } catch {
    return { caption: "", nearby: "" };
  }
}

// doc: the pxd-parse document. image: { key, url?, name?, getBlob() } as for Ask AI. addTable({ table, model }) -> Promise.
// Resolves { ok: true, table, model } or { ok: false, reason }.
export async function runChartToTable({ doc, blockId, image = null, imageService = null, toast = null, addTable = null, api = liveai, window: w } = {}) {
  const say = (message) => { try { if (typeof toast === "function") toast(message); } catch { /* host */ } };
  const block = doc?.blocks?.[blockId];
  if (!block || block.type !== "figure") return { ok: false, reason: "not-figure" };
  const service = imageService || getFigureImages();
  if (!service || service.enabled?.() === false) { say(OFF_TOAST); return { ok: false, reason: "off" }; }
  if (!api.available(w)) { say(api.SETUP_HINT); return { ok: false, reason: "unavailable" }; }
  const model = pickVisionModel(api.listModels(w));
  if (!model) { say(NO_MODEL_TOAST); return { ok: false, reason: "no-model" }; }
  say(READING_TOAST);
  const got = await service.ensureUrl({ key: image?.key || "", url: image?.url || "", getBlob: image?.getBlob, name: image?.name || "figure" });
  if (!got?.ok) {
    say(got?.reason === "off" ? OFF_TOAST : `${noteFor(got?.reason).replace(/; sending text only\.?$/, "")}. Chart reading needs the picture.`);
    return { ok: false, reason: got?.reason || "no-image" };
  }
  const { caption, nearby } = nearbyOf(doc, blockId);
  const request = { context: chartContext({ url: got.url, caption, nearby }), prompt: CHART_PROMPT, systemPrompt: CHART_SYSTEM_PROMPT, model: model.id, window: w };
  let res = await api.ask({ ...request, json: true });
  // Live AI's JSON mode throws a bare parse error when the model adds prose (seen live with Claude); the plain reply goes through the tolerant parser.
  if (!res.ok) res = await api.ask(request);
  if (!res.ok) { say(res.error || "Live AI Assistant could not read the chart."); return { ok: false, reason: res.code || "error" }; }
  const hasText = String(res.text || "").trim() || (res.json && typeof res.json === "object");
  if (!hasText) { say(EMPTY_TOAST(model.name)); return { ok: false, reason: "empty" }; }
  const parsed = parseChartJson(res.json ?? res.text) || parseChartJson(res.text);
  const checked = normalizeChart(parsed);
  if (!checked.ok) {
    say(checked.reason === "no-series" ? NOT_A_CHART_TOAST : UNREADABLE_TOAST(model.name));
    return { ok: false, reason: checked.reason };
  }
  const label = figureLabel(doc, blockId, caption);
  const table = chartToTable(checked.chart, {
    title: chartTitle({ label, page: block.page, docTitle: parsedDocTitle(doc) || String(doc?.title || "") }),
    note: chartNote(model.name, [...checked.warnings, checked.chart.notes ? `Model notes: ${checked.chart.notes}` : ""]),
  });
  if (typeof addTable !== "function") return { ok: true, table, model };
  let placed = null;
  try { placed = await addTable({ table, model }); } catch { placed = { ok: false }; }
  if (placed && placed.ok === false) { say("Could not add the table to the board."); return { ok: false, reason: "insert" }; }
  return { ok: true, table, model };
}
