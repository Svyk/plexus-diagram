// Datalog behind query cards. Every read is one bounded q call; the caller yields between them.
// A page or block ref matches what Roam's query does: the blocks that cite it, the blocks under those,
// and (for a page) the blocks on it. A hot page skips the wide steps and says the result is partial.

export const DIRECT_CAP = 3000;
export const WIDE_LIMIT = 1500;
export const PAGE_LIMIT = 2000;
const CHUNK = 200;
const DETAIL_CHUNK = 50;

const col = (rows) => (Array.isArray(rows) ? rows.map((r) => r?.[0]).filter((u) => typeof u === "string") : []);
const num = (rows) => Number(rows?.[0]?.[0]) || 0;

function entityClause(leaf) {
  return leaf.op === "page"
    ? { where: "[?p :node/title ?k]", input: leaf.title }
    : { where: "[?p :block/uid ?k]", input: leaf.uid };
}

export function createQueryBackend(host) {
  const q = (query, ...inputs) => {
    const rows = host.q(query, ...inputs);
    return Array.isArray(rows) ? rows : [];
  };

  return {
    hits(leaf) {
      const { where, input } = entityClause(leaf);
      const refs = `${where} [?r :block/refs ?p]`;
      const direct = num(q(`[:find (count ?r) :in $ ?k :where ${refs}]`, input));
      const uids = new Set();
      let partial = false;
      if (direct > DIRECT_CAP) {
        // Too wide to read in one pass: newest-looking slice is not knowable, so say so and read none.
        return { uids: [], partial: true };
      }
      for (const u of col(q(`[:find ?u :in $ ?k :where ${refs} [?r :block/uid ?u]]`, input))) uids.add(u);
      if (direct <= WIDE_LIMIT) {
        for (const u of col(q(`[:find ?u :in $ ?k :where ${refs} [?b :block/parents ?r] [?b :block/uid ?u]]`, input))) uids.add(u);
      } else partial = true;
      if (leaf.op === "page") {
        const onPage = num(q("[:find (count ?b) :in $ ?k :where [?p :node/title ?k] [?b :block/page ?p]]", input));
        if (onPage <= PAGE_LIMIT) {
          for (const u of col(q("[:find ?u :in $ ?k :where [?p :node/title ?k] [?b :block/page ?p] [?b :block/uid ?u]]", input))) uids.add(u);
        } else partial = true;
      }
      return { uids: [...uids], partial };
    },

    // uid -> last edit time (create time when never edited).
    times(uids) {
      const out = new Map();
      for (let i = 0; i < uids.length; i += CHUNK) {
        const rows = q("[:find ?u ?t :in $ [?u ...] :where [?b :block/uid ?u] [(get-else $ ?b :edit/time 0) ?t]]", uids.slice(i, i + CHUNK));
        for (const [u, t] of rows) out.set(u, Number(t) || 0);
      }
      return out;
    },

    details(uids) {
      const by = new Map();
      for (let i = 0; i < uids.length; i += DETAIL_CHUNK) {
        const chunk = uids.slice(i, i + DETAIL_CHUNK);
        for (const [u, s, title, t] of q(
          "[:find ?u ?s ?title ?t :in $ [?u ...] :where [?b :block/uid ?u] [(get-else $ ?b :block/string \"\") ?s] [(get-else $ ?b :node/title \"\") ?title] [(get-else $ ?b :edit/time 0) ?t]]",
          chunk,
        )) by.set(u, { uid: u, string: s, title, time: Number(t) || 0 });
        for (const [u, page] of q("[:find ?u ?pt :in $ [?u ...] :where [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?pt]]", chunk)) {
          const d = by.get(u);
          if (d) d.page = page;
        }
        for (const [u, parent] of q("[:find ?u ?ps :in $ [?u ...] :where [?b :block/uid ?u] [?pa :block/children ?b] [?pa :block/string ?ps]]", chunk)) {
          const d = by.get(u);
          if (d) d.parent = parent;
        }
      }
      return [...by.values()];
    },
  };
}
