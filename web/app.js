// Hash-routed SPA: #fixtures (default), #standings, #match/<id>.
// League scope: dropdown in the header, persisted in localStorage.
// Favorites: star teams in the standings; starred teams' fixtures highlight.
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

// ---- league + favorites state --------------------------------------------
let tracked = [];        // [{id, code, name}] leagues in user_selections
let league = null;       // current {id, code, name}
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
  const trackedCodes = new Set(tracked.map((l) => l.code));
  const addable = SUPPORTED_LEAGUES.filter((l) => !trackedCodes.has(l.code));
  leagueSel.innerHTML = `
    ${tracked.map((l) => `<option value="${l.code}" ${l.code === league?.code ? "selected" : ""}>${l.name}</option>`).join("")}
    ${addable.length ? `<optgroup label="── Add a league ──">
      ${addable.map((l) => `<option value="add:${l.code}">＋ ${l.name}</option>`).join("")}
    </optgroup>` : ""}`;
}

leagueSel.addEventListener("change", async () => {
  const val = leagueSel.value;
  if (val.startsWith("add:")) {
    const code = val.slice(4);
    const name = SUPPORTED_LEAGUES.find((l) => l.code === code)?.name ?? code;
    leagueSel.disabled = true;
    view.innerHTML = `<p class="muted">Adding ${name} — fetching fixtures…</p>`;
    try {
      await api.track({ action: "add", kind: "league", code });
      await loadState();
      league = tracked.find((l) => l.code === code) ?? league;
      localStorage.setItem("league", league.code);
    } catch (err) {
      view.innerHTML = `<p class="muted">Couldn't add ${name}: ${err.message}</p>`;
    }
    leagueSel.disabled = false;
    renderLeagueSelect();
    route();
    return;
  }
  league = tracked.find((l) => l.code === val) ?? league;
  localStorage.setItem("league", league.code);
  location.hash = location.hash.startsWith("#standings") ? "#standings" : "#fixtures";
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

// ---- hero: next tracked match --------------------------------------------
async function renderHero() {
  const next = await api.nextTrackedMatch();
  if (!next) { hero.hidden = true; return; }
  const d = new Date(next.utc_date);
  const days = Math.max(0, Math.ceil((d - Date.now()) / 86_400_000));
  hero.innerHTML = `
    <div class="hero-label">Next tracked match · ${next.league}</div>
    <div class="hero-teams">
      <span>${next.home_team}</span>
      <img class="crest lg" src="${next.home_crest}" alt="" />
      <span class="vs">vs</span>
      <img class="crest lg" src="${next.away_crest}" alt="" />
      <span>${next.away_team}</span>
    </div>
    <div class="hero-when">${fmtDay.format(d)} · ${fmtTime.format(d)} · ${days ? `in ${days} day${days > 1 ? "s" : ""}` : "today"}</div>`;
  hero.hidden = false;
}

// ---- fixtures -------------------------------------------------------------
async function defaultMatchday() {
  if (!matchdayCache.has(league.id)) matchdayCache.set(league.id, await api.matchdays(league.id));
  const days = matchdayCache.get(league.id);
  const upcoming = days.find((m) => !isPlayed(m.status));
  return upcoming?.matchday ?? days.at(-1)?.matchday ?? 1;
}

async function renderFixtures(matchday) {
  if (!league) { view.innerHTML = `<p class="muted">No league tracked yet — pick one from the dropdown.</p>`; return; }
  matchday ??= await defaultMatchday();
  const matches = await api.fixtures(league.id, matchday);
  const total = Math.max(...(matchdayCache.get(league.id) ?? []).map((m) => m.matchday), matchday);

  const byDay = new Map();
  for (const m of matches) {
    const day = fmtDay.format(new Date(m.utc_date));
    (byDay.get(day) ?? byDay.set(day, []).get(day)).push(m);
  }

  view.innerHTML = `
    <div class="md-nav">
      <button ${matchday <= 1 ? "disabled" : ""} data-md="${matchday - 1}">‹</button>
      <h2>Matchday ${matchday}</h2>
      <button ${matchday >= total ? "disabled" : ""} data-md="${matchday + 1}">›</button>
    </div>
    ${matches.length === 0 ? `<p class="muted center">No fixtures published yet for this competition.</p>` : ""}
    ${[...byDay].map(([day, ms]) => `
      <h3 class="day">${day}</h3>
      <div class="matches">${ms.map(matchRow).join("")}</div>`).join("")}
    ${league.code !== "PL" ? `<p class="untrack"><a href="#" id="untrackLeague">Untrack ${league.name}</a></p>` : ""}`;

  view.querySelectorAll("[data-md]").forEach((b) =>
    b.addEventListener("click", () => renderFixtures(Number(b.dataset.md))));
  document.getElementById("untrackLeague")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await api.track({ action: "remove", kind: "league", code: league.code });
    localStorage.removeItem("league");
    await loadState();
    renderLeagueSelect();
    route();
  });
}

