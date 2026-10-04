// Build a board of Better Tasks task cards on Plexus Diagram/Test Lab and ledger every uid.
//   node tools/live/taskboard.mjs [windowSel] [--count N] [--repeat-every K] [--title T]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEntry, roamEval } from "./ledger.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "taskboard-page.js"), "utf8");
const argv = process.argv.slice(2);
const flag = (name, d) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : d; };
const windowSel = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")) || "Readwisenotes - Plexus";
const spec = { count: Number(flag("--count", 40)), repeatEvery: Number(flag("--repeat-every", 0)), title: flag("--title", "") || undefined };
roamEval(windowSel, `globalThis.__pxdTaskBoardSpec = ${JSON.stringify(spec)};\n${source}`);
let state;
for (let i = 0; i < 600; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  state = roamEval(windowSel, "JSON.stringify(window.__pxdTaskBoard)");
  if (typeof state === "string") state = JSON.parse(state);
  if (state.done) break;
}
const graph = "";
for (const row of state.uids || []) appendEntry({ uid: row.uid, why: row.why, page: "Plexus Diagram/Test Lab", graph });
console.log(JSON.stringify({ done: state.done, made: state.made, boardUid: state.boardUid, error: state.error, notes: state.notes, ledgered: (state.uids || []).length }, null, 1));
