// npm run perf:ratchet — measure both boards and lower any ceiling the run beat.
// A count above its ceiling throws and the file is left unchanged.
import { measureCounts } from "../../test/fast-1-measure.js";
import { lowerCeilings } from "./perf-budgets.mjs";

const counts = await measureCounts();
const result = lowerCeilings(counts);
console.log(result.changed ? "lowered ceilings" : "ceilings hold");
