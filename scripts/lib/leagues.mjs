// Registry of supported competitions and which provider feeds them.
//   provider "fd"   — football-data.org free tier (fixtures/standings backbone)
//   provider "espn" — ESPN's public JSON API (no key; leagues fd lacks)
// espn_slug is present on every league: rosters always come from ESPN,
// even for fd-sourced leagues (team ids resolved by name, cached in DB).
export const SUPPORTED_LEAGUES = [
  { code: "PL",  name: "Premier League",        country: "England",     provider: "fd",   fd_id: 2021, tsdb_id: 4328, af_id: 39, espn_slug: "eng.1" },
  { code: "ELC", name: "Championship",          country: "England",     provider: "fd",   fd_id: 2016, espn_slug: "eng.2" },
  { code: "BL1", name: "Bundesliga",            country: "Germany",     provider: "fd",   fd_id: 2002, espn_slug: "ger.1" },
  { code: "PD",  name: "La Liga",               country: "Spain",       provider: "fd",   fd_id: 2014, espn_slug: "esp.1" },
  { code: "SA",  name: "Serie A",               country: "Italy",       provider: "fd",   fd_id: 2019, espn_slug: "ita.1" },
  { code: "FL1", name: "Ligue 1",               country: "France",      provider: "fd",   fd_id: 2015, espn_slug: "fra.1" },
  { code: "DED", name: "Eredivisie",            country: "Netherlands", provider: "fd",   fd_id: 2003, espn_slug: "ned.1" },
  { code: "PPL", name: "Primeira Liga",         country: "Portugal",    provider: "fd",   fd_id: 2017, espn_slug: "por.1" },
  { code: "BSA", name: "Série A (Brazil)",      country: "Brazil",      provider: "fd",   fd_id: 2013, espn_slug: "bra.1" },
  { code: "CL",  name: "Champions League",      country: "Europe",      provider: "fd",   fd_id: 2001, espn_slug: "uefa.champions" },
  { code: "EC",  name: "European Championship", country: "Europe",      provider: "fd",   fd_id: 2018, espn_slug: "uefa.euro" },
  { code: "WC",  name: "World Cup",             country: "World",       provider: "fd",   fd_id: 2000, espn_slug: "fifa.world" },
  { code: "LMX", name: "Liga MX",               country: "Mexico",      provider: "espn", tsdb_id: 4350, espn_slug: "mex.1" },
  { code: "MLS", name: "MLS",                   country: "United States", provider: "espn", tsdb_id: 4346, espn_slug: "usa.1" },
  { code: "GC",  name: "Gold Cup",              country: "North America", provider: "espn", tsdb_id: 4873, espn_slug: "concacaf.gold" },
  { code: "CA",  name: "Copa América",          country: "South America", provider: "espn", tsdb_id: 4499, espn_slug: "conmebol.america" },
];

export const leagueByCode = (code) => SUPPORTED_LEAGUES.find((l) => l.code === code);

// Only registry columns that exist in the leagues table.
export function leagueDbRow(reg) {
  return {
    code: reg.code,
    name: reg.name,
    country: reg.country,
    fd_id: reg.fd_id ?? null,
    tsdb_id: reg.tsdb_id ?? null,
    af_id: reg.af_id ?? null,
  };
}
