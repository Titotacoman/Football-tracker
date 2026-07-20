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
const MATCH_COLS = `id,utc_date,status,matchday,home_score,away_score,home_score_ht,away_score_ht,winner,referee,detail_status,
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
      select: "season,position,played,won,draw,lost,goals_for,goals_against,goal_diff,points,form,team:teams(id,name,tla,crest_url)",
      league_id: `eq.${leagueId}`,
      order: "season.desc,position.asc",
    });
    return rows.filter((r) => r.season === rows[0]?.season);
  },

  anyLive: async () =>
    (await rest("matches", { select: "id", status: "in.(IN_PLAY,PAUSED)", limit: "1" })).length > 0,

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
