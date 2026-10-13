// A 300-card board for the PF-2 timing run. Pure plan: the live script creates
// the chunks and ledgers the uids. Nothing here calls Roam.
import { edgeString } from "./schema.js";
import { planCopy } from "./templates.js";

export const STRESS_CARDS = 300;
export const STRESS_SECTIONS = 20;
export const STRESS_EDGES = 150;
export const STRESS_TITLE = "PF2 stress";

const CARDS_PER_SECTION = STRESS_CARDS / STRESS_SECTIONS;
const SECTION_COLS = 5;

const node = (id, string, plexus, children = [], open = false) => ({
  ":block/uid": id,
  ":block/string": string,
  ":block/props": plexus ? { plexus } : undefined,
  ":block/children": children,
  ":block/open": open,
});

export function stressBoardTree() {
  const cards = [];
  const sections = [];
  for (let s = 0; s < STRESS_SECTIONS; s += 1) {
    const col = s % SECTION_COLS;
    const row = Math.floor(s / SECTION_COLS);
    const kids = [];
    for (let c = 0; c < CARDS_PER_SECTION; c += 1) {
      const id = `card-${s}-${c}`;
      kids.push(node(id, `Card ${s + 1}.${c + 1}`, {
        type: "card",
        x: 24 + (c % 5) * 220,
        y: 48 + Math.floor(c / 5) * 150,
        w: 200,
        h: 120,
        v: 2,
      }));
      cards.push(id);
    }
    sections.push(node(
      `sec-${s}`,
      `Section ${s + 1}`,
      {
        type: "section",
        x: 40 + col * 1240,
        y: 40 + row * 600,
        w: 1200,
        h: 560,
        v: 2,
      },
      kids,
    ));
  }
  const edges = [];
  for (let i = 0; i < STRESS_EDGES; i += 1) {
    const from = cards[i];
    const to = cards[i + 1];
    edges.push(node(
      `edge-${i}`,
      edgeString({ srcRef: `((${from}))`, dstRef: `((${to}))` }),
      { type: "edge", from, to, dir: "one" },
    ));
  }
  const connections = node("edges", "Connections", { type: "edges" }, edges);
  return node("root", "{{[[diagram]]:PF2 stress}}", { v: 2 }, [...sections, connections]);
}

export function planStressBoard({ genUid, parentUid } = {}) {
  return planCopy(stressBoardTree(), { genUid, parentUid });
}

// A board shaped like the PhD main board (1,512 cards, 46 sections, 2,114 edges, 24 nested boards holding most of
// the blocks; ~22k blocks). Pure plan for the CI budgets in test/big-board-budgets.test.js; nothing here calls Roam.
export function bigBoardTree({ cards = 1500, sections = 46, edges = 2100, nested = 24, nestedCards = 120, nestedKids = 4, kids = 2 } = {}) {
  const perSection = Math.max(1, Math.ceil(cards / sections));
  const cols = 8;
  const cardUids = [];
  const children = [];
  let made = 0;
  for (let s = 0; s < sections && made < cards; s += 1) {
    const col = s % cols;
    const row = Math.floor(s / cols);
    const members = [];
    for (let c = 0; c < perSection && made < cards; c += 1) {
      const id = `bc${String(made).padStart(5, "0")}`;
      made += 1;
      const kidNodes = Array.from({ length: kids }, (_, k) => node(`${id}k${k}`, `Note ${made}.${k}`, null, [], false));
      members.push(node(id, `Card ${made}`, { type: "card", x: 24 + (c % 5) * 220, y: 48 + Math.floor(c / 5) * 150, w: 200, h: 120, v: 2 }, kidNodes));
      cardUids.push(id);
    }
    children.push(node(`bs${s}`, `Section ${s + 1}`, { type: "section", x: 40 + col * 1240, y: 40 + row * 1200, w: 1200, h: 1160, v: 2 }, members, false));
  }
  for (let n = 0; n < nested; n += 1) {
    const id = `bn${String(n).padStart(3, "0")}`;
    const inner = Array.from({ length: nestedCards }, (_, c) => node(`${id}c${c}`, `Inner ${c}`, { type: "card", x: (c % 10) * 220, y: Math.floor(c / 10) * 150, w: 200, h: 120, v: 2 },
      Array.from({ length: nestedKids }, (_, k) => node(`${id}c${c}k${k}`, `Inner note ${c}.${k}`, null, [], false)), false));
    children.push(node(id, `{{[[diagram]]:Nested ${n + 1}}}`, { type: "card", x: 40 + (n % cols) * 1240, y: 40 + (Math.ceil(sections / cols) + 1 + Math.floor(n / cols)) * 1200, w: 300, h: 200, v: 2 }, inner, false));
    cardUids.push(id);
  }
  const edgeNodes = [];
  for (let i = 0; i < edges; i += 1) {
    const from = cardUids[(i * 7) % cardUids.length];
    const to = cardUids[(i * 13 + 1) % cardUids.length];
    if (from === to) continue;
    edgeNodes.push(node(`be${String(i).padStart(5, "0")}`, edgeString({ srcRef: `((${from}))`, dstRef: `((${to}))` }), { type: "edge", from, to, dir: "one" }));
  }
  children.push(node("bedges", "Connections", { type: "edges" }, edgeNodes, false));
  return node("bigroot", "{{[[diagram]]:Big board}}", { v: 2 }, children, false);
}

export function treeBlockCount(tree) {
  let n = 0;
  const stack = [tree];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    n += 1;
    for (const kid of cur[":block/children"] || []) stack.push(kid);
  }
  return n;
}
