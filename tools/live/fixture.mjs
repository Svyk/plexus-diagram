// Build a phase fixture board on Plexus Diagram/Test Lab through the live session API.
//   node tools/live/fixture.mjs <phase> [titleSubstring] [--cards N]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEntry, roamEval } from "./ledger.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, "fixture-page.js"), "utf8");

function args(argv) {
  const positional = [];
  let cards = 0;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--cards") { cards = Number(argv[i + 1]) || 0; i += 1; }
    else positional.push(argv[i]);
  }
  return { phase: positional[0] || "0", windowSel: positional[1] || "Readwisenotes - Daily Notes", cards };
}

const { phase, windowSel, cards } = args(process.argv.slice(2));
const expr = `globalThis.__pxdFixture = ${JSON.stringify({ phase, cards })};\n${pageSource}`;
try {
  const raw = roamEval(windowSel, expr);
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!result?.ok) {
    console.error(JSON.stringify(result, null, 1));
    process.exit(1);
  }
  for (const row of result.uids || []) {
    appendEntry({ uid: row.uid, why: `${result.boardTitle}: ${row.why}`, page: result.page, graph: result.graph });
  }
  console.log(JSON.stringify({ ...result, ledgered: (result.uids || []).length }, null, 1));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
