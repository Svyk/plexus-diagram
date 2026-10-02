import { isShowableCard, locateShowTarget } from "../model/deeplink.js";
import { attributeRows, boardsFromRows, tagNames } from "../model/info.js";
import { attrNameOf, mergePropsForWrite, parseBoardTitle, plainKeys } from "../model/schema.js";

export const BOARD_PATTERN = `[:block/uid :block/string :block/order :block/heading :block/open :block/props
 {:block/children [:block/uid :block/string :block/order :block/heading :block/open :block/props
   {:block/children [:block/uid :block/string :block/order :block/heading :block/open :block/props
     {:block/children ...}]}]}]`;

const ciPattern = (text) => `(?i)${String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;

export const NATIVE_PATTERN = `[:block/props
 {:diagram/nodes [:db/id :diagram.node/data {:diagram.node/block [:block/uid :block/string]} {:diagram.node/parent-node [:db/id]}]}
 {:diagram/edges [{:diagram.edge/source [:db/id]} {:diagram.edge/target [:db/id]} :diagram.edge/data]}]`;

const DIAGRAM_RE = "^\\{\\{(\\[\\[)?diagram";
const SHOW_DIRECT_QUERY = `[:find ?board ?page :in $ ?uid ?pat :where
 [?block :block/uid ?uid] [?block :block/parents ?diagram] [?diagram :block/uid ?board]
 [?diagram :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?diagram :block/page ?p] [?p :block/uid ?page]]`;
const SHOW_REF_QUERY = `[:find ?board ?page ?card :in $ ?uid ?pat :where
 [?target :block/uid ?uid] [?cardblock :block/refs ?target] [?cardblock :block/uid ?card]
 [?cardblock :block/parents ?diagram] [?diagram :block/uid ?board] [?diagram :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?diagram :block/page ?p] [?p :block/uid ?page]]`;
const BOARD_META_PATTERN = "[:block/props :edit/time {:block/children [:block/props]}]";

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
  const stats = { writes: 0, watches: 0, renders: 0, items: {} };
  const data = api.data;
  // Every data.block.* call is its own Roam undo entry. The log groups the calls of one session transaction
  // (host.group) so one undo()/redo() steps over the whole user operation. A write outside a group is its own step.
  // A group holds at most MAX_GROUP_WRITES writes: a larger transaction is split into consecutive groups (one plexus
  // undo entry, so one Cmd+Z, per chunk) so every entry stays inside Roam's own undo depth and undo never has to
  // clean up with deletes (those would land on Roam's stack and resurrect blocks on the next Cmd+Z).
  const undoLog = [];
  const redoLog = [];
  const UNDO_LOG_MAX = 200;
  const MAX_GROUP_WRITES = 45; // under Roam's undo depth (50)
  const UNDO_ECHO_MS = 900; // Roam echoes our own writes back through the pull watch; those are not foreign edits
  let openGroup = null;
  let lastWriteAt = -Infinity;
  const noteWrite = () => {
    lastWriteAt = Date.now();
    redoLog.length = 0;
    if (openGroup) {
      if (openGroup.n >= MAX_GROUP_WRITES) {
        undoLog.push(openGroup);
        if (undoLog.length > UNDO_LOG_MAX) undoLog.shift();
        openGroup = { n: 0 };
      }
      openGroup.n++;
      return;
    }
    undoLog.push({ n: 1 });
    if (undoLog.length > UNDO_LOG_MAX) undoLog.shift();
  };
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

    // Blocks that link to the page. The card's own [[title]] counts as one.
    pageRefCount(title) {
      const name = String(title ?? "");
      if (!name) return 0;
      let rows;
      try {
        rows = host.q("[:find (count ?b) :in $ ?t :where [?p :node/title ?t] [?b :block/refs ?p]]", name);
      } catch { return 0; }
      const n = Array.isArray(rows) ? rows[0]?.[0] : 0;
      const count = Number(n);
      return Number.isFinite(count) ? count : 0;
    },

    // One Roam undo step. Roam rewrites every [[old]] reference, including the card.
    // page.update takes the uid and the new title on the same page object.
    async renamePage(from, to) {
      const oldTitle = String(from ?? "").trim();
      const newTitle = String(to ?? "").trim();
      if (!oldTitle || !newTitle || oldTitle === newTitle) return false;
      const uid = host.pageUid(oldTitle);
      if (!uid) return false;
      stats.writes++;
      await data.page.update({ page: { uid, title: newTitle } });
      noteWrite();
      return true;
    },

    cardStringForUid(uid) {
      const id = String(uid ?? "").trim();
      if (!id) return null;
      let res;
      try { res = pull("[:block/uid :node/title]", eidKey(id)); } catch { return null; }
      if (!res?.[":block/uid"]) return null;
      const title = res[":node/title"];
      return typeof title === "string" && title ? `[[${title}]]` : `((${id}))`;
    },

    blockString(uid) {
      const res = pull("[:block/string]", eidKey(uid));
      return typeof res?.[":block/string"] === "string" ? res[":block/string"] : null;
    },

    // Page uid that owns a block. Empty when the block is missing or is itself a page.
    blockPageUid(uid) {
      let res = null;
      try { res = pull("[{:block/page [:block/uid]}]", eidKey(uid)); } catch { return ""; }
      const page = res?.[":block/page"];
      const node = Array.isArray(page) ? page[0] : page;
      const id = node?.[":block/uid"];
      return typeof id === "string" ? id : "";
    },

    // Page that owns a block. Empty when the block is missing or is itself a page.
    pageTitleOf(uid) {
      const res = pull("[{:block/page [:node/title]}]", eidKey(uid));
      const page = res?.[":block/page"];
      const node = Array.isArray(page) ? page[0] : page;
      const title = node?.[":node/title"];
      return typeof title === "string" ? title : "";
    },

    // Bytes for a graph file. Encrypted graphs only decrypt through file.get; the URL itself taints a canvas.
    async getFile(url) {
      const get = api.file?.get;
      if (typeof get !== "function") return null;
      const src = String(url ?? "").trim();
      if (!src) return null;
      try {
        return await get.call(api.file, { url: src });
      } catch {
        return null;
      }
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
      noteWrite();
      return id;
    },

    async updateString(uid, string) {
      stats.writes++;
      await data.block.update({ block: { uid, string } });
      noteWrite();
    },

    async updateProps(uid, plexus) {
      const merged = mergePropsForWrite(host.pullProps(uid), plexus);
      stats.writes++;
      await data.block.update({ block: { uid, props: merged } });
      noteWrite();
    },

    async moveBlock(uid, parentUid, order = "last") {
      stats.writes++;
      await data.block.move({ location: { "parent-uid": parentUid, order }, block: { uid } });
      noteWrite();
    },

    async deleteBlock(uid) {
      stats.writes++;
      await data.block.delete({ block: { uid } });
      noteWrite();
    },

    async setOpen(uid, open) {
      stats.writes++;
      await data.block.update({ block: { uid, open } });
      noteWrite();
    },

    // Runs fn (a serialized write sequence) as one undo step. Groups do not nest; the write queue serializes callers.
    async group(fn) {
      if (openGroup) return fn();
      openGroup = { n: 0 };
      try {
        return await fn();
      } finally {
        const g = openGroup; // the last chunk when the transaction rolled over
        openGroup = null;
        if (g.n) {
          undoLog.push(g);
          if (undoLog.length > UNDO_LOG_MAX) undoLog.shift();
        }
      }
    },

    // Undo/redo step over a whole recorded group; with nothing recorded (or after invalidateUndo) it is Roam's single step.
    async undo() {
      lastWriteAt = Date.now();
      const entry = undoLog.pop();
      const n = entry?.n ?? 1;
      let done = 0;
      try {
        for (; done < n; done++) await data.undo();
      } finally {
        lastWriteAt = Date.now();
        if (entry) {
          if (done >= n) redoLog.push(entry);
          else {
            if (done > 0) redoLog.push({ n: done });
            undoLog.push({ n: n - done }); // a failed step leaves the rest of the group undoable
          }
        }
      }
    },
    async redo() {
      lastWriteAt = Date.now();
      const entry = redoLog.pop();
      const n = entry?.n ?? 1;
      let done = 0;
      try {
        for (; done < n; done++) await data.redo();
      } finally {
        lastWriteAt = Date.now();
        if (entry) {
          if (done > 0) undoLog.push(done >= n ? entry : { n: done });
          if (done < n) redoLog.push({ n: n - done });
        }
      }
    },
    // Something else (a typed edit, another tool) touched the graph: the log no longer maps 1:1 onto Roam's stack.
    invalidateUndo() {
      if (openGroup || Date.now() - lastWriteAt < UNDO_ECHO_MS) return;
      undoLog.length = 0;
      redoLog.length = 0;
    },

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

    // Boards library: every enhanced (plexus.v === 2) board block in the graph. Read-only.
    listBoards({ limit = 200 } = {}) {
      const rows = host.q(
        `[:find ?u ?s ?pt ?pu :in $ ?pat :where [?b :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?pt] [?p :block/uid ?pu]]`,
        DIAGRAM_RE,
      ) || [];
      const out = [];
      for (const [uid, string, pageTitle, pageUid] of rows) {
        let res;
        try { res = pull(BOARD_META_PATTERN, eidKey(uid)); } catch { continue; }
        const props = res?.[":block/props"];
        if (!props || typeof props !== "object" || plainKeys(props)?.plexus?.v !== 2) continue;
        const kids = Array.isArray(res[":block/children"]) ? res[":block/children"] : [];
        const count = kids.filter((k) => {
          const kp = k?.[":block/props"];
          return !(kp && typeof kp === "object" && plainKeys(kp)?.plexus?.type === "edges");
        }).length;
        const edited = res[":edit/time"];
        out.push({
          uid,
          title: parseBoardTitle(string) || "Untitled board",
          pageTitle,
          pageUid,
          count,
          edited: Number.isFinite(edited) ? edited : null,
        });
      }
      out.sort((a, b) => String(a.pageTitle).localeCompare(String(b.pageTitle)) || a.title.localeCompare(b.title));
      return out.slice(0, limit);
    },

    // Card footer stats for many targets in at most four datalog queries.
    cardStats(targets, { boardUid } = {}) {
      const result = new Map();
      const byEid = new Map();
      for (const t of targets || []) {
        if (!t) continue;
        const ref = t.kind === "page" ? (t.title ? { title: t.title } : null) : t.uid ? { uid: t.uid } : null;
        if (!ref) continue;
        const key = t.kind === "page" ? `page:${t.title}` : `uid:${t.uid}`;
        if (result.has(key)) continue;
        result.set(key, { refs: 0, boards: 0, open: 0, done: 0 });
        const eid = host.resolveEid(ref);
        if (eid == null) continue;
        if (!byEid.has(eid)) byEid.set(eid, []);
        byEid.get(eid).push(key);
      }
      if (!byEid.size) return result;
      const eids = [...byEid.keys()];
      const boardEid = boardUid ? host.resolveEid({ uid: boardUid }) ?? -1 : -1;
      const tally = (rows, field) => {
        const seen = new Map();
        for (const [t, x] of rows || []) {
          if (!seen.has(t)) seen.set(t, new Set());
          seen.get(t).add(x);
        }
        for (const [t, set] of seen) for (const key of byEid.get(t) ?? []) result.get(key)[field] = set.size;
      };
      tally(host.q(
        `[:find ?t ?b :in $ [?t ...] ?board :where [?b :block/refs ?t] (not [?b :block/parents ?board]) [(not= ?b ?board)]]`,
        eids, boardEid,
      ), "refs");
      tally(host.q(
        `[:find ?t ?d :in $ [?t ...] ?board ?pat :where [?b :block/refs ?t] [?b :block/parents ?d] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [(not= ?d ?board)]]`,
        eids, boardEid, DIAGRAM_RE,
      ), "boards");
      const todoEid = host.resolveEid({ title: "TODO" });
      const doneEid = host.resolveEid({ title: "DONE" });
      const listFor = (statusEid) => host.q(
        `[:find ?t ?x :in $ [?t ...] ?status :where [?x :block/refs ?status] (or [?x :block/parents ?t] [?x :block/page ?t])]`,
        eids, statusEid,
      );
      if (todoEid != null) tally(listFor(todoEid), "open");
      if (doneEid != null) tally(listFor(doneEid), "done");
      return result;
    },

    async uploadFile(file) {
      const upload = api.file?.upload;
      if (typeof upload !== "function") throw new Error("upload-unavailable");
      const res = await upload.call(api.file, { file });
      const raw = typeof res === "string" ? res : res?.url;
      // Roam's file.upload resolves to a ready-made markdown image (`![](url)`); callers want the bare URL.
      const md = typeof raw === "string" ? /^\s*!\[[^\]]*\]\((.+)\)\s*$/s.exec(raw) : null;
      const url = md ? md[1] : raw;
      if (typeof url !== "string" || !url) throw new Error("upload-failed");
      stats.writes++;
      return url;
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

    // Graph neighbours of a card target, ordered for the Related panel:
    // attribute relations (both directions) → pages it links to → pages that link to it (grouped, counted).
    // The attribute-name page itself is not a neighbour, and blocks inside the current board are skipped.
    related(ref, limit = 60, { boardUid } = {}) {
      if (!ref || (ref.kind === "page" ? !ref.title : !ref.uid)) return [];
      const boardEid = boardUid ? host.resolveEid({ uid: boardUid }) ?? -1 : -1;
      const byPage = ref.kind === "page";
      const outgoing = host.q(
        byPage
          ? `[:find ?rt ?ss :in $ ?title :where [?p :node/title ?title] [?b :block/page ?p] [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]`
          : `[:find ?rt ?ss :in $ ?uid :where [?s :block/uid ?uid] (or [?b :block/parents ?s] [(= ?b ?s)]) [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]`,
        byPage ? ref.title : ref.uid,
      ) || [];
      const incoming = host.q(
        byPage
          ? `[:find ?u ?ss ?pt :in $ ?title ?board :where [?p :node/title ?title] [?b :block/refs ?p] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`
          : `[:find ?u ?ss ?pt :in $ ?uid ?board :where [?s :block/uid ?uid] [?b :block/refs ?s] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`,
        byPage ? ref.title : ref.uid,
        boardEid,
      ) || [];
      const attrs = [];
      const links = [];
      const pages = new Map();
      const seen = new Set();
      const add = (list, relation, target, text) => {
        const key = `${relation}|${target.kind}|${target.title ?? target.uid}`;
        if (seen.has(key)) return;
        seen.add(key);
        list.push({ relation, target, text });
      };
      for (const [rt, ss] of outgoing) {
        const attr = attrNameOf(ss);
        if (attr && rt === attr) continue; // the attribute's own name page
        if (byPage && rt === ref.title) continue;
        if (attr) add(attrs, `${attr} →`, { kind: "page", title: rt }, rt);
        else add(links, "links to", { kind: "page", title: rt }, rt);
      }
      for (const [u, ss, pt] of incoming) {
        if (u === ref.uid || (byPage && pt === ref.title)) continue;
        const attr = attrNameOf(ss);
        if (attr) { add(attrs, `← ${attr}`, { kind: "page", title: pt }, pt); continue; }
        const g = pages.get(pt) || { count: 0 };
        g.count += 1;
        pages.set(pt, g);
      }
      const linkedFrom = [...pages.entries()]
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
        .map(([pt, g]) => ({ relation: "linked from", target: { kind: "page", title: pt }, text: g.count > 1 ? `${pt} (${g.count})` : pt }));
      return [...attrs, ...links, ...linkedFrom].slice(0, limit);
    },

    // Info panel. Page-card attributes come from the page's children, not the [[title]] card.
    // Two board queries: diagrams that parent the card, and diagrams that parent a block which refs the target.
    cardInfo(item, { refLimit = 20, boardLimit = 20 } = {}) {
      if (!item || item.type === "section") return null;
      const kind = item.target?.kind || "self";
      const cardUid = String(item.uid ?? "");
      const targetUid = kind === "block" ? String(item.target?.uid || cardUid) : cardUid;
      const pageTitle = kind === "page" ? String(item.target?.title || item.title || "") : "";
      let pageUid = null;
      let body = String(item.string ?? "");
      let attrSource = [];
      if (pageTitle) {
        const page = host.pullPage(pageTitle);
        pageUid = page?.[":block/uid"] ?? null;
        const kids = Array.isArray(page?.[":block/children"]) ? page[":block/children"] : [];
        attrSource = kids.map((k) => k?.[":block/string"] ?? "");
        body = pageTitle;
      } else if (targetUid) {
        let res = null;
        try { res = pull("[:block/string {:block/children [:block/string]}]", eidKey(targetUid)); } catch { res = null; }
        if (res) {
          body = res[":block/string"] ?? body;
          const kids = Array.isArray(res[":block/children"]) ? res[":block/children"] : [];
          attrSource = kids.map((k) => k?.[":block/string"] ?? "");
        }
      }
      const parentRows = cardUid
        ? host.q(
          `[:find ?u ?s ?pt :in $ ?uid ?pat :where [?c :block/uid ?uid] [?c :block/parents ?d] [?d :block/uid ?u] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?d :block/page ?p] [?p :node/title ?pt]]`,
          cardUid,
          DIAGRAM_RE,
        ) || []
        : [];
      const viaRows = (pageTitle || targetUid)
        ? host.q(
          pageTitle
            ? `[:find ?u ?s ?pt :in $ ?title ?pat :where [?t :node/title ?title] [?b :block/refs ?t] [?b :block/parents ?d] [?d :block/uid ?u] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?d :block/page ?p] [?p :node/title ?pt]]`
            : `[:find ?u ?s ?pt :in $ ?uid ?pat :where [?c :block/uid ?uid] [?b :block/refs ?c] [?b :block/parents ?d] [?d :block/uid ?u] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?d :block/page ?p] [?p :node/title ?pt]]`,
          pageTitle || targetUid,
          DIAGRAM_RE,
        ) || []
        : [];
      const refRows = (pageTitle || targetUid)
        ? host.q(
          pageTitle
            ? `[:find ?u ?ss ?pt :in $ ?title :where [?p :node/title ?title] [?b :block/refs ?p] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`
            : `[:find ?u ?ss ?pt :in $ ?uid :where [?c :block/uid ?uid] [?b :block/refs ?c] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`,
          pageTitle || targetUid,
        ) || []
        : [];
      const rawBoards = [];
      for (const [uid, string, pt] of [...parentRows, ...viaRows]) {
        if (!uid) continue;
        let props = {};
        try { props = host.pullProps(uid); } catch { continue; }
        if (props?.plexus?.v !== 2) continue;
        rawBoards.push({
          uid,
          title: parseBoardTitle(string) || "Untitled board",
          pageTitle: pt || "",
          v: 2,
        });
      }
      const refs = [];
      const seenRef = new Set();
      for (const [uid, string, pt] of refRows) {
        if (!uid || uid === cardUid || seenRef.has(uid)) continue;
        seenRef.add(uid);
        refs.push({ uid, string: String(string ?? "").slice(0, 160), pageTitle: pt || "" });
        if (refs.length >= refLimit) break;
      }
      return {
        kind,
        uid: pageTitle ? pageUid : targetUid,
        cardUid,
        pageUid,
        title: item.title || pageTitle || "",
        body,
        attributes: attributeRows(attrSource),
        refs,
        boards: boardsFromRows(rawBoards, { limit: boardLimit }),
        tags: tagNames([body, ...attrSource].join("\n")),
      };
    },

    // Where "Show on board" should land. Read-only. A placed card on a v2 board wins over a card that merely refs the block.
    showOnBoard(uid) {
      const id = String(uid ?? "").trim();
      if (!id) return null;
      const propsOf = (blockUid) => {
        try { return host.pullProps(blockUid); } catch { return {}; }
      };
      let direct = [];
      let via = [];
      try {
        direct = host.q(SHOW_DIRECT_QUERY, id, DIAGRAM_RE) || [];
        via = host.q(SHOW_REF_QUERY, id, DIAGRAM_RE) || [];
      } catch {
        return null;
      }
      const boardOk = new Map();
      const enhanced = (boardUid) => {
        if (!boardOk.has(boardUid)) boardOk.set(boardUid, propsOf(boardUid)?.plexus?.v === 2);
        return boardOk.get(boardUid);
      };
      const placements = [];
      for (const row of direct) {
        const boardUid = row?.[0];
        const pageUid = row?.[1];
        if (!boardUid || !pageUid || !enhanced(boardUid)) continue;
        if (!isShowableCard(propsOf(id)?.plexus)) continue;
        placements.push({ boardUid, pageUid, cardUid: id, refUids: [] });
      }
      for (const row of via) {
        const boardUid = row?.[0];
        const pageUid = row?.[1];
        const cardUid = row?.[2];
        if (!boardUid || !pageUid || !cardUid || cardUid === id || !enhanced(boardUid)) continue;
        if (!isShowableCard(propsOf(cardUid)?.plexus)) continue;
        placements.push({ boardUid, pageUid, cardUid, refUids: [id] });
      }
      return locateShowTarget(id, placements);
    },
  };
  return host;
}
