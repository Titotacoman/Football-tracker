# Soccer Tracker

Web app tracking soccer leagues and teams: fixtures, match detail (cards, lineups, injuries), standings, squad changes, plus a "next tracked match" widget. Full project state and architecture: [HANDOFF.md](HANDOFF.md).

## Status

Data pipeline live (2026-07-20): Supabase schema applied, `npm run poll` loads the full 2026-27 PL season (380 matches, 20 teams, standings) from football-data.org, and the browser key can read matches + the `next_tracked_match` widget view directly via REST. API-Football season blocker resolved as FAIL — match detail will arrive post-match via the Claude gap-filler.

Next: frontend SPA, cron deployment, gap-filler.

## Setup

1. Copy `.env.example` to `.env` and fill in your keys (register at the URLs in that file).
2. Run the provider tests:

```
npm run test:af     # API-Football — THE season-limit blocker test, run this first
npm run test:fd     # football-data.org smoke test
npm run test:tsdb   # TheSportsDB smoke test (works without a personal key)
```

Each script prints a verdict and saves raw JSON payloads under `samples/` — those payloads drive the normalized DB schema design.

## Architecture (decided)

- Static SPA on Netlify; frontend never calls sports APIs directly.
- Free cloud cron polls providers and writes to a hosted DB (Turso vs Supabase: undecided).
- Frontend + widget read directly from the DB's HTTP API to stay under Netlify's function cap.
- Provider failover: football-data.org (backbone) → API-Football (cards/lineups/injuries) → TheSportsDB (metadata).
- Claude API gap-filler for settled facts only (never live in-match data).
