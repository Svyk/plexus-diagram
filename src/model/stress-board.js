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
