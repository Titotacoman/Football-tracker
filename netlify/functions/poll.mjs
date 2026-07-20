// Netlify scheduled function: the polling cron (hosting model B, HANDOFF.md).
// Env vars required in the Netlify dashboard:
//   FOOTBALL_DATA_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { runPoll } from "../../scripts/lib/poll.mjs";

export default async () => {
  const result = await runPoll();
  return new Response(JSON.stringify(result));
};

// Every 5 minutes (~8.6k invocations/mo, well under the 125k free cap).
export const config = { schedule: "*/5 * * * *" };
