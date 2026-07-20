// Hash-routed SPA: #fixtures (default), #standings, #match/<id>.
import { api } from "./api.js";

const view = document.getElementById("view");
const hero = document.getElementById("hero");

const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

const STATUS_LABEL = {
  SCHEDULED: "", TIMED: "", IN_PLAY: "LIVE", PAUSED: "HT",
  FINISHED: "FT", POSTPONED: "PPD", SUSPENDED: "SUSP", CANCELLED: "CANC",
};
const isPlayed = (s) => ["IN_PLAY", "PAUSED", "FINISHED"].includes(s);

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
  return `<a class="match ${m.status === "IN_PLAY" ? "live" : ""}" href="#match/${m.id}">
    <span class="team home">${m.home.short_name ?? m.home.name} ${crest(m.home)}</span>
    ${scoreOrTime(m)}
    <span class="team away">${crest(m.away)} ${m.away.short_name ?? m.away.name}</span>
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
let matchdayCache = null; // [{matchday, status, utc_date}]

async function defaultMatchday() {
  matchdayCache ??= await api.matchdays();
  const upcoming = matchdayCache.find((m) => !isPlayed(m.status) && m.status !== "FINISHED");
  return upcoming?.matchday ?? matchdayCache.at(-1)?.matchday ?? 1;
}

async function renderFixtures(matchday) {
  matchday ??= await defaultMatchday();
  const matches = await api.fixtures(matchday);
  const total = Math.max(...(matchdayCache ?? []).map((m) => m.matchday), matchday);

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
    ${[...byDay].map(([day, ms]) => `
      <h3 class="day">${day}</h3>
      <div class="matches">${ms.map(matchRow).join("")}</div>`).join("")}`;

  view.querySelectorAll("[data-md]").forEach((b) =>
    b.addEventListener("click", () => renderFixtures(Number(b.dataset.md))));
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
      <div class="detail-head">Matchday ${m.matchday} · ${fmtDay.format(d)} · ${fmtTime.format(d)}${m.referee ? ` · Ref: ${m.referee}` : ""}</div>
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
  const rows = await api.standings();
  const preseason = rows.every((r) => r.played === 0);
  view.innerHTML = `
    <h2>Standings</h2>
    ${preseason ? `<p class="muted">Season starts Aug 21 — table resets to zero until then.</p>` : ""}
    <div class="table-wrap"><table class="standings">
      <thead><tr><th>#</th><th class="left">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr><td>${r.position}</td>
        <td class="left">${crest(r.team)} ${r.team.name}</td>
        <td>${r.played}</td><td>${r.won}</td><td>${r.draw}</td><td>${r.lost}</td>
        <td>${r.goal_diff > 0 ? "+" : ""}${r.goal_diff}</td><td class="pts">${r.points}</td></tr>`).join("")}
      </tbody></table></div>`;
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
route();
renderHero().catch(() => { hero.hidden = true; });
