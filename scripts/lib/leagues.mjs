// Registry of competitions available on football-data.org's free tier.
// fd_id = football-data competition id. tsdb/af ids filled in only where
// verified (PL) — enrich others when actually needed.
export const SUPPORTED_LEAGUES = [
  { code: "PL",  name: "Premier League",        country: "England",     fd_id: 2021, tsdb_id: 4328, af_id: 39 },
  { code: "ELC", name: "Championship",          country: "England",     fd_id: 2016 },
  { code: "BL1", name: "Bundesliga",            country: "Germany",     fd_id: 2002 },
  { code: "PD",  name: "La Liga",               country: "Spain",       fd_id: 2014 },
  { code: "SA",  name: "Serie A",               country: "Italy",       fd_id: 2019 },
  { code: "FL1", name: "Ligue 1",               country: "France",      fd_id: 2015 },
  { code: "DED", name: "Eredivisie",            country: "Netherlands", fd_id: 2003 },
  { code: "PPL", name: "Primeira Liga",         country: "Portugal",    fd_id: 2017 },
  { code: "BSA", name: "Série A (Brazil)",      country: "Brazil",      fd_id: 2013 },
  { code: "CL",  name: "Champions League",      country: "Europe",      fd_id: 2001 },
  { code: "EC",  name: "European Championship", country: "Europe",      fd_id: 2018 },
  { code: "WC",  name: "World Cup",             country: "World",       fd_id: 2000 },
];

export const leagueByCode = (code) => SUPPORTED_LEAGUES.find((l) => l.code === code);
