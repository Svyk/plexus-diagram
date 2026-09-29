import { attrNameOf, mergePropsForWrite, plainKeys } from "../model/schema.js";

export const BOARD_PATTERN = `[:block/uid :block/string :block/order :block/heading :block/open :block/props
 {:block/children [:block/uid :block/string :block/order :block/heading :block/props
   {:block/children [:block/uid :block/string :block/order :block/heading :block/props
     {:block/children ...}]}]}]`;

const ciPattern = (text) => `(?i)${String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;

export const NATIVE_PATTERN = `[{:diagram/nodes [:db/id :diagram.node/data {:diagram.node/block [:block/uid :block/string]} {:diagram.node/parent-node [:db/id]}]}
 {:diagram/edges [{:diagram.edge/source [:db/id]} {:diagram.edge/target [:db/id]} :diagram.edge/data]}]`;

const eidKey = (uid) => [":block/uid", uid];
const watchEntity = (uid) => `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`;

function sortedKids(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
  return kids
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i)
    .map(({ c }) => c);
}

function trimTree(node, depth, budget) {
  const out = [];
  if (depth < 1) return out;
  for (const c of sortedKids(node)) {
    if (budget.left <= 0) break;
    budget.left--;
    out.push({
      uid: c[":block/uid"],
      string: c[":block/string"] ?? "",
      children: trimTree(c, depth - 1, budget),
    });
  }
  return out;
}

export function graphName(hash = globalThis.location?.hash ?? "") {
  const m = /#\/app\/([^/?#]+)/.exec(hash);
  return m ? decodeURIComponent(m[1]) : "";
}

export function createWriteQueue({ onBusy } = {}) {
  let tail = Promise.resolve();
  let pending = 0;
  let waiters = [];
  return {
    run(fn) {
      pending++;
      if (pending === 1) onBusy?.(true);
      const p = tail.then(async () => {
        try {
          return await fn();
        } finally {
          pending--;
          if (pending === 0) {
            onBusy?.(false);
            const w = waiters;
            waiters = [];
            w.forEach((r) => r());
          }
        }
      });
      tail = p.then(() => {}, () => {});
      return p;
    },
    get pending() { return pending; },
    idle() {
      if (pending === 0) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

const canon = (v) => (typeof v === "string" ? v : JSON.stringify(v));

export function createEchoLedger({ graceMs = 800, now = Date.now } = {}) {
  const state = new Map(); // `${uid}\u0000${field}` -> {pending:[], inflight, graceUntil}
  const keyOf = (uid, field) => `${uid}\u0000${field}`;
  const get = (uid, field, create) => {
    const k = keyOf(uid, field);
    let s = state.get(k);
    if (!s && create) { s = { uid, field, pending: [], inflight: 0, graceUntil: 0 }; state.set(k, s); }
    return s;
  };
  return {
    expect(uid, field, value) {
      const s = get(uid, field, true);
      s.pending.push(canon(value));
      s.inflight++;
    },
    settle(uid, field) {
      const s = get(uid, field, false);
      if (!s) return;
      s.inflight = Math.max(0, s.inflight - 1);
      if (s.inflight === 0) s.graceUntil = now() + graceMs;
    },
    accept(uid, field, value) {
      const k = keyOf(uid, field);
      const s = state.get(k);
      if (!s) return true;
      const v = canon(value);
      const idle = s.inflight === 0;
      if (idle && now() >= s.graceUntil) { state.delete(k); return true; }
      const idx = s.pending.lastIndexOf(v);
      if (idx >= 0 && idx === s.pending.length - 1) {
        s.pending = [];
        if (idle) s.graceUntil = now() + graceMs;
        return false;
      }
      return false;
    },
    tracked() { return [...state.values()].map((s) => [s.uid, s.field]); },
    pendingCount(uid) {
      let n = 0;
      for (const s of state.values()) if (s.uid === uid) n += s.pending.length + s.inflight;
      return n;
    },
    clear() { state.clear(); },
  };
}

export function createViewportStore({ storage = globalThis.localStorage, graph = "", now = Date.now } = {}) {
  const key = (uid) => `plexus-diagram:vp:${graph}:${uid}`;
  const lastWrite = new Map();
  const latest = new Map();
  const timers = new Map();
  const flush = (uid) => {
    timers.delete(uid);
    if (!latest.has(uid)) return;
    try { storage?.setItem(key(uid), JSON.stringify(latest.get(uid))); } catch { /* quota or private mode */ }
    lastWrite.set(uid, now());
    latest.delete(uid);
  };
  return {
    get(uid) {
      try {
        const raw = storage?.getItem(key(uid));
        if (!raw) return null;
        const v = JSON.parse(raw);
        return Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.zoom) ? v : null;
      } catch { return null; }
    },
    set(uid, vp) {
      if (!vp) return;
      latest.set(uid, { x: vp.x, y: vp.y, zoom: vp.zoom });
      const since = now() - (lastWrite.get(uid) ?? -Infinity);
      if (since >= 500) { flush(uid); return; }
      if (!timers.has(uid)) {
        const t = setTimeout(() => flush(uid), 500 - since);
        t.unref?.();
        timers.set(uid, t);
      }
    },
    flushAll() {
      for (const [uid, t] of timers) { clearTimeout(t); flush(uid); }
    },
    dispose() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      latest.clear();
    },
  };
}

export function createHost({ api = globalThis.roamAlphaAPI, storage = globalThis.localStorage, graph } = {}) {
  const stats = { writes: 0, watches: 0, renders: 0 };
  const data = api.data;
  const pull = (pattern, entity) => data.pull(pattern, entity);
  const gname = graph ?? graphName();

  const host = {
    api,
    stats,
    viewports: createViewportStore({ storage, graph: gname }),

    pullBoard(uid) {
      const res = pull(BOARD_PATTERN, eidKey(uid));
      return res && res[":block/uid"] ? res : null;
    },

    watchBoard(uid, cb) {
      const entity = watchEntity(uid);
      const wrapped = (before, after) => cb(after);
      data.addPullWatch(BOARD_PATTERN, entity, wrapped);
      stats.watches++;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        data.removePullWatch(BOARD_PATTERN, entity, wrapped);
        stats.watches--;
      };
    },

    pullNative(uid) {
      return pull(NATIVE_PATTERN, eidKey(uid)) ?? null;
    },

    pullProps(uid) {
      const res = pull("[:block/props]", eidKey(uid));
      const props = res?.[":block/props"];
      return props && typeof props === "object" ? plainKeys(props) : {};
    },

    pullTree(uid, depth = 2, limit = 12) {
      const res = pull(BOARD_PATTERN, eidKey(uid));
      return res ? trimTree(res, depth, { left: limit }) : [];
    },

    pullPage(title) {
      const res = pull(BOARD_PATTERN, [":node/title", title]);
      return res && res[":block/uid"] ? res : null;
    },

    pagePreview(title, depth = 2, limit = 12) {
      const res = pull(BOARD_PATTERN, [":node/title", title]);
      if (!res || !res[":block/uid"]) return { uid: null, exists: false, blocks: [] };
      return { uid: res[":block/uid"], exists: true, blocks: trimTree(res, depth, { left: limit }) };
    },

    pageUid(title) {
      const res = pull("[:block/uid]", [":node/title", title]);
      return res?.[":block/uid"] ?? null;
    },

    blockString(uid) {
      const res = pull("[:block/string]", eidKey(uid));
      return typeof res?.[":block/string"] === "string" ? res[":block/string"] : null;
    },

    parentString(uid) {
      const res = pull("[{:block/_children [:block/string]}]", eidKey(uid));
      const p = res?.[":block/_children"];
      const first = Array.isArray(p) ? p[0] : p;
      return typeof first?.[":block/string"] === "string" ? first[":block/string"] : null;
    },

    resolveEid(ref) {
      const entity = ref?.uid ? eidKey(ref.uid) : ref?.title ? [":node/title", ref.title] : null;
      if (!entity) return null;
      const res = pull("[:db/id]", entity);
      return res?.[":db/id"] ?? null;
    },

    generateUid() { return api.util.generateUID(); },

    async createBlock({ parentUid, order = "last", uid, string = "", props, open } = {}) {
      const id = uid ?? api.util.generateUID();
      const block = { uid: id, string };
      if (props !== undefined) block.props = plainKeys(props);
      if (open !== undefined) block.open = open;
      stats.writes++;
      await data.block.create({ location: { "parent-uid": parentUid, order }, block });
      return id;
    },

    async updateString(uid, string) {
      stats.writes++;
      await data.block.update({ block: { uid, string } });
    },

    async updateProps(uid, plexus) {
      const merged = mergePropsForWrite(host.pullProps(uid), plexus);
      stats.writes++;
      await data.block.update({ block: { uid, props: merged } });
    },

    async moveBlock(uid, parentUid, order = "last") {
      stats.writes++;
      await data.block.move({ location: { "parent-uid": parentUid, order }, block: { uid } });
    },

    async deleteBlock(uid) {
      stats.writes++;
      await data.block.delete({ block: { uid } });
    },

    async setOpen(uid, open) {
      stats.writes++;
      await data.block.update({ block: { uid, open } });
    },

    undo() { return data.undo(); },
    redo() { return data.redo(); },

    openInSidebar(uid, type = "block") {
      return api.ui.rightSidebar.addWindow({ window: { type, "block-uid": uid } });
    },
    openBlock(uid) { return api.ui.mainWindow.openBlock({ block: { uid } }); },

    renderString(el, string) { stats.renders++; return api.ui.components.renderString({ el, string }); },
    renderBlock(el, uid) { stats.renders++; return api.ui.components.renderBlock({ uid, el, "open?": true }); },
    renderPage(el, uid) { stats.renders++; return api.ui.components.renderPage({ uid, el }); },
    unmount(el) { return api.ui.components.unmountNode({ el }); },

    q(query, ...inputs) {
      return data.fast?.q ? data.fast.q(query, ...inputs) : data.q(query, ...inputs);
    },

    searchPages(text, limit = 40) {
      const needle = String(text ?? "").toLowerCase();
      if (!needle) return [];
      // Roam's Datascript has no clojure.string/lower-case; cljs re-pattern turns a leading (?i) into the JS flag.
      const rows = host.q(
        `[:find ?t ?u :in $ ?pat :where [?p :node/title ?t] [(re-pattern ?pat) ?re] [(re-find ?re ?t)] [?p :block/uid ?u]]`,
        ciPattern(needle),
      ) || [];
      return rows
        .filter(([t]) => typeof t === "string" && !t.startsWith("roam/"))
        .map(([t, u]) => ({ uid: u, title: t }))
        .sort((a, b) => {
          const ap = a.title.toLowerCase().startsWith(needle) ? 0 : 1;
          const bp = b.title.toLowerCase().startsWith(needle) ? 0 : 1;
          return ap - bp || a.title.length - b.title.length || a.title.localeCompare(b.title);
        })
        .slice(0, limit);
    },

    searchBlocks(text, limit = 40) {
      const needle = String(text ?? "").toLowerCase();
      if (!needle) return [];
      const rows = host.q(
        `[:find ?s ?u ?t :in $ ?pat :where [?b :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?t]]`,
        ciPattern(needle),
      ) || [];
      return rows
        .filter(([, , t]) => typeof t === "string" && !t.startsWith("roam/"))
        .slice(0, limit)
        .map(([s, u, t]) => ({ uid: u, string: s, pageTitle: t }));
    },

    related(ref, limit = 60) {
      const out = [];
      const seen = new Set();
      const push = (relation, target, text) => {
        const key = `${relation}|${target.kind}|${target.title ?? target.uid}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ relation, target, text });
      };
      let outgoing;
      let incoming;
      if (ref?.kind === "page") {
        outgoing = host.q(
          `[:find ?rt ?ss :in $ ?title :where [?p :node/title ?title] [?b :block/page ?p]
 [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]`,
          ref.title,
        );
        incoming = host.q(
          `[:find ?u ?ss :in $ ?title :where [?p :node/title ?title] [?b :block/refs ?p]
 [?b :block/uid ?u] [?b :block/string ?ss]]`,
          ref.title,
        );
      } else {
        outgoing = host.q(
          `[:find ?rt ?ss :in $ ?uid :where [?s :block/uid ?uid]
 (or [?b :block/parents ?s] [(= ?b ?s)])
 [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]`,
          ref?.uid,
        );
        incoming = host.q(
          `[:find ?u ?ss :in $ ?uid :where [?s :block/uid ?uid] [?b :block/refs ?s]
 [?b :block/uid ?u] [?b :block/string ?ss]]`,
          ref?.uid,
        );
      }
      for (const [rt, ss] of outgoing || []) {
        if (ref?.kind === "page" && rt === ref.title) continue;
        push(attrNameOf(ss) ?? "links to", { kind: "page", title: rt }, ss);
      }
      for (const [u, ss] of incoming || []) {
        if (u === ref?.uid) continue;
        push(attrNameOf(ss) ?? "linked from", { kind: "block", uid: u }, ss);
      }
      return out.slice(0, limit);
    },
  };
  return host;
}
