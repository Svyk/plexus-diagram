// P8 U3. The board read of a cold open in short tasks: one recursive BOARD_PATTERN pull of the PhD main board is one
// 0.6-0.7 s task (28,412 blocks), and one card's subtree alone can be 150 ms, so the read goes level by level, BATCH
// blocks per pull_many with their children as eid stubs (live: <= 31 ms per call). The result has the shape of the
// BOARD_PATTERN pull. It is only handed over when it is consistent: the page stamp (:page/edit-time and
// :page/edit-nonce, moved by every string, props, create, move and delete on the page) is the same before the first
// level and after the last, every block read is still there, and the folds (:block/open, which does NOT move the stamp)
// are read again at the end and patched in. Anything else returns null and the caller reads the board in one pull.

export const SLICED_LEVEL_PATTERN = "[:db/id :block/uid :block/string :block/order :block/heading :block/open :block/props {(limit :block/children nil) [:db/id]}]";
export const SLICED_OPEN_PATTERN = "[:db/id :block/open]";
export const SLICED_BATCH = 500;
export const SLICED_OPEN_BATCH = 2000;
export const SLICED_SLICE_MS = 40;

// deps: pullMany(pattern, eids) -> nodes (null for a missing eid), stamp() -> string|null, clock() -> ms.
export function createSlicedRead({ rootEid, pullMany, stamp, clock = () => Date.now(), sliceMs = SLICED_SLICE_MS, batch = SLICED_BATCH, openBatch = SLICED_OPEN_BATCH } = {}) {
  const nodes = new Map();
  let frontier = rootEid == null ? [] : [rootEid];
  let next = [];
  let at = 0;
  let withKids = [];
  let openAt = 0;
  let phase = rootEid == null ? "failed" : "read";
  let tree = null;
  let first = null;
  let calls = 0;
  let readMs = 0;
  try { first = stamp(); } catch { first = null; }
  if (first == null) phase = "failed";

  const fail = () => { phase = "failed"; nodes.clear(); frontier = []; next = []; withKids = []; };

  function readPart() {
    const ids = frontier.slice(at, at + batch);
    at += ids.length;
    const res = pullMany(SLICED_LEVEL_PATTERN, ids);
    calls += 1;
    if (!Array.isArray(res) || res.length !== ids.length) return fail();
    for (let i = 0; i < ids.length; i += 1) {
      const n = res[i];
      // A block deleted between two levels: the read is not the board any more.
      if (!n || n[":db/id"] !== ids[i] || typeof n[":block/uid"] !== "string") return fail();
      nodes.set(ids[i], n);
      const kids = n[":block/children"];
      if (Array.isArray(kids)) for (const k of kids) next.push(k?.[":db/id"]);
    }
    if (at >= frontier.length) {
      if (next.some((id) => id == null || nodes.has(id))) return fail();
      frontier = next;
      next = [];
      at = 0;
      if (!frontier.length) {
        phase = "folds";
        for (const [id, n] of nodes) if (Array.isArray(n[":block/children"]) && n[":block/children"].length) withKids.push(id);
      }
    }
  }

  // Folds do not move the page stamp: read every fold that matters (blocks with children) again and keep Roam's.
  function foldPart() {
    const ids = withKids.slice(openAt, openAt + openBatch);
    openAt += ids.length;
    if (ids.length) {
      const res = pullMany(SLICED_OPEN_PATTERN, ids);
      calls += 1;
      if (!Array.isArray(res) || res.length !== ids.length) return fail();
      for (let i = 0; i < ids.length; i += 1) {
        const n = nodes.get(ids[i]);
        const now = res[i];
        if (!now) return fail();
        if (Object.prototype.hasOwnProperty.call(now, ":block/open")) n[":block/open"] = now[":block/open"];
        else delete n[":block/open"];
      }
    }
    if (openAt >= withKids.length) phase = "assemble";
  }

  function assemble() {
    const build = (id) => {
      const n = nodes.get(id);
      const out = {};
      for (const k in n) if (k !== ":db/id" && k !== ":block/children") out[k] = n[k];
      const kids = n[":block/children"];
      if (Array.isArray(kids)) out[":block/children"] = kids.map((k) => build(k[":db/id"]));
      return out;
    };
    let last = null;
    try { last = stamp(); } catch { last = null; }
    if (last == null || last !== first) return fail();
    tree = build(rootEid);
    nodes.clear();
    phase = "done";
  }

  // One task's worth: parts until `sliceMs` is spent (one part at least). True when finished (done or failed).
  function step() {
    const t0 = clock();
    try {
      do {
        if (phase === "read") readPart();
        else if (phase === "folds") foldPart();
        else if (phase === "assemble") assemble();
        else break;
      } while (phase !== "done" && phase !== "failed" && clock() - t0 < sliceMs);
    } catch {
      fail();
    }
    readMs += clock() - t0;
    return phase === "done" || phase === "failed";
  }

  return {
    step,
    get phase() { return phase; },
    get stamp() { return first; },
    get calls() { return calls; },
    get ms() { return readMs; },
    // The tree when done and consistent, else null. Taking it twice gives null.
    take() {
      const out = phase === "done" ? tree : null;
      tree = null;
      return out;
    },
    cancel() { if (phase !== "done") fail(); },
  };
}
