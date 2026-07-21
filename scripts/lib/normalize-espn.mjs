// Normalization layer for ESPN's public JSON API — maps scoreboard events
// and standings entries to the internal schema (db/schema.sql).

const STATUS_MAP = {
  STATUS_SCHEDULED: "SCHEDULED",
  STATUS_IN_PROGRESS: "IN_PLAY",
  STATUS_FIRST_HALF: "IN_PLAY",
  STATUS_SECOND_HALF: "IN_PLAY",
  STATUS_HALFTIME: "PAUSED",
  STATUS_END_OF_EXTRATIME: "IN_PLAY",
  STATUS_OVERTIME: "IN_PLAY",
  STATUS_SHOOTOUT: "IN_PLAY",
  STATUS_FINAL: "FINISHED",
  STATUS_FULL_TIME: "FINISHED",
  STATUS_FINAL_PEN: "FINISHED",
  STATUS_POSTPONED: "POSTPONED",
  STATUS_CANCELED: "CANCELLED",
  STATUS_SUSPENDED: "SUSPENDED",
  STATUS_DELAYED: "SUSPENDED",
  STATUS_ABANDONED: "SUSPENDED",
};

export function normalizeEspnTeam(t) {
  return {
    name: t.displayName,
    short_name: t.shortDisplayName ?? null,
    tla: t.abbreviation ?? null,
    crest_url: t.logo ?? t.logos?.[0]?.href ?? null,
    espn_id: Number(t.id),
  };
}

// event: one scoreboard event. teamIds: Map espn team id -> internal id.
export function normalizeEspnMatch(event, leagueId, teamIds) {
  const comp = event.competitions?.[0];
  const home = comp.competitors.find((c) => c.homeAway === "home");
  const away = comp.competitors.find((c) => c.homeAway === "away");
  const status = STATUS_MAP[event.status?.type?.name] ?? "SCHEDULED";
  const played = ["IN_PLAY", "PAUSED", "FINISHED"].includes(status);
  return {
    league_id: leagueId,
    season: event.season?.year ?? new Date(event.date).getFullYear(),
    matchday: event.week?.number ?? null,
    stage: comp?.type?.abbreviation ?? null,
    utc_date: event.date,
    status,
    home_team_id: teamIds.get(Number(home.team.id)),
    away_team_id: teamIds.get(Number(away.team.id)),
    home_score: played && home.score != null ? Number(home.score) : null,
    away_score: played && away.score != null ? Number(away.score) : null,
    winner:
      status !== "FINISHED" ? null
      : Number(home.score) > Number(away.score) ? "HOME_TEAM"
      : Number(away.score) > Number(home.score) ? "AWAY_TEAM"
      : "DRAW",
    espn_id: Number(event.id),
    last_updated: new Date().toISOString(),
  };
}

// entry: one standings entry; grp: conference/group label or null.
export function normalizeEspnStandingRow(entry, leagueId, season, teamIds, grp, fallbackPosition) {
  const stat = Object.fromEntries(entry.stats.map((s) => [s.name, s.value]));
  const gf = stat.pointsFor ?? 0;
  const ga = stat.pointsAgainst ?? 0;
  return {
    league_id: leagueId,
    season,
    team_id: teamIds.get(Number(entry.team.id)),
    position: stat.rank || fallbackPosition,
    played: stat.gamesPlayed ?? 0,
    won: stat.wins ?? 0,
    draw: stat.ties ?? 0,
    lost: stat.losses ?? 0,
    goals_for: gf,
    goals_against: ga,
    goal_diff: stat.pointDifferential ?? gf - ga,
    points: stat.points ?? 0,
    form: null,
    grp,
    updated_at: new Date().toISOString(),
  };
}
