-- Migration 003: where-to-watch.
-- Run in the Supabase SQL editor.
--
-- US broadcast/streaming names for a match (e.g. "Peacock", "FOX / FS1",
-- "Apple TV"), sourced from ESPN's geoBroadcasts. Only populated for
-- near-term matches — ESPN adds listings as kickoff approaches.
alter table matches add column broadcast text;
