// Better Tasks bridge. Plexus never writes BT_attr* blocks itself: every task attribute change goes through
// the tools Better Tasks registers on window.RoamExtensionTools["better-tasks"]. Each call feature-detects, so a
// graph without Better Tasks (or with an older build that has no tools) still works with plain TODO blocks.

const REGISTRY = "RoamExtensionTools";
const ENTRY = "better-tasks";

export const TASK_ATTR_IDS = ["repeat", "start", "defer", "due", "completed", "project", "gtd", "waitingFor", "context", "priority", "energy", "depends", "parent", "notes"];

const lower = (s) => String(s ?? "").trim().toLowerCase();

export function createBt({ win = globalThis.window ?? globalThis } = {}) {
  let names = null; // Map id -> Set of lower-case labels, from bt_get_attributes
  let priming = null;

  const tools = () => {
    let entry = null;
    try { entry = win?.[REGISTRY]?.[ENTRY]; } catch { entry = null; }
    const list = entry?.tools;
    const map = new Map();
    if (Array.isArray(list)) for (const tool of list) { if (tool?.name) map.set(tool.name, tool); }
    else if (list && typeof list === "object") for (const [name, tool] of Object.entries(list)) map.set(name, tool);
    return map;
  };
  const tool = (name) => {
    const t = tools().get(name);
    return t && typeof t.execute === "function" ? t : null;
  };

  const call = async (name, args) => {
    const t = tool(name);
    if (!t) return { ok: false, reason: "unavailable" };
    try {
      const res = await t.execute(args);
      if (res && typeof res === "object" && res.error) return { ok: false, reason: String(res.error), result: res };
      return { ok: true, result: res };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  };

  const readNames = (res) => {
    const list = res?.attributes;
    if (!Array.isArray(list) || !list.length) return null;
    const map = new Map();
    for (const row of list) {
      if (!row?.id || !row?.name) continue;
      const set = new Set([lower(row.name)]);
      for (const alias of row.aliases || []) if (alias) set.add(lower(alias));
      map.set(row.id, set);
    }
    return map.size ? map : null;
  };

  return {
    available: () => Boolean(tool("bt_modify")),
    canCreate: () => Boolean(tool("bt_create")),
    // Attribute labels by id. Null until primed or when Better Tasks does not answer: callers fall back to /^BT_attr/.
    attrNames: () => names,
    prime() {
      if (names) return Promise.resolve(names);
      if (priming) return priming;
      if (!tool("bt_get_attributes")) return Promise.resolve(null);
      priming = call("bt_get_attributes", {}).then((res) => {
        priming = null;
        if (res.ok) names = readNames(res.result);
        return names;
      });
      return priming;
    },
    // Shared by status and attribute edits. attributes keys are Better Tasks ids: due, project, priority, repeat, ...
    modify(uid, { status, attributes, text } = {}) {
      const args = { uid };
      if (status) args.status = status;
      if (attributes && Object.keys(attributes).length) args.attributes = attributes;
      if (typeof text === "string") args.text = text;
      return call("bt_modify", args);
    },
    create(args) {
      return call("bt_create", args);
    },
    // Tasks matching a text, as Better Tasks lists them. Empty when Better Tasks does not answer.
    async search(args) {
      const res = await call("bt_search", args);
      return res.ok && Array.isArray(res.result?.tasks) ? res.result.tasks : [];
    },
    async projects() {
      const res = await call("bt_get_projects", { status: "active", max_results: 60 });
      const rows = res.ok ? res.result?.projects : null;
      return Array.isArray(rows) ? rows.map((r) => String(r?.name || "")).filter(Boolean) : [];
    },
  };
}
