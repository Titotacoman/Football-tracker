// HTTP endpoint for managing user_selections from the browser — the only
// write path the frontend has (RLS keeps the anon key read-only; the
// service key never leaves the server).
//
// POST { action: "add"|"remove", kind: "league", code: "PD" }
// POST { action: "add"|"remove", kind: "team", teamId: 12 }
//
// Adding a league also polls it immediately so the UI has data right away
// instead of waiting for the next cron tick.
import { db } from "../../scripts/lib/supabase.mjs";
import { leagueByCode } from "../../scripts/lib/leagues.mjs";
import { runPoll, ensureLeague } from "../../scripts/lib/poll.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }
  const { action, kind } = body;
  if (!["add", "remove"].includes(action)) return json(400, { error: "action must be add|remove" });

  try {
    if (kind === "league") {
      if (!leagueByCode(body.code)) return json(400, { error: `unknown league code: ${body.code}` });
      const league = await ensureLeague(body.code);
      if (action === "add") {
        const existing = await db.select("user_selections", { kind: "eq.league", league_id: `eq.${league.id}` });
        if (existing.length === 0) await db.insert("user_selections", [{ kind: "league", league_id: league.id }]);
        const poll = await runPoll({ codes: [body.code] });
        return json(200, { ok: true, leagueId: league.id, poll });
      }
      await db.delete("user_selections", { kind: "eq.league", league_id: `eq.${league.id}` });
      return json(200, { ok: true });
    }

    if (kind === "team") {
      const teamId = Number(body.teamId);
      const teams = await db.select("teams", { id: `eq.${teamId}`, select: "id" });
      if (teams.length === 0) return json(400, { error: `unknown team id: ${body.teamId}` });
      if (action === "add") {
        const existing = await db.select("user_selections", { kind: "eq.team", team_id: `eq.${teamId}` });
        if (existing.length === 0) await db.insert("user_selections", [{ kind: "team", team_id: teamId }]);
        return json(200, { ok: true });
      }
      await db.delete("user_selections", { kind: "eq.team", team_id: `eq.${teamId}` });
      return json(200, { ok: true });
    }

    return json(400, { error: "kind must be league|team" });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
