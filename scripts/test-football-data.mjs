// football-data.org smoke test: the fixtures/standings backbone.
// Free tier: 10 req/min. This script spends 3 requests.
import { loadEnv, requireKey, saveSample, getJson } from "./lib/util.mjs";

loadEnv();
const key = requireKey("FOOTBALL_DATA_KEY");
const BASE = "https://api.football-data.org/v4";
const HEADERS = { "X-Auth-Token": key };

function report(label, { status, body }) {
  const count = body?.matches?.length ?? body?.standings?.length ?? body?.count;
  console.log(`${label}: HTTP ${status}${count !== undefined ? `, items=${count}` : ""}${body?.message ? `, message=${body.message}` : ""}`);
}

console.log("== football-data.org smoke test ==\n");

// Upcoming PL fixtures (current season by default).
const scheduled = await getJson(`${BASE}/competitions/PL/matches?status=SCHEDULED`, HEADERS);
report("GET /competitions/PL/matches?status=SCHEDULED", scheduled);
saveSample("football-data", "pl-matches-scheduled", scheduled.body);

// Recent finished matches — shows what a completed-match payload looks like.
const finished = await getJson(`${BASE}/competitions/PL/matches?status=FINISHED&season=2025`, HEADERS);
report("GET /competitions/PL/matches?status=FINISHED&season=2025", finished);
saveSample("football-data", "pl-matches-finished-2025", finished.body);

// Standings.
const standings = await getJson(`${BASE}/competitions/PL/standings`, HEADERS);
report("GET /competitions/PL/standings", standings);
saveSample("football-data", "pl-standings", standings.body);

console.log("\nDone. Raw payloads are in samples/football-data/ for schema design.");
