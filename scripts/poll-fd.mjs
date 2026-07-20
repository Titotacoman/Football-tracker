// The football-data.org poller: fetches PL matches + standings and upserts
// normalized rows into Supabase. Idempotent — safe to run on every cron tick.
// Spends 2 of the 10 req/min football-data.org budget per run.
//
// This same flow becomes the Netlify scheduled function later; keep all
// logic in lib/ so the function is a thin wrapper.
import { loadEnv, requireKey, getJson } from "./lib/util.mjs";
import { db } from "./lib/supabase.mjs";
import { seasonYear, normalizeTeam, normalizeMatch, normalizeStandingRow } from "./lib/normalize-fd.mjs";

loadEnv();
const key = requireKey("FOOTBALL_DATA_KEY");
const BASE = "https://api.football-data.org/v4";
const HEADERS = { "X-Auth-Token": key };

// Honor the provider's auto-throttle contract: if the minute budget is
// exhausted, wait it out before the next call.
async function fdGet(path) {
  const res = await getJson(`${BASE}${path}`, HEADERS);
  const remaining = Number(res.headers.get("x-requests-available-minute") ?? 1);
  if (remaining < 1) {
    console.log("  rate limit reached, waiting 60s...");
    await new Promise((r) => setTimeout(r, 60_000));
  }
  if (res.status !== 200) {
    throw new Error(`football-data ${path} -> HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return res.body;
}

async function markSync(job, ok, note = null) {
  const now = new Date().toISOString();
  await db.upsert("sync_state", [{ job, last_run: now, ...(ok ? { last_ok: now } : {}), note }], "job");
}

console.log("== poll: football-data.org -> Supabase ==\n");

try {
  // 1. League row (PL). Provider ids per HANDOFF.md.
  const [league] = await db.upsert(
    "leagues",
    [{ code: "PL", name: "Premier League", country: "England", fd_id: 2021, tsdb_id: 4328, af_id: 39 }],
    "code",
  );
  console.log(`league: ${league.name} (id ${league.id})`);

  // 2. Current-season matches (single call returns all 380).
  const matchData = await fdGet("/competitions/PL/matches");
  const matches = matchData.matches;
  const season = seasonYear(matches[0].season);
  console.log(`fetched ${matches.length} matches, season ${season}-${(season + 1) % 100}`);

  // 3. Teams present in those matches.
  const fdTeams = new Map();
  for (const m of matches) {
    fdTeams.set(m.homeTeam.id, m.homeTeam);
    fdTeams.set(m.awayTeam.id, m.awayTeam);
  }
  const teamRows = await db.upsert("teams", [...fdTeams.values()].map(normalizeTeam), "fd_id");
  const teamIds = new Map(teamRows.map((t) => [t.fd_id, t.id]));
  console.log(`upserted ${teamRows.length} teams`);

  // 4. Matches.
  const matchRows = await db.upsert(
    "matches",
    matches.map((m) => normalizeMatch(m, league.id, teamIds)),
    "fd_id",
  );
  console.log(`upserted ${matchRows.length} matches`);

  // 5. Standings (TOTAL table).
  const standingsData = await fdGet("/competitions/PL/standings");
  const table = standingsData.standings.find((s) => s.type === "TOTAL")?.table ?? [];
  if (table.length) {
    await db.upsert(
      "standings",
      table.map((row) => normalizeStandingRow(row, league.id, season, teamIds)),
      "league_id,season,team_id",
    );
  }
  console.log(`upserted ${table.length} standings rows`);

  // 6. MVP tracking: ensure the PL itself is a tracked selection.
  const existing = await db.select("user_selections", { kind: "eq.league", league_id: `eq.${league.id}` });
  if (existing.length === 0) {
    await db.insert("user_selections", [{ kind: "league", league_id: league.id }]);
    console.log("added default selection: Premier League");
  }

  await markSync("fd:matches", true);
  await markSync("fd:standings", true);
  console.log("\nDone.");
} catch (err) {
  console.error(`\nPoll failed: ${err.message}`);
  await markSync("fd:matches", false, err.message.slice(0, 200)).catch(() => {});
  process.exit(1);
}
