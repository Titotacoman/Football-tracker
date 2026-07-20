// Read-only data access: browser -> Supabase REST (PostgREST), no backend.
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

async function rest(path, params = {}) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}?${qs}`, {
    headers: { apikey: SUPABASE_KEY },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const TEAM_COLS = "name,short_name,tla,crest_url";
const MATCH_COLS = `id,utc_date,status,matchday,home_score,away_score,home_score_ht,away_score_ht,winner,referee,detail_status,
  home:teams!matches_home_team_id_fkey(${TEAM_COLS}),
  away:teams!matches_away_team_id_fkey(${TEAM_COLS})`.replace(/\s+/g, "");

export const api = {
  nextTrackedMatch: async () => (await rest("next_tracked_match", { select: "*" }))[0] ?? null,

  matchdays: () =>
    rest("matches", { select: "matchday,status,utc_date", order: "utc_date.asc" }),

  fixtures: (matchday) =>
    rest("matches", {
      select: MATCH_COLS,
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

  standings: () =>
    rest("standings", {
      select: "position,played,won,draw,lost,goals_for,goals_against,goal_diff,points,form,team:teams(name,tla,crest_url)",
      order: "position.asc",
    }),

  anyLive: async () =>
    (await rest("matches", { select: "id", status: "in.(IN_PLAY,PAUSED)", limit: "1" })).length > 0,
};
