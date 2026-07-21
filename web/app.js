// Hash-routed SPA: #fixtures (default), #standings, #match/<id>,
// #team/<id>, #leagues (manage tracked leagues).
import { api } from "./api.js";
import { SUPPORTED_LEAGUES } from "./leagues.js";

const view = document.getElementById("view");
const hero = document.getElementById("hero");
const leagueSel = document.getElementById("leagueSel");

const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

const STATUS_LABEL = {
  SCHEDULED: "", TIMED: "", IN_PLAY: "LIVE", PAUSED: "HT",
  FINISHED: "FT", POSTPONED: "PPD", SUSPENDED: "SUSP", CANCELLED: "CANC",
};
const isPlayed = (s) => ["IN_PLAY", "PAUSED", "FINISHED"].includes(s);

// "Today" / "Tomorrow" instead of raw dates where it helps.
function dayLabel(date) {
  const d = new Date(date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((d - today) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return fmtDay.format(d);
}

const skeleton = (n = 6) =>
  `<div class="skeleton"><div class="bone short"></div>${'<div class="bone"></div>'.repeat(n)}</div>`;
const empty = (glyph, text) => `<div class="empty"><span class="glyph">${glyph}</span>${text}</div>`;

// ---- state ----------------------------------------------------------------
let tracked = [];          // [{id, code, name}] leagues in user_selections
let league = null;         // current {id, code, name}
let favorites = new Set(); // team ids
let matchdayCache = new Map(); // league.id -> [{matchday, status}]

async function loadState() {
  const [sel, favs] = await Promise.all([api.trackedLeagues(), api.favoriteTeamIds()]);
  tracked = sel.map((s) => s.league).filter(Boolean);
  favorites = favs;
  const savedCode = localStorage.getItem("league");
  league = tracked.find((l) => l.code === savedCode) ?? tracked[0] ?? null;
}

function renderLeagueSelect() {
  leagueSel.innerHTML = `
    ${tracked.map((l) => `<option value="${l.code}" ${l.code === league?.code ? "selected" : ""}>${l.name}</option>`).join("")}
    <option value="manage">⚙ Manage leagues…</option>`;
}

leagueSel.addEventListener("change", () => {
  const val = leagueSel.value;
  if (val === "manage") {
    renderLeagueSelect();
    location.hash = "#leagues";
    return;
  }
  league = tracked.find((l) => l.code === val) ?? league;
  localStorage.setItem("league", league.code);
  location.hash = location.hash === "#standings" ? "#standings" : "#fixtures";
  route();
});

// ---- shared render helpers ------------------------------------------------
function crest(team) {
  return team.crest_url
    ? `<img class="crest" src="${team.crest_url}" alt="" loading="lazy" />`
    : "";
}

function scoreOrTime(m) {
  if (isPlayed(m.status)) return `<span class="score">${m.home_score ?? "–"}–${m.away_score ?? "–"}</span>`;
  return `<span class="time">${fmtTime.format(new Date(m.utc_date))}</span>`;
}

function matchRow(m) {
  const badge = STATUS_LABEL[m.status];
  const fav = favorites.has(m.home.id) || favorites.has(m.away.id);
  return `<a class="match ${m.status === "IN_PLAY" ? "live" : ""} ${fav ? "fav" : ""}" href="#match/${m.id}">
    <span class="team home">${favorites.has(m.home.id) ? "★ " : ""}${m.home.short_name ?? m.home.name} ${crest(m.home)}</span>
    ${scoreOrTime(m)}
    <span class="team away">${crest(m.away)} ${m.away.short_name ?? m.away.name}${favorites.has(m.away.id) ? " ★" : ""}</span>
    ${badge ? `<span class="badge ${m.status}">${badge}</span>` : ""}
  </a>`;
}

function matchList(matches) {
  const byDay = new Map();
  for (const m of matches) {
    const day = dayLabel(m.utc_date);
    (byDay.get(day) ?? byDay.set(day, []).get(day)).push(m);
  }
  return [...byDay].map(([day, ms]) => `
    <h3 class="day ${day === "Today" ? "today" : ""}">${day}</h3>
    <div class="matches">${ms.map(matchRow).join("")}</div>`).join("");
}

const formPills = (form) =>
  form.map((r) => `<span class="pill ${r}">${r}</span>`).join("");

function starButton(teamId, cls = "star") {
  const on = favorites.has(teamId);
  return `<button class="${cls} ${on ? "on" : ""}" data-team="${teamId}" title="Focus team">${on ? "★" : "☆"}</button>`;
}

function wireStars(root) {
  root.querySelectorAll("[data-team]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const teamId = Number(btn.dataset.team);
      const isFav = favorites.has(teamId);
      btn.disabled = true;
      try {
        await api.track({ action: isFav ? "remove" : "add", kind: "team", teamId });
        isFav ? favorites.delete(teamId) : favorites.add(teamId);
        btn.textContent = isFav ? "☆" : "★";
        btn.classList.toggle("on", !isFav);
        btn.closest("tr")?.classList.toggle("fav", !isFav);
        renderHero().catch(() => {});
      } catch (err) {
        console.error(err);
      }
      btn.disabled = false;
    }));
}

