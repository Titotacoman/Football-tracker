-- Soccer Tracker — normalized schema (Supabase/Postgres).
-- Designed from real provider payloads in samples/ (see HANDOFF.md).
-- Canonical data source: football-data.org. Every table carries provider ids
-- for cross-mapping (TheSportsDB conveniently ships idAPIfootball on teams).
--
-- Access model: browser/widget read via anon key (RLS: SELECT only);
-- cron + gap-filler write via service-role key (bypasses RLS).

create table leagues (
  id          bigint generated always as identity primary key,
  code        text not null unique,          -- "PL" (football-data code)
  name        text not null,                 -- "Premier League"
  country     text,                          -- area.name
  emblem_url  text,
  fd_id       integer unique,                -- football-data competition.id (2021)
  tsdb_id     integer unique,                -- TheSportsDB idLeague (4328)
  af_id       integer unique                 -- API-Football league id (39), future use
);

create table teams (
  id          bigint generated always as identity primary key,
  name        text not null,                 -- "Liverpool FC"
  short_name  text,                          -- "Liverpool"
  tla         text,                          -- "LIV"
  crest_url   text,
  stadium     text,                          -- TheSportsDB strStadium
  fd_id       integer unique,
  tsdb_id     integer unique,
  af_id       integer unique
);

-- Thin for MVP: no free provider gives squads. Rows appear via the Claude
-- gap-filler (post-match cards) and Phase-2 squad tracking.
create table players (
  id          bigint generated always as identity primary key,
  name        text not null,
  team_id     bigint references teams(id),
  position    text,
  tsdb_id     integer unique,
  af_id       integer unique,
  unique (name, team_id)                     -- gap-filler dedup key
);

create table matches (
  id              bigint generated always as identity primary key,
  league_id       bigint not null references leagues(id),
  season          integer not null,          -- start year: 2026 = 2026-27
  matchday        integer,
  stage           text,                      -- "REGULAR_SEASON"; cups differ
  utc_date        timestamptz not null,
  status          text not null default 'SCHEDULED'
    check (status in ('SCHEDULED','TIMED','IN_PLAY','PAUSED','FINISHED',
                      'POSTPONED','SUSPENDED','CANCELLED')),  -- football-data vocabulary
  home_team_id    bigint not null references teams(id),
  away_team_id    bigint not null references teams(id),
  home_score      integer,                   -- score.fullTime
  away_score      integer,
  home_score_ht   integer,                   -- score.halfTime
  away_score_ht   integer,
  winner          text check (winner in ('HOME_TEAM','AWAY_TEAM','DRAW')),
  referee         text,
  fd_id           integer unique,
  last_updated    timestamptz,               -- provider's lastUpdated
  -- Gap-filler bookkeeping: nothing is looked up twice.
  detail_status   text not null default 'none'
    check (detail_status in ('none','pending','filled','unavailable'))
);
create index matches_upcoming on matches (utc_date) where status in ('SCHEDULED','TIMED');
create index matches_league_season on matches (league_id, season);

-- Goals/cards/subs. MVP: written post-match by the Claude gap-filler,
-- hence source + player_name (names may not resolve to player rows).
create table match_events (
  id           bigint generated always as identity primary key,
  match_id     bigint not null references matches(id) on delete cascade,
  team_id      bigint references teams(id),
  player_id    bigint references players(id),
  player_name  text not null,
  type         text not null check (type in ('GOAL','OWN_GOAL','PENALTY_GOAL',
                                             'YELLOW','SECOND_YELLOW','RED','SUB_ON','SUB_OFF')),
  minute       integer,
  detail       text,
  source       text not null check (source in ('api','claude'))
);
create index match_events_match on match_events (match_id);

-- Snapshot upserted by cron from /standings; one row per team per season.
create table standings (
  league_id    bigint not null references leagues(id),
  season       integer not null,
  team_id      bigint not null references teams(id),
  position     integer not null,
  played       integer not null default 0,
  won          integer not null default 0,
  draw         integer not null default 0,
  lost         integer not null default 0,
  goals_for    integer not null default 0,
  goals_against integer not null default 0,
  goal_diff    integer not null default 0,
  points       integer not null default 0,
  form         text,                         -- "W,L,D,W,W" — null preseason
  updated_at   timestamptz not null default now(),
  primary key (league_id, season, team_id)
);

-- Phase 2, schema reserved now.
create table injuries (
  id           bigint generated always as identity primary key,
  team_id      bigint not null references teams(id),
  player_id    bigint references players(id),
  player_name  text not null,
  description  text,
  reported_at  date,
  source       text not null check (source in ('api','claude'))
);

create table squad_changes (
  id           bigint generated always as identity primary key,
  team_id      bigint not null references teams(id),
  player_name  text not null,
  direction    text not null check (direction in ('IN','OUT')),
  detail       text,                         -- fee/loan/free etc.
  changed_at   date,
  source       text not null check (source in ('api','claude'))
);

-- What the user tracks; polling and the widget follow this.
create table user_selections (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('league','team')),
  league_id  bigint references leagues(id),
  team_id    bigint references teams(id),
  check ((kind = 'league' and league_id is not null and team_id is null)
      or (kind = 'team'   and team_id  is not null))
);

-- Cron bookkeeping: last successful poll per provider endpoint.
create table sync_state (
  job        text primary key,               -- e.g. 'fd:matches', 'fd:standings'
  last_run   timestamptz,
  last_ok    timestamptz,
  note       text
);

-- The widget's entire backend: next upcoming match among tracked
-- leagues/teams, as a single REST-readable view.
create view next_tracked_match as
select m.id, m.utc_date, m.status, m.matchday,
       ht.name as home_team, ht.tla as home_tla, ht.crest_url as home_crest,
       at.name as away_team, at.tla as away_tla, at.crest_url as away_crest,
       l.name  as league, l.code as league_code
from matches m
join teams ht on ht.id = m.home_team_id
join teams at on at.id = m.away_team_id
join leagues l on l.id = m.league_id
where m.status in ('SCHEDULED','TIMED')
  and (exists (select 1 from user_selections s
               where s.kind = 'league' and s.league_id = m.league_id)
    or exists (select 1 from user_selections s
               where s.kind = 'team'
                 and s.team_id in (m.home_team_id, m.away_team_id)))
order by m.utc_date
limit 1;

-- RLS: anonymous browser key may only SELECT; all writes come from the
-- service-role key, which bypasses RLS.
alter table leagues         enable row level security;
alter table teams           enable row level security;
alter table players         enable row level security;
alter table matches         enable row level security;
alter table match_events    enable row level security;
alter table standings       enable row level security;
alter table injuries        enable row level security;
alter table squad_changes   enable row level security;
alter table user_selections enable row level security;
alter table sync_state      enable row level security;

create policy public_read on leagues         for select using (true);
create policy public_read on teams           for select using (true);
create policy public_read on players         for select using (true);
create policy public_read on matches         for select using (true);
create policy public_read on match_events    for select using (true);
create policy public_read on standings       for select using (true);
create policy public_read on injuries        for select using (true);
create policy public_read on squad_changes   for select using (true);
create policy public_read on user_selections for select using (true);
create policy public_read on sync_state      for select using (true);
