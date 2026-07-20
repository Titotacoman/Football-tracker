// Normalization layer for football-data.org (v4) — maps provider JSON to
// the internal schema (db/schema.sql). Shapes verified against samples/.

// season.startDate "2026-08-21" -> 2026 (internal season = start year)
export function seasonYear(season) {
  return Number(season.startDate.slice(0, 4));
}

export function normalizeTeam(t) {
  return {
    name: t.name,
    short_name: t.shortName ?? null,
    tla: t.tla ?? null,
    crest_url: t.crest ?? null,
    fd_id: t.id,
  };
}

// teamIds: Map of fd team id -> internal teams.id
export function normalizeMatch(m, leagueId, teamIds) {
  return {
    league_id: leagueId,
    season: seasonYear(m.season),
    matchday: m.matchday ?? null,
    stage: m.stage ?? null,
    utc_date: m.utcDate,
    status: m.status,
    home_team_id: teamIds.get(m.homeTeam.id),
    away_team_id: teamIds.get(m.awayTeam.id),
    home_score: m.score.fullTime.home,
    away_score: m.score.fullTime.away,
    home_score_ht: m.score.halfTime.home,
    away_score_ht: m.score.halfTime.away,
    winner: m.score.winner ?? null,
    referee: m.referees?.[0]?.name ?? null,
    fd_id: m.id,
    last_updated: m.lastUpdated,
  };
}

export function normalizeStandingRow(row, leagueId, season, teamIds) {
  return {
    league_id: leagueId,
    season,
    team_id: teamIds.get(row.team.id),
    position: row.position,
    played: row.playedGames,
    won: row.won,
    draw: row.draw,
    lost: row.lost,
    goals_for: row.goalsFor,
    goals_against: row.goalsAgainst,
    goal_diff: row.goalDifference,
    points: row.points,
    form: row.form ?? null,
    updated_at: new Date().toISOString(),
  };
}
