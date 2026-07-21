// Core polling flow: football-data.org -> normalized rows -> Supabase.
// Shared by the local script (scripts/poll-fd.mjs), the Netlify scheduled
// function (poll cron), and the track function (immediate fill of a newly
// added league). Idempotent.
//
// Multi-league strategy (HANDOFF.md round-robin): poll only tracked
// leagues, at most MAX_LEAGUES_PER_RUN per tick to stay inside both the
// 10 req/min football-data cap and the function timeout. Leagues with a
// match in a ±3h window jump the queue; ties broken by stalest sync.
import { requireKey, getJson } from "./util.mjs";
import { db } from "./supabase.mjs";
import { seasonYear, normalizeTeam, normalizeMatch, normalizeStandingRow } from "./normalize-fd.mjs";
import { normalizeEspnTeam, normalizeEspnMatch, normalizeEspnStandingRow } from "./normalize-espn.mjs";
import { leagueByCode, leagueDbRow } from "./leagues.mjs";

const BASE = "https://api.football-data.org/v4";
const MAX_LEAGUES_PER_RUN = 3;
const LIVE_WINDOW_MS = 3 * 3600_000;

// Honor the provider's auto-throttle contract: if the minute budget is
// exhausted, wait it out before the next call.
async function fdGet(path, headers) {
  const res = await getJson(`${BASE}${path}`, headers);
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

// Ensure a league from the registry exists in the DB; returns the row.
export async function ensureLeague(code) {
  const reg = leagueByCode(code);
  if (!reg) throw new Error(`Unsupported league code: ${code}`);
  const [row] = await db.upsert("leagues", [leagueDbRow(reg)], "code");
  return row;
}

async function pollFdLeague(code, headers) {
  const league = await ensureLeague(code);

  const matchData = await fdGet(`/competitions/${code}/matches`, headers);
  const matches = matchData.matches ?? [];
  if (matches.length === 0) {
    console.log(`${code}: no fixtures published yet`);
    await markSync(`fd:${code}`, true, "no fixtures");
    return;
  }
  const season = seasonYear(matches[0].season);

  // Standings: only league-format tables (exactly one TOTAL table).
  // Cup group stages would interleave groups into one table — skip those.
  const standingsData = await fdGet(`/competitions/${code}/standings`, headers);
  const totals = (standingsData.standings ?? []).filter((s) => s.type === "TOTAL");

  // Teams can appear in standings but not in the fixtures list (or vice
  // versa) — collect from both so every team_id lookup resolves.
  const fdTeams = new Map();
  for (const m of matches) {
    fdTeams.set(m.homeTeam.id, m.homeTeam);
    fdTeams.set(m.awayTeam.id, m.awayTeam);
  }
  if (totals.length === 1) for (const row of totals[0].table) fdTeams.set(row.team.id, row.team);
  const teamRows = await db.upsert("teams", [...fdTeams.values()].map(normalizeTeam), "fd_id");
  const teamIds = new Map(teamRows.map((t) => [t.fd_id, t.id]));

  await db.upsert("matches", matches.map((m) => normalizeMatch(m, league.id, teamIds)), "fd_id");

  if (totals.length === 1) {
    // The standings payload can lag the fixtures (e.g. last season's final
    // table served preseason) — label it with its own season, not the fixtures'.
    const standingsSeason = standingsData.season ? seasonYear(standingsData.season) : season;
    await db.upsert(
      "standings",
      totals[0].table.map((row) => normalizeStandingRow(row, league.id, standingsSeason, teamIds)),
      "league_id,season,team_id",
    );
    // Sweep rows for teams no longer in this season's table (relegation,
    // or the provider swapping from last season's placeholder table).
    const currentIds = totals[0].table.map((row) => teamIds.get(row.team.id));
    await db.delete("standings", {
      league_id: `eq.${league.id}`,
      season: `eq.${standingsSeason}`,
      team_id: `not.in.(${currentIds.join(",")})`,
    });
  }

  await markSync(`fd:${code}`, true);
  console.log(`${code}: ${matches.length} matches, ${teamRows.length} teams, season ${season}`);
}

// ---- ESPN provider (public JSON API, no key) ------------------------------
const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const ESPN_V2 = "https://site.api.espn.com/apis/v2/sports/soccer";
const yyyymmdd = (d) => d.toISOString().slice(0, 10).replaceAll("-", "");

async function espnGet(url) {
  const res = await getJson(url);
  if (res.status !== 200) {
    throw new Error(`espn ${url.slice(ESPN_SITE.length)} -> HTTP ${res.status}`);
  }
  return res.body;
}

async function pollEspnLeague(code) {
  const reg = leagueByCode(code);
  const league = await ensureLeague(code);

  // Rolling season window: past 4 months + next ~7.5 covers calendar-year
  // leagues (MLS), cross-year leagues (Liga MX), and tournaments. ESPN
  // rejects ranges longer than ~a year, so keep the window under 12 months.
  const from = yyyymmdd(new Date(Date.now() - 120 * 86400_000));
  const to = yyyymmdd(new Date(Date.now() + 230 * 86400_000));
  const board = await espnGet(`${ESPN_SITE}/${reg.espn_slug}/scoreboard?dates=${from}-${to}&limit=1000`);
  const events = (board.events ?? []).filter((e) => e.competitions?.[0]?.competitors?.length === 2);
  if (events.length === 0) {
    console.log(`${code}: no events in window`);
    await markSync(`fd:${code}`, true, "no events");
    return;
  }

  const espnTeams = new Map();
  for (const e of events) {
    for (const c of e.competitions[0].competitors) espnTeams.set(Number(c.team.id), c.team);
  }
  const teamRows = await db.upsert("teams", [...espnTeams.values()].map(normalizeEspnTeam), "espn_id");
  const teamIds = new Map(teamRows.map((t) => [t.espn_id, t.id]));

  await db.upsert("matches", events.map((e) => normalizeEspnMatch(e, league.id, teamIds)), "espn_id");

  // Standings (leagues only — tournaments 404 or return empty).
  try {
    const table = await espnGet(`${ESPN_V2}/${reg.espn_slug}/standings`);
    const groups = (table.children ?? []).filter((c) => c.standings?.entries?.length);
    const multi = groups.length > 1;
    const season = table.seasons?.[0]?.year ?? events[0].season?.year ?? new Date().getFullYear();
    const rows = groups.flatMap((g) =>
      g.standings.entries
        .filter((e) => teamIds.has(Number(e.team.id)))
        .map((e, i) => normalizeEspnStandingRow(e, league.id, season, teamIds, multi ? g.name : null, i + 1)),
    );
    if (rows.length) {
      await db.upsert("standings", rows, "league_id,season,team_id");
      const currentIds = rows.map((r) => r.team_id);
      await db.delete("standings", {
        league_id: `eq.${league.id}`,
        season: `eq.${season}`,
        team_id: `not.in.(${currentIds.join(",")})`,
      });
    }
  } catch {
    console.log(`${code}: no standings available`);
  }

  await markSync(`fd:${code}`, true);
  console.log(`${code}: ${events.length} matches, ${teamRows.length} teams (espn)`);
}

function pollLeague(code) {
  const reg = leagueByCode(code);
  return reg.provider === "espn"
    ? pollEspnLeague(code)
    : pollFdLeague(code, { "X-Auth-Token": requireKey("FOOTBALL_DATA_KEY") });
}

async function pickRotation(trackedCodes, leagueIdsByCode) {
  const sync = await db.select("sync_state", { select: "job,last_ok" });
  const lastOk = new Map(sync.map((s) => [s.job, s.last_ok]));

  // Leagues with a match inside the live window get priority.
  const now = Date.now();
  const windowMatches = await db.select("matches", {
    select: "league_id",
    status: "in.(SCHEDULED,TIMED,IN_PLAY,PAUSED)",
    and: `(utc_date.gte.${new Date(now - LIVE_WINDOW_MS).toISOString()},utc_date.lte.${new Date(now + LIVE_WINDOW_MS).toISOString()})`,
  });
  const hotLeagueIds = new Set(windowMatches.map((m) => m.league_id));

  return trackedCodes
    .map((code) => ({
      code,
      hot: hotLeagueIds.has(leagueIdsByCode.get(code)) ? 0 : 1,
      age: lastOk.get(`fd:${code}`) ?? "", // "" sorts before any timestamp = never-synced first
    }))
    .sort((a, b) => a.hot - b.hot || (a.age < b.age ? -1 : 1))
    .slice(0, MAX_LEAGUES_PER_RUN)
    .map((l) => l.code);
}

// codes: poll exactly these leagues (used by the track function).
// Otherwise: rotate over tracked leagues.
export async function runPoll({ codes } = {}) {
  let targets = codes;
  if (!targets) {
    const selections = await db.select("user_selections", {
      select: "league:leagues(code,id)",
      kind: "eq.league",
    });
    if (selections.length === 0) {
      // Bootstrap: track the PL by default.
      const pl = await ensureLeague("PL");
      await db.insert("user_selections", [{ kind: "league", league_id: pl.id }]);
      selections.push({ league: { code: "PL", id: pl.id } });
    }
    const tracked = selections.map((s) => s.league.code);
    const idsByCode = new Map(selections.map((s) => [s.league.code, s.league.id]));
    targets = await pickRotation(tracked, idsByCode);
  }

  const results = {};
  for (const code of targets) {
    try {
      await pollLeague(code);
      results[code] = "ok";
    } catch (err) {
      console.error(`${code}: ${err.message}`);
      await markSync(`fd:${code}`, false, err.message.slice(0, 200)).catch(() => {});
      results[code] = err.message;
    }
  }
  return results;
}