// ---- hero: live match, else next tracked ---------------------------------
async function renderHero() {
  const live = tracked.length ? await api.liveMatch(tracked.map((l) => l.id)) : null;
  if (live) {
    hero.href = `#match/${live.id}`;
    hero.classList.add("is-live");
    hero.innerHTML = `
      <div class="hero-label">${live.league?.name ?? ""} · <span class="badge IN_PLAY">LIVE</span></div>
      <div class="hero-teams">
        <span>${live.home.short_name ?? live.home.name}</span>
        <img class="crest lg" src="${live.home.crest_url}" alt="" />
        <span class="live-score">${live.home_score ?? 0}–${live.away_score ?? 0}</span>
        <img class="crest lg" src="${live.away.crest_url}" alt="" />
        <span>${live.away.short_name ?? live.away.name}</span>
      </div>
      <div class="hero-when">${live.status === "PAUSED" ? "Half time" : "In play"} — tap for details</div>`;
    hero.hidden = false;
    return;
  }
  const next = await api.nextTrackedMatch();
  if (!next) { hero.hidden = true; return; }
  const d = new Date(next.utc_date);
  const days = Math.max(0, Math.ceil((d - Date.now()) / 86_400_000));
  hero.href = `#match/${next.id}`;
  hero.classList.remove("is-live");
  hero.innerHTML = `
    <div class="hero-label">Next tracked match · ${next.league}</div>
    <div class="hero-teams">
      <span>${next.home_team}</span>
      <img class="crest lg" src="${next.home_crest}" alt="" />
      <span class="vs">vs</span>
      <img class="crest lg" src="${next.away_crest}" alt="" />
      <span>${next.away_team}</span>
    </div>
    <div class="hero-when">${dayLabel(next.utc_date)} · ${fmtTime.format(d)}${days > 1 ? ` · in ${days} days` : ""}</div>`;
  hero.hidden = false;
}
// Keep the hero honest: refresh every minute (score while live, rollover after FT).
setInterval(() => renderHero().catch(() => {}), 60_000);

// ---- data freshness -------------------------------------------------------
async function renderFreshness() {
  const el = document.getElementById("freshness");
  const ts = await api.lastSync().catch(() => null);
  if (!ts) { el.textContent = ""; return; }
  const mins = Math.max(0, Math.round((Date.now() - new Date(ts)) / 60_000));
  el.textContent = `Updated ${mins <= 1 ? "just now" : `${mins} min ago`} · `;
}
setInterval(renderFreshness, 120_000);

// ---- fixtures -------------------------------------------------------------
async function defaultMatchday() {
  if (!matchdayCache.has(league.id)) matchdayCache.set(league.id, await api.matchdays(league.id));
  const days = matchdayCache.get(league.id);
  const upcoming = days.find((m) => !isPlayed(m.status));
  return upcoming?.matchday ?? days.at(-1)?.matchday ?? null;
}

async function renderFixtures(matchday) {
  if (!league) { view.innerHTML = empty("⚽", "No league tracked yet — open ⚙ Manage leagues."); return; }
  matchday ??= await defaultMatchday();
  if (matchday === null) return renderFixturesByDate("upcoming");

  const matches = await api.fixtures(league.id, matchday);
  const total = Math.max(...(matchdayCache.get(league.id) ?? []).map((m) => m.matchday), matchday);
  const options = Array.from({ length: total }, (_, i) => i + 1)
    .map((n) => `<option value="${n}" ${n === matchday ? "selected" : ""}>Matchday ${n}</option>`).join("");

  view.innerHTML = `
    <div class="md-nav">
      <button ${matchday <= 1 ? "disabled" : ""} data-md="${matchday - 1}" aria-label="Previous matchday">‹</button>
      <select id="mdJump" aria-label="Jump to matchday">${options}</select>
      <button ${matchday >= total ? "disabled" : ""} data-md="${matchday + 1}" aria-label="Next matchday">›</button>
    </div>
    ${matches.length === 0 ? empty("📅", "No fixtures published yet for this competition.") : matchList(matches)}`;

  view.querySelectorAll("[data-md]").forEach((b) =>
    b.addEventListener("click", () => renderFixtures(Number(b.dataset.md))));
  document.getElementById("mdJump").addEventListener("change", (e) =>
    renderFixtures(Number(e.target.value)));
}

