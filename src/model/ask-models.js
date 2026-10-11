// Ask AI model choice. Pure. Plexus' own default for Ask AI, so an empty Live AI default (a model with no key or no
// output) does not decide the answer. Models are { id, name, provider, isDefault, imageInput } from liveai.listModels.

export const MODEL_SETTING_DEFAULT = "auto";
export const MODEL_PICK_KEY = "pxd-ask-model";

// First available wins. Matched case-insensitively against a model's name and id.
export const AUTO_ORDER = Object.freeze([
  "Claude Sonnet 5.5",
  "Claude Opus 5.5",
  "Claude Sonnet 5",
  "Gemini 3.8 Flash",
  "Gemini 3.1 Pro",
]);

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const named = (m, want) => {
  const w = norm(want);
  return Boolean(w) && (norm(m.name) === w || norm(m.id) === w);
};
const providerIs = (m, re) => re.test(`${m.provider || ""} ${m.id || ""} ${m.name || ""}`);

export function graphOfWindow(w) {
  try { return /#\/app\/([^/?#]+)/.exec(String(w?.location?.hash || ""))?.[1] || ""; } catch { return ""; }
}

export const modelPickKey = (graph) => `${MODEL_PICK_KEY}:${graph || ""}`;

// -> model id, or "" when the list is empty.
// opts: { setting, remembered, liveDefault, needImage }
export function pickAskModel(models, { setting = MODEL_SETTING_DEFAULT, remembered = "", liveDefault = "", needImage = false } = {}) {
  const list = Array.isArray(models) ? models : [];
  if (!list.length) return "";
  const ok = (m) => Boolean(m) && (!needImage || m.imageInput);
  const pickFrom = (pool) => pool.find(ok) || null;

  const mine = list.find((m) => m.id === remembered);
  if (ok(mine)) return mine.id;

  const want = norm(setting);
  if (want && want !== MODEL_SETTING_DEFAULT) {
    const hit = list.find((m) => named(m, setting) && ok(m));
    if (hit) return hit.id;
  }
  for (const name of AUTO_ORDER) {
    const hit = list.find((m) => named(m, name) && ok(m));
    if (hit) return hit.id;
  }
  const anthropic = pickFrom(list.filter((m) => providerIs(m, /anthropic|claude/i)));
  if (anthropic) return anthropic.id;
  const google = pickFrom(list.filter((m) => providerIs(m, /google|gemini/i)));
  if (google) return google.id;
  const def = list.find((m) => m.id === liveDefault);
  if (ok(def)) return def.id;
  const any = pickFrom(list);
  if (any) return any.id;
  return def?.id || list.find((m) => m.isDefault)?.id || list[0].id;
}
