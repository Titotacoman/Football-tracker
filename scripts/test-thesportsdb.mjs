// TheSportsDB smoke test: tertiary metadata fallback.
// Free tier: 30 req/min; key "123" is the public test key. 3 requests.
import { loadEnv, saveSample, getJson } from "./lib/util.mjs";

loadEnv();
const key = process.env.THESPORTSDB_KEY || "123";
const BASE = `https://www.thesportsdb.com/api/v1/json/${key}`;
const EPL = 4328; // TheSportsDB's Premier League id

function report(label, { status, body }) {
  const items = body && Object.values(body)[0];
  console.log(`${label}: HTTP ${status}, items=${Array.isArray(items) ? items.length : items === null ? 0 : "?"}`);
}

console.log(`== TheSportsDB smoke test (key: ${key === "123" ? "public test key" : "personal"}) ==\n`);

// Next 25 EPL events.
const next = await getJson(`${BASE}/eventsnextleague.php?id=${EPL}`);
report("GET /eventsnextleague.php?id=4328", next);
saveSample("thesportsdb", "epl-next-events", next.body);

// League table for the upcoming season.
const table = await getJson(`${BASE}/lookuptable.php?l=${EPL}&s=2026-2027`);
report("GET /lookuptable.php?l=4328&s=2026-2027", table);
saveSample("thesportsdb", "epl-table-2026-27", table.body);

// Teams in the league — metadata (badges, stadiums) this provider is good for.
const teams = await getJson(`${BASE}/lookup_all_teams.php?id=${EPL}`);
report("GET /lookup_all_teams.php?id=4328", teams);
saveSample("thesportsdb", "epl-teams", teams.body);

console.log("\nDone. Raw payloads are in samples/thesportsdb/ for schema design.");
