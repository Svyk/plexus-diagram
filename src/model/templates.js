// Board templates. A starter is a Roam-shaped tree. planTemplate clones it with fresh
// uids, rewrites ((refs)) that point inside the tree, and splits the creates into
// chunks of 45 so each chunk stays inside Roam's undo depth. The caller shows one
// Undo that deletes the inserted root. No Roam calls here.
import { planSubtreeClone } from "./clipboard.js";
import { boardString, edgeString } from "./schema.js";

export const TEMPLATE_PAGE = "Plexus Diagram/Templates";
export const TEMPLATE_WRITE_CAP = 45;

const node = (id, string, plexus, children = [], open = false) => ({
  ":block/uid": id,
  ":block/string": string,
  ":block/props": plexus ? { plexus } : undefined,
  ":block/children": children,
  ":block/open": open,
});

const card = (id, string, x, y, w = 260, h = 140) => node(id, string, { type: "card", x, y, w, h, v: 2 });
const section = (id, title, x, y, w = 300, h = 220) => node(id, title, { type: "section", x, y, w, h, v: 2 });
const board = (id, title, children) => node(id, boardString(title), { v: 2 }, children, false);

function flow(steps) {
  const cards = steps.map((title, i) => card(`s${i}`, title, 40 + i * 300, 80, 240, 120));
  const edges = steps.slice(1).map((_, i) => node(
    `e${i}`,
    edgeString({ srcRef: `((s${i}))`, dstRef: `((s${i + 1}))`, dir: "one" }),
    { type: "edge", from: `s${i}`, to: `s${i + 1}`, dir: "one" },
  ));
  return [...cards, node("edges", "Connections", { type: "edges" }, edges, false)];
}

const row = (labels, y = 40, w = 300, h = 360, gap = 24) => labels.map((title, i) => section(
  `c${i}`,
  title,
  40 + i * (w + gap),
  y,
  w,
  h,
));

export const STARTERS = [
  { id: "five-why", title: "5-Why", tree: board("root", "5-Why", [1, 2, 3, 4, 5].map((n) => card(`w${n}`, `Why ${n}`, 40, 40 + (n - 1) * 160))) },
  { id: "fishbone", title: "Fishbone (6M)", tree: board("root", "Fishbone (6M)", row(["Man", "Machine", "Method", "Material", "Measurement", "Environment"], 40, 240, 280, 16)) },
  { id: "8d", title: "8D", tree: board("root", "8D", row(["D1 Team", "D2 Problem", "D3 Containment", "D4 Root cause", "D5 Action", "D6 Implement", "D7 Prevent", "D8 Congratulate"], 40, 220, 240, 16)) },
  { id: "swot", title: "SWOT", tree: board("root", "SWOT", row(["Strengths", "Weaknesses", "Opportunities", "Threats"])) },
  { id: "kanban", title: "Kanban", tree: board("root", "Kanban", row(["To do", "Doing", "Done"])) },
  { id: "timeline", title: "Timeline", tree: board("root", "Timeline", ["Start", "Middle", "Next", "End"].map((title, i) => card(`t${i}`, title, 40 + i * 300, 80, 240, 120))) },
  { id: "process", title: "Process flow", tree: board("root", "Process flow", flow(["Receiving", "Storage", "Blending", "Filling", "Packing"])) },
  { id: "meeting", title: "Meeting notes", tree: board("root", "Meeting notes", row(["Agenda", "Notes", "Actions"])) },
  { id: "retro", title: "Retro", tree: board("root", "Retro", row(["Went well", "To improve", "Actions"])) },
];

export function starterById(id) {
  return STARTERS.find((s) => s.id === id) ?? null;
}

// Edge props store from/to uids. The string rewrite does not touch them.
export function rewriteEdgeEnds(creates, uidMap) {
  return creates.map((op) => {
    const px = op.props?.plexus;
    if (!px || px.type !== "edge") return op;
    const from = uidMap.has(px.from) ? uidMap.get(px.from) : px.from;
    const to = uidMap.has(px.to) ? uidMap.get(px.to) : px.to;
    return { ...op, props: { ...op.props, plexus: { ...px, from, to } } };
  });
}

export function chunkCreates(creates, cap = TEMPLATE_WRITE_CAP) {
  const size = cap > 0 ? cap : TEMPLATE_WRITE_CAP;
  const chunks = [];
  for (let i = 0; i < creates.length; i += size) chunks.push(creates.slice(i, i + size));
  return chunks;
}

// One delete of the inserted root removes the whole clone. That is the Undo action.
export function templateUndo(rootUid) {
  return rootUid ? { op: "delete", uid: rootUid } : null;
}

export function planCopy(tree, { genUid, parentUid, plexusPatch = null } = {}) {
  const plan = planSubtreeClone(tree, { genUid, parentUid, plexusPatch });
  const creates = rewriteEdgeEnds(plan.creates, plan.uidMap);
  return { rootUid: creates[0]?.uid ?? null, creates, chunks: chunkCreates(creates), uidMap: plan.uidMap };
}

export function planTemplate(id, opts) {
  const starter = starterById(id);
  if (!starter) return null;
  return { ...planCopy(starter.tree, opts), id: starter.id, title: starter.title };
}
