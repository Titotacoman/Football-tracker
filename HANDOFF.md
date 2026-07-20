# Soccer Tracker — Project Handoff

New project, fully separate from the calorie tracker (own folder, own git repo, own Netlify site, own DB, own keys). Planning was done in a previous chat; this doc is the complete state as of 2026-07-19.

## What it is

A web app tracking soccer leagues, tournaments, and selected teams: fixtures (date/time/teams), match detail (score, red/yellow cards per player, lineups, injuries), per-game stats, season standings and winners, preseason squad changes (players added/dropped). Also serves a **widget**: a minimal view/endpoint returning only the next upcoming tracked match (PWA/embeddable).

## Hard constraints

- Free sports data APIs only. The only paid component allowed is the Claude (Anthropic) API.
- One key per provider — never multiple accounts on one provider (ToS violation). Redundancy comes from multiple providers with failover.
- MVP deadline: before the Premier League season starts (August 2026).

## Decided architecture (hosting model B — confirmed)

- **Frontend:** static SPA on Netlify.
- **Polling:** free cloud cron (GitHub Actions or Netlify scheduled functions) hits the sports APIs and writes into a hosted DB. The frontend NEVER calls sports APIs directly.
- **Database:** free hosted DB (Turso or Supabase — not yet chosen).
- **Critical quota workaround:** frontend + widget read DIRECTLY from the hosted DB's HTTP API, bypassing Netlify functions. Functions are used only for cron polling (~8.6k invocations/mo vs the 125k free cap). Widget refresh must be adaptive: ~1 min during a live tracked match, 30–60 min otherwise.
- **Known tradeoff (accepted):** cron granularity is ~5 min minimum and GitHub Actions is often 10–15 min late at peak — live data will lag. This was chosen over a self-hosted Node server.
- **Normalization layer:** every provider's JSON maps to one internal schema before touching the DB.
- **Provider manager:** ordered provider list; on error/429 rotate to next.
- **Claude gap-filler:** Claude API + web_search for settled facts only (final scores, winners, standings) — never live in-match data. Every result written to DB so nothing is looked up twice.
- **DB entities:** leagues, teams, players, matches, match_events (goals/cards/subs), injuries, squad_changes, standings, user_selections.
- **Tracking model:** user selects leagues/teams; poll only those. Simultaneous matches in multiple selected leagues → round-robin, equal priority.

## Provider findings (verified via web/docs on 2026-07-19)

| Provider | Limit | Free tier gives | Free tier lacks |
|---|---|---|---|
| football-data.org | 10 req/min | PL + 11 comps: fixtures, results (delayed), standings, top scorers | Lineups, cards, subs (€29/mo Deep Data) |
| API-Football (direct at dashboard.api-football.com, NOT RapidAPI) | 100 req/DAY | ALL endpoints: events/cards, lineups, injuries, sidelined, transfers | **Season-limited — see blocker below** |
| TheSportsDB | 30 req/min | Schedules, teams, league tables (crowd-sourced) | Livescores + v2 API ($9/mo Patreon) |

Roles: football-data.org = backbone for fixtures/standings; API-Football = the only free source of cards/lineups/injuries; TheSportsDB = tertiary metadata fallback.

Implementation note (from football-data.org's registration email): their responses carry rate-limit headers (`X-Requests-Available-Minute`) and clients are expected to auto-throttle from them — build this into the provider manager.

Verified live 2026-07-20: football-data.org returns all 380 fixtures of 2026-27 (season 2026-08-21 → 2027-05-30) plus full 2025-26 results and standings; TheSportsDB (public test key) agrees on the opening fixture. Raw payloads in `samples/`.

## ⚠️ Blocker — RESOLVED 2026-07-20: FAIL

Tested with a real free key: API-Football rejects both season 2026 and 2025 with `"Free plans do not have access to this season, try from 2022 to 2024."` Live per-player cards/lineups/injuries are **impossible on free tiers**. Consequences (fallback pre-agreed in planning):

- Match detail (cards per player, lineups) arrives **post-match via the Claude gap-filler** (settled facts only — a finished match's cards ARE settled facts).
- Live-ish data during a match = scores from football-data.org (delayed on free tier).
- API-Football drops out of the MVP pipeline entirely; the match-window-aware scheduler designed around its 100 req/day is moot. Key is kept in `.env` in case of a future paid upgrade.

## Phasing

- Phase 1 (MVP, before August): Premier League only — fixtures, scores, cards, standings.
- Phase 2: multi-league + tournaments (World Cup, Copa America, Gold Cup), injuries, squad changes, widget.

## Immediate next steps

1. User registers free keys (user must do this themselves): football-data.org/client/register, dashboard.api-football.com, thesportsdb.com/free_sports_api. Keys go in local `.env`, never committed.
2. Run the API-Football current-season test (the blocker above).
3. Pull real JSON from all three providers for the same PL fixtures.
4. Design the normalized DB schema from the actual payloads — not assumptions.
5. Choose Turso vs Supabase, then scaffold.

## Open questions

- ~~Who writes the code~~ — SETTLED 2026-07-20: Claude writes the code; user reviews, registers keys, and makes product decisions.
- ~~Turso vs Supabase~~ — SETTLED 2026-07-20: Supabase. Browser reads go through its REST API (anon key + row-level security, read-only); cron writes use the service-role key. Weekly-inactivity pausing is a non-issue since cron writes continuously.
