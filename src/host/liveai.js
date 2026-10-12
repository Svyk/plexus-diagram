// Ask AI adapter for the Live AI Assistant extension's public API (window.LiveAI_API, v29+, "Enable Public API").
// It is the only AI path. Inert and throw-free when the API is absent.

export const CALLER = "Plexus Diagram";
export const READY_EVENT = "liveai:api-ready";
export const UNLOADED_EVENT = "liveai:api-unloaded";

export const SETUP_HINT = "Turn on Live AI Assistant → Settings → Enable Public API, then reload Roam.";

const win = (w) => w || (typeof window !== "undefined" ? window : globalThis);
const api = (w) => {
  const a = win(w)?.LiveAI_API;
  return a && typeof a === "object" ? a : null;
};

export function available(w) {
  const a = api(w);
  if (!a || typeof a.generate !== "function") return false;
  try { return typeof a.isAvailable === "function" ? Boolean(a.isAvailable()) : true; } catch { return false; }
}

// True when the API object exists but no model is configured yet.
export function present(w) {
  return Boolean(api(w));
}

// Chat models only. Capabilities (array of strings, or an object of flags) or output modalities that name
// image generation, speech or embeddings exclude a model; the id and name are checked either way.
const NON_CHAT_RE = /image|dall-?e|tts|whisper|embed/i;
function listed(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).toLowerCase());
  if (value && typeof value === "object") return Object.keys(value).filter((k) => value[k]).map((k) => k.toLowerCase());
  return [];
}
export function isChatModel(m) {
  const caps = [...listed(m?.capabilities), ...listed(m?.outputModalities), ...listed(m?.modalities?.output)];
  if (caps.some((c) => /image.?(output|gen)|embed|speech|audio.?output|tts|transcri/.test(c))) return false;
  return !NON_CHAT_RE.test(`${m?.id || ""} ${m?.name || ""}`);
}

// ModelInfo.capabilities is { thinking, imageInput, webSearch, fileInput, videoInput, audioInput }.
export function sendsImages(model) {
  return model?.capabilities?.imageInput === true;
}

export function listModels(w) {
  const a = api(w);
  if (!a || typeof a.listModels !== "function") return [];
  try {
    const rows = a.listModels();
    return (Array.isArray(rows) ? rows : [])
      .filter((m) => m && typeof m.id === "string" && m.id && isChatModel(m))
      .map((m) => ({ id: m.id, name: m.name || m.id, provider: m.provider || "", contextLength: m.contextLength ?? null, isDefault: Boolean(m.isDefault), imageInput: sendsImages(m) }));
  } catch {
    return [];
  }
}

export function defaultModel(w) {
  const a = api(w);
  let id = null;
  try { id = typeof a?.getDefaultModel === "function" ? a.getDefaultModel() : null; } catch { id = null; }
  const models = listModels(w);
  if (typeof id === "string" && id && models.some((m) => m.id === id)) return id;
  return models.find((m) => m.isDefault)?.id || models[0]?.id || "";
}

// cb(true|false) now and on every ready/unloaded event. Returns the cleanup.
export function onReady(cb, w) {
  const target = win(w);
  if (typeof cb !== "function" || typeof target?.addEventListener !== "function") return () => {};
  const tell = () => { try { cb(available(target)); } catch { /* listener */ } };
  target.addEventListener(READY_EVENT, tell);
  target.addEventListener(UNLOADED_EVENT, tell);
  tell();
  return () => {
    try { target.removeEventListener(READY_EVENT, tell); } catch { /* gone */ }
    try { target.removeEventListener(UNLOADED_EVENT, tell); } catch { /* gone */ }
  };
}

export function friendlyError(error) {
  const code = error?.code;
  if (code === "RATE_LIMIT") return "Live AI is rate limited (20 requests a minute). Wait a moment and try again.";
  if (code === "INVALID_MODEL") return "That model is not available in Live AI Assistant. Pick another model.";
  if (code === "NO_API_KEY") return "That model has no API key in Live AI Assistant. Add one there or pick another model.";
  if (code === "EMPTY_RESPONSE") return "The model returned nothing. Try again or pick another model.";
  if (code === "PROVIDER_ERROR") return "The model provider returned an error. Check Live AI Assistant's settings and try again.";
  if (code === "INVALID_OPTIONS") return "Live AI Assistant rejected the request. Shorten the question or the context and try again.";
  if (error?.name === "AbortError") return "Stopped.";
  if (error?.code === "UNAVAILABLE") return SETUP_HINT;
  const msg = String(error?.message || "").replace(/^\[LiveAI_API\]\s*/, "").trim();
  return msg || "Live AI Assistant could not answer.";
}

// ask({ context, prompt, messages, systemPrompt, model, onChunk, signal, json }) -> { ok, text, json?, model, provider, usage } | { ok:false, error, code }
// messages: earlier turns [{ role: "user" | "assistant", content }]; with any, the prompt goes to Live AI as a message array.
// json: true asks Live AI for responseFormat "json_object" (answer parsed into result.json; the reply comes whole, no chunks).
export async function ask({ context = "", prompt = "", messages = null, systemPrompt = "", model = "", onChunk = null, signal = null, json = false, window: w } = {}) {
  if (!available(w)) return { ok: false, code: "UNAVAILABLE", error: SETUP_HINT };
  const prior = (Array.isArray(messages) ? messages : [])
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && String(m.content ?? "").trim())
    .map((m) => ({ role: m.role, content: String(m.content) }));
  const options = { prompt: prior.length ? [...prior, { role: "user", content: String(prompt) }] : String(prompt), caller: CALLER };
  if (context) options.context = String(context);
  if (systemPrompt) {
    options.systemPrompt = String(systemPrompt);
    options.useDefaultSystemPrompt = false;
  }
  if (model) options.model = model;
  if (signal) options.signal = signal;
  if (json) options.responseFormat = "json_object";
  if (typeof onChunk === "function") options.onChunk = (chunk) => { try { onChunk(chunk); } catch { /* view */ } };
  try {
    const result = await api(w).generate(options);
    return { ok: true, text: String(result?.text ?? ""), ...(result?.json !== undefined ? { json: result.json } : {}), model: result?.model || model, provider: result?.provider || "", usage: result?.usage || null };
  } catch (error) {
    return { ok: false, code: error?.code || (error?.name === "AbortError" ? "ABORTED" : "ERROR"), error: friendlyError(error) };
  }
}