async function renderFixturesByDate(mode) {
  const matches = mode === "results" ? await api.results(league.id) : await api.upcoming(league.id);
  view.innerHTML = `
    <div class="md-nav">
      <button class="seg ${mode !== "results" ? "on" : ""}" data-mode="upcoming">Upcoming</button>
      <button class="seg ${mode === "results" ? "on" : ""}" data-mode="results">Results</button>
    </div>
    ${matches.length === 0 ? empty("📅", "Nothing here yet — this competition may be between editions.") : matchList(matches)}`;
  view.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => renderFixturesByDate(b.dataset.mode)));
}

// ---- match detail ---------------------------------------------------------
const EVENT_ICON = {
  GOAL: "⚽", OWN_GOAL: "⚽ (og)", PENALTY_GOAL: "⚽ (pen)",
  YELLOW: "🟨", SECOND_YELLOW: "🟨🟥", RED: "🟥", SUB_ON: "▲", SUB_OFF: "▼",
};

async function renderMatch(id) {
  const [m, events] = await Promise.all([api.match(id), api.matchEvents(id)]);
  if (!m) { view.innerHTML = empty("🔍", "Match not found."); return; }
  const d = new Date(m.utc_date);

  let detailNote = "";
  if (m.status === "FINISHED" && events.length === 0) {
    detailNote = `<p class="muted center">Cards & scorers ${m.detail_status === "unavailable" ? "are unavailable for this match" : "arrive shortly after full time"}.</p>`;
  } else if (!isPlayed(m.status)) {
    detailNote = `<p class="muted center">Match detail appears here after kick-off.</p>`;
  }

  view.innerHTML = `
    <a class="back" href="#fixtures">‹ Fixtures</a>
    <div class="detail-card">
      <div class="detail-head">${m.matchday ? `Matchday ${m.matchday} · ` : ""}${dayLabel(m.utc_date)} · ${fmtTime.format(d)}${m.referee ? ` · Ref: ${m.referee}` : ""}</div>
      <div class="detail-score">
        <span class="team"><a class="team-link" href="#team/${m.home.id}">${m.home.name}</a> ${crest(m.home)}</span>
        <span class="big">${isPlayed(m.status) ? `${m.home_score}–${m.away_score}` : "vs"}</span>
        <span class="team">${crest(m.away)} <a class="team-link" href="#team/${m.away.id}">${m.away.name}</a></span>
      </div>
      ${m.status === "FINISHED" && m.home_score_ht != null ? `<div class="muted center">HT ${m.home_score_ht}–${m.away_score_ht}</div>` : ""}
      ${STATUS_LABEL[m.status] ? `<div class="center"><span class="badge ${m.status}">${STATUS_LABEL[m.status]}</span></div>` : ""}
      <div id="matchForm"></div>
      ${events.length ? `<ul class="events">${events.map((e) => `
        <li><span class="minute">${e.minute ?? ""}′</span> ${EVENT_ICON[e.type] ?? e.type}
            <span>${e.player_name}</span> <span class="muted">${e.team?.tla ?? ""}${e.detail ? ` · ${e.detail}` : ""}</span></li>`).join("")}</ul>` : detailNote}
    </div>
    <div id="h2h"></div>`;

  // Both teams' recent form (only meaningful once seasons are running).
  Promise.all([api.teamForm(m.home.id), api.teamForm(m.away.id)]).then(([hf, af]) => {
    if (!hf.length && !af.length) return;
    document.getElementById("matchForm").innerHTML = `
      <div class="form-row">
        <span>${m.home.tla ?? ""}</span> ${formPills(hf) || "–"}
        <span style="margin: 0 8px">·</span>
        ${formPills(af) || "–"} <span>${m.away.tla ?? ""}</span>
      </div>`;
  }).catch(() => {});

  // Head-to-head from everything we've stored.
  api.headToHead(m.home.id, m.away.id).then((h2h) => {
    const prior = h2h.filter((x) => x.id !== m.id);
    if (!prior.length) return;
    document.getElementById("h2h").innerHTML = `
      <h3 class="h2h-title">Head to head</h3>
      <div class="matches">${prior.map(matchRow).join("")}</div>`;
  }).catch(() => {});
}

// ---- team page ------------------------------------------------------------
const POSITION_ORDER = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Attacker"];

