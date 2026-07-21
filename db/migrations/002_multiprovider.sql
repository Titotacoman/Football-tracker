-- Migration 002: ESPN provider + rosters.
-- Run in the Supabase SQL editor (same as the original schema).

-- ESPN entity ids for leagues sourced from ESPN's public API
-- (Liga MX, MLS, Gold Cup, Copa América) and for roster resolution.
alter table teams   add column espn_id integer unique;
alter table matches add column espn_id bigint  unique;
alter table players add column espn_id integer unique;

-- Roster display.
alter table players add column shirt_number text;

-- Conference/group label for split standings (e.g. MLS East/West).
alter table standings add column grp text;
