// THE BLOCKER TEST (HANDOFF.md): does an API-Football free key return
// current-season (2026-27) data? Community reports say free keys may be
// stuck at seasons 2021-2023. Everything about live cards/lineups hinges
// on the verdict printed at the end.
//
// Budget note: free plan is 100 req/day. This script spends 4 requests.
import { loadEnv, requireKey, saveSample, getJson } from "./lib/util.mjs";

loadEnv();
const key = requireKey("API_FOOTBALL_KEY");
const BASE = "https://v3.football.api-sports.io";
const HEADERS = { "x-apisports-key": key };
const PL = 39; // Premier League league id

function report(label, { status, body }) {
  const errors = body?.errors;
  const errorText =
    errors && (Array.isArray(errors) ? errors.length : Object.keys(errors).length)
      ? JSON.stringify(errors)
      : null;
  console.log(`${label}: HTTP ${status}, results=${body?.results ?? "?"}${errorText ? `, errors=${errorText}` : ""}`);
  return { results: body?.results ?? 0, errorText };
}

console.log("== API-Football free-plan season test ==\n");

// 1. Account status: plan name + requests used today.
const status = await getJson(`${BASE}/status`, HEADERS);
const acct = status.body?.response;
console.log(`Plan: ${acct?.subscription?.plan ?? "?"} | requests today: ${acct?.requests?.current ?? "?"}/${acct?.requests?.limit_day ?? "?"}\n`);
saveSample("api-football", "status", status.body);

// 2. League metadata: which seasons exist, with per-season coverage flags.
const leagues = await getJson(`${BASE}/leagues?id=${PL}`, HEADERS);
report("GET /leagues?id=39", leagues);
saveSample("api-football", "leagues-pl", leagues.body);

// 3. The blocker: current-season fixtures (2026 = the 2026-27 PL season).
const current = await getJson(`${BASE}/fixtures?league=${PL}&season=2026`, HEADERS);
const cur = report("GET /fixtures?league=39&season=2026", current);
saveSample("api-football", "fixtures-2026", current.body);

// 4. Control: last completed season, to distinguish "plan-blocked" from
// "fixtures not loaded yet".
const control = await getJson(`${BASE}/fixtures?league=${PL}&season=2025&last=5`, HEADERS);
const ctl = report("GET /fixtures?league=39&season=2025&last=5", control);
saveSample("api-football", "fixtures-2025-last5", control.body);

console.log("\n== VERDICT ==");
if (cur.results > 0) {
  console.log("PASS: free key returns current-season (2026-27) fixtures.");
  console.log("Live per-player cards/lineups via API-Football are viable.");
} else if (cur.errorText) {
  console.log("FAIL: current season blocked on this plan.");
  console.log(`API said: ${cur.errorText}`);
  console.log("Fallback per HANDOFF.md: match detail arrives post-match via the Claude gap-filler.");
} else if (ctl.results > 0) {
  console.log("AMBIGUOUS: 2025 works but 2026 returned 0 fixtures with no error.");
  console.log("2026-27 fixtures may simply not be loaded yet — retest closer to August.");
} else {
  console.log("FAIL: neither 2026 nor 2025 returned data. Season limits likely apply.");
  console.log("Check samples/api-football/*.json for the raw error payloads.");
}