// ---- match detail ---------------------------------------------------------
const EVENT_ICON = {
  GOAL: "⚽", OWN_GOAL: "⚽ (og)", PENALTY_GOAL: "⚽ (pen)",
  YELLOW: "🟨", SECOND_YELLOW: "🟨🟥", RED: "🟥", SUB_ON: "▲", SUB_OFF: "▼",
};

async function renderMatch(id) {
  const [m, events] = await Promise.all([api.match(id), api.matchEvents(id)]);
  if (!m) { view.innerHTML = `<p class="muted">Match not found.</p>`; return; }
  const d = new Date(m.utc_date);

  let detailNote = "";
  if (m.status === "FINISHED" && events.length === 0) {
    detailNote = `<p class="muted">Cards & scorers ${m.detail_status === "unavailable" ? "are unavailable for this match" : "arrive shortly after full time"}.</p>`;
  } else if (!isPlayed(m.status)) {
    detailNote = `<p class="muted">Match detail appears here after kick-off.</p>`;
  }

  view.innerHTML = `
    <a class="back" href="#fixtures">‹ Fixtures</a>
    <div class="detail-card">
      <div class="detail-head">Matchday ${m.matchday ?? "–"} · ${fmtDay.format(d)} · ${fmtTime.format(d)}${m.referee ? ` · Ref: ${m.referee}` : ""}</div>
      <div class="detail-score">
        <span class="team">${m.home.name} ${crest(m.home)}</span>
        <span class="big">${isPlayed(m.status) ? `${m.home_score}–${m.away_score}` : "vs"}</span>
        <span class="team">${crest(m.away)} ${m.away.name}</span>
      </div>
      ${m.status === "FINISHED" && m.home_score_ht != null ? `<div class="muted center">HT ${m.home_score_ht}–${m.away_score_ht}</div>` : ""}
      ${STATUS_LABEL[m.status] ? `<div class="center"><span class="badge ${m.status}">${STATUS_LABEL[m.status]}</span></div>` : ""}
      ${events.length ? `<ul class="events">${events.map((e) => `
        <li><span class="minute">${e.minute ?? ""}′</span> ${EVENT_ICON[e.type] ?? e.type}
            <span>${e.player_name}</span> <span class="muted">${e.team?.tla ?? ""}${e.detail ? ` · ${e.detail}` : ""}</span></li>`).join("")}</ul>` : detailNote}
    </div>`;
}

// ---- standings ------------------------------------------------------------
async function renderStandings() {
  if (!league) { view.innerHTML = `<p class="muted">No league tracked yet.</p>`; return; }
  const rows = await api.standings(league.id);
  if (rows.length === 0) {
    view.innerHTML = `<h2>Standings</h2><p class="muted">No league table for this competition (yet).</p>`;
    return;
  }
  const preseason = rows.every((r) => r.played === 0);
  view.innerHTML = `
    <h2>Standings</h2>
    ${preseason ? `<p class="muted">Season hasn't started — the table is all zeros until then. ★ a team to make it your focus.</p>` : ""}
    <div class="table-wrap"><table class="standings">
      <thead><tr><th></th><th>#</th><th class="left">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr><td><button class="star ${favorites.has(r.team.id) ? "on" : ""}" data-team="${r.team.id}" title="Focus team">${favorites.has(r.team.id) ? "★" : "☆"}</button></td>
        <td>${r.position}</td>
        <td class="left">${crest(r.team)} ${r.team.name}</td>
        <td>${r.played}</td><td>${r.won}</td><td>${r.draw}</td><td>${r.lost}</td>
        <td>${r.goal_diff > 0 ? "+" : ""}${r.goal_diff}</td><td class="pts">${r.points}</td></tr>`).join("")}
      </tbody></table></div>`;

  view.querySelectorAll(".star").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const teamId = Number(btn.dataset.team);
      const isFav = favorites.has(teamId);
      btn.disabled = true;
      try {
        await api.track({ action: isFav ? "remove" : "add", kind: "team", teamId });
        isFav ? favorites.delete(teamId) : favorites.add(teamId);
        btn.textContent = isFav ? "☆" : "★";
        btn.classList.toggle("on", !isFav);
        renderHero().catch(() => {});
      } catch (err) {
        console.error(err);
      }
      btn.disabled = false;
    }));
}

// ---- router ---------------------------------------------------------------
async function route() {
  const hash = location.hash || "#fixtures";
  const [page, arg] = hash.slice(1).split("/");
  document.querySelectorAll("nav a").forEach((a) =>
    a.classList.toggle("active", a.dataset.tab === page));
  view.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    if (page === "standings") await renderStandings();
    else if (page === "match" && arg) await renderMatch(Number(arg));
    else await renderFixtures();
  } catch (err) {
    view.innerHTML = `<p class="muted">Couldn't load data (${err.message}). Retry shortly.</p>`;
  }
}

window.addEventListener("hashchange", route);

(async () => {
  try {
    await loadState();
  } catch (err) {
    view.innerHTML = `<p class="muted">Couldn't load data (${err.message}).</p>`;
    return;
  }
  renderLeagueSelect();
  route();
  renderHero().catch(() => { hero.hidden = true; });
})();
