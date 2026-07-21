// On-demand roster ingestion. The team page calls this, then reads the
// players table via Supabase REST like everything else.
//
// POST { teamId: 12, league: "PL" }
//
// Rosters always come from ESPN (free, no key, includes positions), even
// for football-data-sourced teams: the team's ESPN id is resolved once by
// name-matching against the league's ESPN team list, then cached on the
// team row. Refetches at most once per day per team.
import { db } from "../../scripts/lib/supabase.mjs";
import { leagueByCode } from "../../scripts/lib/leagues.mjs";
import { getJson } from "../../scripts/lib/util.mjs";

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const FRESH_MS = 24 * 3600_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// "Brighton & Hove Albion FC" -> "brighton hove albion" etc.
function nameKey(s) {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(fc|afc|cf|sc|ac|club|cd|de|deportivo|real)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveEspnId(team, slug) {
  const body = await getJson(`${ESPN_SITE}/${slug}/teams`);
  if (body.status !== 200) throw new Error(`espn teams list -> HTTP ${body.status}`);
  const list = body.body.sports?.[0]?.leagues?.[0]?.teams?.map((t) => t.team) ?? [];
  const target = nameKey(team.name);
  const targetWords = new Set(target.split(" "));
  let best = null, bestScore = 0;
  for (const t of list) {
    const cand = nameKey(t.displayName);
    if (cand === target) return Number(t.id);
    const overlap = cand.split(" ").filter((w) => targetWords.has(w)).length;
    const score = overlap / Math.max(cand.split(" ").length, targetWords.size);
    if (score > bestScore) { bestScore = score; best = t; }
  }
  if (best && bestScore >= 0.5) return Number(best.id);
  throw new Error(`no ESPN team match for "${team.name}" in ${slug}`);
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }
  const reg = leagueByCode(body.league);
  if (!reg) return json(400, { error: `unknown league: ${body.league}` });
  const teamId = Number(body.teamId);

  try {
    const [team] = await db.select("teams", { id: `eq.${teamId}`, select: "id,name,espn_id" });
    if (!team) return json(400, { error: `unknown team id: ${body.teamId}` });

    // Skip the upstream fetch if this roster is fresh.
    const job = `roster:${teamId}`;
    const [sync] = await db.select("sync_state", { job: `eq.${job}` });
    if (sync?.last_ok && Date.now() - new Date(sync.last_ok) < FRESH_MS) {
      return json(200, { ok: true, cached: true });
    }

    let espnId = team.espn_id;
    if (!espnId) {
      espnId = await resolveEspnId(team, reg.espn_slug);
      await db.update("teams", { id: `eq.${team.id}` }, { espn_id: espnId });
    }

    const res = await getJson(`${ESPN_SITE}/${reg.espn_slug}/teams/${espnId}/roster`);
    if (res.status !== 200) throw new Error(`espn roster -> HTTP ${res.status}`);
    const athletes = res.body.athletes ?? [];
    if (athletes.length) {
      await db.upsert(
        "players",
        athletes.map((a) => ({
          name: a.fullName,
          team_id: teamId,
          position: a.position?.displayName ?? null,
          shirt_number: a.jersey ?? null,
          espn_id: Number(a.id),
        })),
        "espn_id",
      );
      // Players no longer on this roster (transfers) lose the team link —
      // unlink rather than delete, since match_events may reference them.
      await db.update(
        "players",
        { team_id: `eq.${teamId}`, espn_id: `not.in.(${athletes.map((a) => Number(a.id)).join(",")})` },
        { team_id: null },
      );
    }

    const now = new Date().toISOString();
    await db.upsert("sync_state", [{ job, last_run: now, last_ok: now, note: `${athletes.length} players` }], "job");
    return json(200, { ok: true, players: athletes.length });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