async function renderTeam(id) {
  const team = await api.team(id);
  if (!team) { view.innerHTML = empty("🔍", "Team not found."); return; }

  view.innerHTML = `
    <a class="back" href="#standings">‹ Back</a>
    <div class="team-head">
      ${team.crest_url ? `<img class="crest xl" src="${team.crest_url}" alt="" />` : ""}
      <div>
        <h2>${team.name} ${starButton(team.id)}</h2>
        <div class="muted">${[team.tla, team.stadium].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
    <div class="chips" id="teamChips"></div>
    <div id="teamMatches">${skeleton(2)}</div>
    <h3>Roster</h3>
    <div id="roster">${skeleton(4)}</div>`;
  wireStars(view.querySelector(".team-head"));

  // Info chips: league position + recent form.
  Promise.all([api.standings(league.id).catch(() => []), api.teamForm(id)]).then(([table, form]) => {
    const row = table.find((r) => r.team.id === id);
    const chips = [];
    if (row) {
      const ord = (n) => n + (["th", "st", "nd", "rd"][((n % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][n % 100] ?? "th");
      chips.push(`<span class="info-chip"><b>${ord(row.position)}</b> in ${league.name}${row.grp ? ` (${row.grp})` : ""}</span>`);
      chips.push(`<span class="info-chip"><b>${row.points}</b> pts · ${row.played} played</span>`);
    }
    if (form.length) chips.push(`<span class="info-chip">Form ${formPills(form)}</span>`);
    document.getElementById("teamChips").innerHTML = chips.join("");
  }).catch(() => {});

  // Matches (this league) — next few and last few.
  api.teamMatches(id, league.id).then((all) => {
    const played = all.filter((m) => m.status === "FINISHED");
    const upcoming = all.filter((m) => !isPlayed(m.status) && new Date(m.utc_date) > Date.now() - 12 * 3600_000);
    document.getElementById("teamMatches").innerHTML = `
      ${upcoming.length ? `<h3 class="h2h-title">Next up</h3><div class="matches">${upcoming.slice(0, 3).map(matchRow).join("")}</div>` : ""}
      ${played.length ? `<h3 class="h2h-title">Recent</h3><div class="matches">${played.slice(-3).reverse().map(matchRow).join("")}</div>` : ""}`;
  }).catch(() => {});

  // Roster: ask the function to (re)fill, then read from the DB.
  try {
    await api.fetchRoster(id, league.code);
  } catch (err) {
    console.warn("roster fetch:", err.message);
  }
  const players = await api.teamPlayers(id).catch(() => []);
  const rosterEl = document.getElementById("roster");
  if (players.length === 0) {
    rosterEl.innerHTML = empty("👥", "No roster available for this team.");
    return;
  }
  const groups = new Map();
  for (const p of players) {
    const key = p.position ?? "Other";
    (groups.get(key) ?? groups.set(key, []).get(key)).push(p);
  }
  const posRank = (p) => { const i = POSITION_ORDER.indexOf(p); return i === -1 ? 98 : i; };
  const ordered = [...groups.keys()].sort((a, b) => posRank(a) - posRank(b) || a.localeCompare(b));
  rosterEl.innerHTML = ordered.map((pos) => `
    <h4 class="day">${pos}s</h4>
    <ul class="roster">${groups.get(pos)
      .sort((a, b) => (Number(a.shirt_number) || 999) - (Number(b.shirt_number) || 999))
      .map((p) => `<li><span class="shirt">${p.shirt_number ?? ""}</span> ${p.name}</li>`).join("")}
    </ul>`).join("");
}

// ---- standings ------------------------------------------------------------
// Qualification/relegation zones for single-table domestic leagues.
const ZONES = {
  PL:  { ucl: 4, uel: 1, rel: 3 }, PD: { ucl: 4, uel: 1, rel: 3 },
  SA:  { ucl: 4, uel: 1, rel: 3 }, BL1: { ucl: 4, uel: 1, rel: 2 },
  FL1: { ucl: 3, uel: 1, rel: 2 }, DED: { ucl: 2, uel: 1, rel: 2 },
  PPL: { ucl: 2, uel: 1, rel: 2 },
};

function zoneFor(pos, total, zones) {
  if (!zones) return "";
  if (pos <= zones.ucl) return "ucl";
  if (pos <= zones.ucl + zones.uel) return "uel";
  if (pos > total - zones.rel) return "rel";
  return "";
}

async function renderStandings() {
  if (!league) { view.innerHTML = empty("⚽", "No league tracked yet."); return; }
  const rows = await api.standings(league.id);
  if (rows.length === 0) {
    view.innerHTML = `<h2>Standings</h2>${empty("📊", "No league table for this competition (yet).")}`;
    return;
  }
  const preseason = rows.every((r) => r.played === 0);
  const groups = new Map();
  for (const r of rows) {
    (groups.get(r.grp) ?? groups.set(r.grp, []).get(r.grp)).push(r);
  }
  const zones = groups.size === 1 && !preseason ? ZONES[league.code] : null;
  const tableFor = (list) => `
    <div class="table-wrap"><table class="standings">
      <thead><tr><th></th><th></th><th>#</th><th class="left">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
      <tbody>${list.map((r) => `
        <tr class="${favorites.has(r.team.id) ? "fav" : ""}">
        <td class="zone"><span class="zone-bar ${zoneFor(r.position, list.length, zones)}"></span></td>
        <td>${starButton(r.team.id)}</td>
        <td>${r.position}</td>
        <td class="left"><a class="team-link" href="#team/${r.team.id}">${crest(r.team)} ${r.team.name}</a></td>
        <td>${r.played}</td><td>${r.won}</td><td>${r.draw}</td><td>${r.lost}</td>
        <td>${r.goal_diff > 0 ? "+" : ""}${r.goal_diff}</td><td class="pts">${r.points}</td></tr>`).join("")}
      </tbody></table></div>`;
  view.innerHTML = `
    <h2>Standings</h2>
    ${preseason ? `<p class="muted">Season hasn't started — ★ a team to make it your focus.</p>` : ""}
    ${[...groups].map(([grp, list]) => `${grp ? `<h3 class="h2h-title">${grp}</h3>` : ""}${tableFor(list)}`).join("")}
    ${zones ? `<div class="zone-legend">
      <span><span class="zone-bar ucl"></span>Champions League</span>
      <span><span class="zone-bar uel"></span>Europa League</span>
      <span><span class="zone-bar rel"></span>Relegation</span>
    </div>` : ""}`;
  wireStars(view);
}

// ---- manage leagues -------------------------------------------------------
async function renderManage() {
  const trackedCodes = new Set(tracked.map((l) => l.code));
  const addable = SUPPORTED_LEAGUES.filter((l) => !trackedCodes.has(l.code));
  view.innerHTML = `
    <h2>Manage leagues</h2>
    <h3 class="h2h-title">Tracked</h3>
    <ul class="league-list">${tracked.map((l) => `
      <li><span>${l.name}</span>
        <button class="chip danger" data-remove="${l.code}" ${tracked.length === 1 ? "disabled title='Keep at least one league'" : ""}>Remove</button>
      </li>`).join("")}
    </ul>
    <h3 class="h2h-title">Available</h3>
    <ul class="league-list">${addable.map((l) => `
      <li><span>${l.name}</span><button class="chip" data-add="${l.code}">＋ Track</button></li>`).join("")}
    </ul>
    <p class="muted">Tracked leagues are polled automatically every few minutes. Adding one fetches its fixtures right away.</p>`;

  view.querySelectorAll("[data-add]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Adding…";
      try {
        await api.track({ action: "add", kind: "league", code: b.dataset.add });
        await loadState();
        renderLeagueSelect();
        renderManage();
      } catch (err) {
        b.textContent = "Failed"; console.error(err);
      }
    }));
  view.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Removing…";
      try {
        await api.track({ action: "remove", kind: "league", code: b.dataset.remove });
        if (localStorage.getItem("league") === b.dataset.remove) localStorage.removeItem("league");
        await loadState();
        renderLeagueSelect();
        renderManage();
      } catch (err) {
        b.textContent = "Failed"; console.error(err);
      }
    }));
}

// ---- router ---------------------------------------------------------------
async function route() {
  const hash = location.hash || "#fixtures";
  const [page, arg] = hash.slice(1).split("/");
  document.querySelectorAll("nav a").forEach((a) =>
    a.classList.toggle("active", a.dataset.tab === page));
  view.innerHTML = skeleton();
  try {
    if (page === "standings") await renderStandings();
    else if (page === "match" && arg) await renderMatch(Number(arg));
    else if (page === "team" && arg) await renderTeam(Number(arg));
    else if (page === "leagues") await renderManage();
    else await renderFixtures();
  } catch (err) {
    view.innerHTML = empty("⚠️", `Couldn't load data (${err.message}). Retry shortly.`);
  }
}

window.addEventListener("hashchange", route);

(async () => {
  try {
    await loadState();
  } catch (err) {
    view.innerHTML = empty("⚠️", `Couldn't load data (${err.message}).`);
    return;
  }
  renderLeagueSelect();
  route();
  renderHero().catch(() => { hero.hidden = true; });
  renderFreshness().catch(() => {});
})();
