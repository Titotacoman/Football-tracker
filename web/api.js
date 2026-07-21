// Data access: reads go browser -> Supabase REST (PostgREST) directly;
// the only writes go through the track function (service key stays server-side).
import { SUPABASE_URL, SUPABASE_KEY, FUNCTIONS_BASE } from "./config.js";

async function rest(path, params = {}) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}?${qs}`, {
    headers: { apikey: SUPABASE_KEY },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const TEAM_COLS = "id,name,short_name,tla,crest_url";
const MATCH_COLS = `id,utc_date,status,matchday,home_score,away_score,home_score_ht,away_score_ht,winner,referee,detail_status,broadcast,
  home:teams!matches_home_team_id_fkey(${TEAM_COLS}),
  away:teams!matches_away_team_id_fkey(${TEAM_COLS})`.replace(/\s+/g, "");

export const api = {
  nextTrackedMatch: async () => (await rest("next_tracked_match", { select: "*" }))[0] ?? null,

  trackedLeagues: () =>
    rest("user_selections", { select: "league:leagues(id,code,name)", kind: "eq.league", order: "league_id.asc" }),

  favoriteTeamIds: async () =>
    new Set((await rest("user_selections", { select: "team_id", kind: "eq.team" })).map((r) => r.team_id)),

  matchdays: (leagueId) =>
    rest("matches", {
      select: "matchday,status,utc_date",
      league_id: `eq.${leagueId}`,
      matchday: "not.is.null",
      order: "utc_date.asc",
    }),

  fixtures: (leagueId, matchday) =>
    rest("matches", {
      select: MATCH_COLS,
      league_id: `eq.${leagueId}`,
      matchday: `eq.${matchday}`,
      order: "utc_date.asc",
    }),

  match: async (id) => (await rest("matches", { select: MATCH_COLS, id: `eq.${id}` }))[0],

  matchEvents: (matchId) =>
    rest("match_events", {
      select: "type,minute,player_name,detail,team:teams(tla)",
      match_id: `eq.${matchId}`,
      order: "minute.asc",
    }),

  // Latest available season's table (standings can lag fixtures preseason).
  standings: async (leagueId) => {
    const rows = await rest("standings", {
      select: "season,grp,position,played,won,draw,lost,goals_for,goals_against,goal_diff,points,form,team:teams(id,name,tla,crest_url)",
      league_id: `eq.${leagueId}`,
      order: "season.desc,grp.asc.nullsfirst,position.asc",
    });
    return rows.filter((r) => r.season === rows[0]?.season);
  },

  // Date-mode fixtures for competitions without matchday numbers.
  upcoming: (leagueId, limit = 25) =>
    rest("matches", {
      select: MATCH_COLS,
      league_id: `eq.${leagueId}`,
      status: "in.(SCHEDULED,TIMED,IN_PLAY,PAUSED)",
      utc_date: `gte.${new Date(Date.now() - 12 * 3600_000).toISOString()}`,
      order: "utc_date.asc",
      limit: String(limit),
    }),

  results: (leagueId, limit = 25) =>
    rest("matches", {
      select: MATCH_COLS,
      league_id: `eq.${leagueId}`,
      status: "eq.FINISHED",
      order: "utc_date.desc",
      limit: String(limit),
    }),

  team: async (id) =>
    (await rest("teams", { id: `eq.${id}`, select: "id,name,short_name,tla,crest_url,stadium" }))[0],

  teamPlayers: (teamId) =>
    rest("players", {
      select: "id,name,position,shirt_number",
      team_id: `eq.${teamId}`,
      order: "name.asc",
    }),

  teamMatches: (teamId, leagueId) =>
    rest("matches", {
      select: MATCH_COLS,
      league_id: `eq.${leagueId}`,
      or: `(home_team_id.eq.${teamId},away_team_id.eq.${teamId})`,
      order: "utc_date.asc",
    }),

  fetchRoster: async (teamId, leagueCode) => {
    const res = await fetch(`${FUNCTIONS_BASE}/roster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId, league: leagueCode }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `roster: HTTP ${res.status}`);
    return body;
  },

  anyLive: async () =>
    (await rest("matches", { select: "id", status: "in.(IN_PLAY,PAUSED)", limit: "1" })).length > 0,

  // A live match among the given leagues, if any (for the hero).
  liveMatch: async (leagueIds) =>
    (await rest("matches", {
      select: `${MATCH_COLS},league:leagues(name)`,
      status: "in.(IN_PLAY,PAUSED)",
      league_id: `in.(${leagueIds.join(",")})`,
      order: "utc_date.asc",
      limit: "1",
    }))[0] ?? null,

  // Last n finished meetings between two teams (any tracked data).
  headToHead: (a, b, n = 5) =>
    rest("matches", {
      select: MATCH_COLS,
      or: `(and(home_team_id.eq.${a},away_team_id.eq.${b}),and(home_team_id.eq.${b},away_team_id.eq.${a}))`,
      status: "eq.FINISHED",
      order: "utc_date.desc",
      limit: String(n),
    }),

  // Last n finished matches for one team -> W/D/L form, newest first.
  teamForm: async (teamId, n = 5) => {
    const ms = await rest("matches", {
      select: "home_team_id,away_team_id,winner",
      or: `(home_team_id.eq.${teamId},away_team_id.eq.${teamId})`,
      status: "eq.FINISHED",
      order: "utc_date.desc",
      limit: String(n),
    });
    return ms.map((m) =>
      m.winner === "DRAW" ? "D"
      : (m.winner === "HOME_TEAM") === (m.home_team_id === teamId) ? "W" : "L");
  },

  // Newest successful sync -> data-freshness indicator.
  lastSync: async () =>
    (await rest("sync_state", { select: "last_ok", order: "last_ok.desc.nullslast", limit: "1" }))[0]?.last_ok ?? null,

  // Writes — via the track function.
  track: async (payload) => {
    const res = await fetch(`${FUNCTIONS_BASE}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `track: HTTP ${res.status}`);
    return body;
  },
};
