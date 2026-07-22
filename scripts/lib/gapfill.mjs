// Broadcast gap-filler: for upcoming tracked matches that still have no US
// listing (mainly Liga MX and other leagues ESPN doesn't cover), ask Claude
// to look one up. Tightly scoped to keep the paid-API cost small:
//   - only tracked leagues, only the next few days
//   - focus-team matches first
//   - at most MAX_PER_RUN lookups per run
//   - never re-check the same match more than once per RECHECK_MS
//   - only writes a result at medium/high confidence
import { db } from "./supabase.mjs";
import { lookupBroadcast } from "./claude.mjs";

const WINDOW_MS = 3 * 86400_000;   // only matches within the next 3 days
const RECHECK_MS = 12 * 3600_000;  // don't re-look-up a match within 12h
const MAX_PER_RUN = 8;             // hard cap on paid lookups per run

export async function runBroadcastGapfill({ max = MAX_PER_RUN } = {}) {
  const sel = await db.select("user_selections", { select: "kind,league_id,team_id" });
  const leagueIds = sel.filter((s) => s.kind === "league").map((s) => s.league_id);
  const favTeams = new Set(sel.filter((s) => s.kind === "team").map((s) => s.team_id));
  if (leagueIds.length === 0) return { checked: 0, filled: 0 };

  const now = Date.now();
  const matches = await db.select("matches", {
    select:
      "id,utc_date,home_team_id,away_team_id,home:teams!matches_home_team_id_fkey(name),away:teams!matches_away_team_id_fkey(name),league:leagues(name)",
    league_id: `in.(${leagueIds.join(",")})`,
    status: "in.(SCHEDULED,TIMED,IN_PLAY,PAUSED)",
    broadcast: "is.null",
    utc_date: `lte.${new Date(now + WINDOW_MS).toISOString()}`,
    order: "utc_date.asc",
  });
  if (matches.length === 0) return { checked: 0, filled: 0 };

  const sync = await db.select("sync_state", { select: "job,last_ok", job: "like.gap:bcast:*" });
  const lastByJob = new Map(sync.map((s) => [s.job, s.last_ok]));

  const isFav = (m) => favTeams.has(m.home_team_id) || favTeams.has(m.away_team_id);
  const candidates = matches
    .filter((m) => {
      const last = lastByJob.get(`gap:bcast:${m.id}`);
      return !last || now - new Date(last) > RECHECK_MS;
    })
    .sort((a, b) => (isFav(a) ? 0 : 1) - (isFav(b) ? 0 : 1) || (a.utc_date < b.utc_date ? -1 : 1))
    .slice(0, max);

  let filled = 0;
  for (const m of candidates) {
    let result = null;
    try {
      result = await lookupBroadcast({
        home: m.home.name, away: m.away.name, league: m.league.name, dateISO: m.utc_date,
      });
    } catch (err) {
      console.error(`match ${m.id}: ${err.message}`);
    }
    if (result?.broadcast && result.confidence !== "low") {
      await db.update("matches", { id: `eq.${m.id}` }, { broadcast: result.broadcast });
      filled++;
      console.log(`match ${m.id}: ${m.home.name} v ${m.away.name} -> ${result.broadcast} (${result.confidence})`);
    } else {
      console.log(`match ${m.id}: ${m.home.name} v ${m.away.name} -> no confident result`);
    }
    const nowIso = new Date().toISOString();
    await db.upsert(
      "sync_state",
      [{ job: `gap:bcast:${m.id}`, last_run: nowIso, last_ok: nowIso, note: result?.broadcast ?? "none" }],
      "job",
    );
  }
  return { checked: candidates.length, filled };
}
