// Local runner for the broadcast gap-filler (npm run gapfill).
// Optional arg: max lookups this run, e.g. `npm run gapfill -- 3`.
import { loadEnv } from "./lib/util.mjs";
import { runBroadcastGapfill } from "./lib/gapfill.mjs";

loadEnv();
const max = Number(process.argv[2]) || undefined;
console.log("== broadcast gap-filler (Claude + web search) ==\n");
try {
  const result = await runBroadcastGapfill({ max });
  console.log(`\nDone. Checked ${result.checked}, filled ${result.filled}.`);
} catch (err) {
  console.error(`\nGap-fill failed: ${err.message}`);
  process.exit(1);
}
