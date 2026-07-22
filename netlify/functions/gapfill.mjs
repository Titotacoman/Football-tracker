// Netlify scheduled function: the broadcast gap-filler cron.
// Runs less often than the poller since each lookup is a paid Claude call.
// Env vars required in the Netlify dashboard:
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   (optional) ANTHROPIC_MODEL
import { runBroadcastGapfill } from "../../scripts/lib/gapfill.mjs";

export default async () => {
  const result = await runBroadcastGapfill();
  return new Response(JSON.stringify(result));
};

// Every 6 hours.
export const config = { schedule: "0 */6 * * *" };
