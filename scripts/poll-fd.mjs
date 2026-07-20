// Local runner for the poll flow (npm run poll). The Netlify scheduled
// function (netlify/functions/poll.mjs) wraps the same code.
import { loadEnv } from "./lib/util.mjs";
import { runPoll } from "./lib/poll.mjs";

loadEnv();
console.log("== poll: football-data.org -> Supabase ==\n");
try {
  await runPoll();
  console.log("\nDone.");
} catch (err) {
  console.error(`\nPoll failed: ${err.message}`);
  process.exit(1);
}
