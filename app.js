/* Magnolia DSP Schedule — UI. Data comes from data.js (backend object B); settings from config.js. */
(() => {
const CFG = window.MAGNOLIA, BLOCKS = CFG.blocks;
const TABS = [
  { id: "home", label: "My week" },
  { id: "schedule", label: "Schedule" },
  { id: "teams", label: "Teams & homes" },
  { id: "quiz", label: "Find my team" },
  { id: "hr", label: "HR", admin: true },
];
const LEVELS = ["DSP I", "DSP II", "Lead DSP"];

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NOW = new Date(), TODAY = iso(NOW);
const monthKey = (s) => s.slice(0, 7);
const weekStart = (s) => { const d = parse(s); const back = (d.getDay() - CFG.weekStartsOn + 7) % 7; d.setDate(d.getDate() - back); return iso(d); };
const fmt = (s, o) => parse(s).toLocaleDateString("en-US", o);
const short = (s) => fmt(s, { weekday: "short", month: "short", day: "numeric" });
const long = (s) => fmt(s, { weekday: "long", month: "long", day: "numeric" });
const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const hShort = (h) => (h % 24 === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? h + "a" : (h - 12) + "p");
const isNight = (b) => !!BLOCKS[b].night;
const monthName = (key) => parse(key + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });

/* ---------- state ---------- */
const S = {
  tab: "home", y: NOW.getFullYear(), m: NOW.getMonth(), sel: TODAY, weekRef: TODAY, hrWeekRef: TODAY, hrSub: "coverage",
  myTeamsOnly: true, hrTools: false, quiz: { i: 0, answers: [] }, editEmp: null, editTeam: null, peopleQ: "",
  me: null, mode: "connecting", loaded: false, notice: "", noAdmin: undefined, admins: null,
  teams: [], homes: [], employees: [], signups: [], settings: { announcement: "", lockedMonths: [] },
};
let B = null;

/* ---------- derived ---------- */
const teamById = (id) => S.teams.find((t) => t.id === id);
const empById = (id) => S.employees.find((e) => e.id === id);
const activeTeams = () => S.teams.filter((t) => t.active !== false).sort((a, b) => a.sort - b.sort);
const myEmp = () => (S.me ? S.employees.find((e) => e.userId === S.me.userId) : null);
const isAdmin = () => !!(S.me && S.me.isAdmin);
const isLocked = (date) => S.settings.lockedMonths.includes(monthKey(date));
const shiftsOn = (date, block, teamId) => S.signups.filter((s) => s.date === date && s.block === block && (teamId == null || s.teamId === teamId));
const empShifts = (empId, from, to) => S.signups.filter((s) => s.employeeId === empId && s.date >= from && s.date <= to).sort((a, b) => (a.date + a.block < b.date + b.block ? -1 : 1));
const rate = (emp, block) => (CFG.pay[emp.level] || CFG.pay["DSP I"]) + (emp.hasCna ? CFG.cnaBonus : 0) + (isNight(block) ? CFG.nightBonus : 0);
const weekHours = (empId, ws) => empShifts(empId, ws, addDays(ws, 6)).length * 4;
const teamClass = (t) => "tc" + ((t && t.color) || 0);
function canTake(emp, date, block, team) {
  if (!emp || !team) return false;
  if (date < TODAY || isLocked(date) || !team.needs[block]) return false;
  if (date === TODAY && BLOCKS[block].start <= NOW.getHours()) return false;
  if (!emp.teams.includes(team.id)) return false;
  if (S.signups.some((s) => s.employeeId === emp.id && s.date === date && s.block === block)) return false;
  return shiftsOn(date, block, team.id).length < team.needs[block];
}
/* the hourly cluster rotation from the proposal: each team visits clusters A–D one hour at a time */
function rotation(team, block) {
  const b = BLOCKS[block], ti = activeTeams().findIndex((t) => t.id === team.id), out = [];
  if (b.night) return null;
  for (let h = 0; h < 4; h++) {
    const c = "ABCD"[(Math.max(ti, 0) + h) % 4];
    const homes = S.homes.filter((x) => x.cluster === c).map((x) => x.name.replace(/^Home\s*/, ""));
    out.push({ hour: b.start + h, cluster: c, homes, activity: team.activities.length ? team.activities[(h + Math.max(ti, 0)) % team.activities.length] : "" });
  }
  return out;
}

/* ---------- data ---------- */
let loadSeq = 0;
async function refresh() {
  if (!B) return;
  const seq = ++loadSeq;
  S.me = B.me();
  const ms = `${S.y}-${pad(S.m + 1)}-01`;
  const me = iso(new Date(S.y, S.m + 1, 0));
  const starts = [ms, weekStart(S.weekRef), weekStart(S.hrWeekRef), weekStart(TODAY)].sort();
  const ends = [me, addDays(weekStart(S.weekRef), 6), addDays(weekStart(S.hrWeekRef), 6), addDays(TODAY, 35)].sort();
  try {
    const d = await B.load(starts[0], ends[ends.length - 1]);
    if (seq !== loadSeq) return;
    Object.assign(S, d, { mode: B.mode, loaded: true });
    if (B.mode === "live" && S.me && !S.me.isAdmin && S.noAdmin === undefined) B.hasAdmin().then((h) => { S.noAdmin = !h; render(); });
    if (isAdmin() && S.admins === null) { S.admins = []; B.listAdmins().then((a) => { S.admins = a; render(); }).catch(() => {}); }
  } catch (e) { S.notice = (e && e.friendly) || "Couldn't load the schedule. Check your connection and refresh."; }
  render();
}
async function act(fn, ok) {
  try { const r = await fn(); if (ok) toast(typeof ok === "function" ? ok(r) : ok); }
  catch (e) { toast((e && e.friendly) || "Something went wrong. Try again."); }
  await refresh();
}

/* ---------- toast, sign-in, theme ---------- */
let toastTimer;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 4000);
}
function openSignIn() { const d = $("signin"); d.showModal ? d.showModal() : d.setAttribute("open", ""); setTimeout(() => $("email").focus(), 30); }
$("signin-cancel").onclick = () => $("signin").close();
$("signin-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const email = $("email").value.trim(); if (!email) return;
  $("signin-send").disabled = true;
  try { await B.signIn(email); $("signin").close(); toast(`Check ${email} for your sign-in link.`); }
  catch (err) { toast((err && err.friendly) || "Couldn't send the link."); }
  $("signin-send").disabled = false;
});
const applyTheme = (t) => (t ? (document.documentElement.dataset.theme = t) : delete document.documentElement.dataset.theme);
try { applyTheme(localStorage.getItem("magnolia-theme")); } catch (_) {}
$("theme").onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark"; applyTheme(next); try { localStorage.setItem("magnolia-theme", next); } catch (_) {}
};

/* ---------- render shell ---------- */
function render() {
  document.title = `${CFG.appName} · ${CFG.orgName}`;
  renderWho(); renderTabs(); renderNotice();
  const v = $("view");
  if (B && B.mode === "live" && !S.me) { v.innerHTML = signedOut(); $("footer").textContent = ""; return; }
  if (!S.loaded) { v.innerHTML = `<div class="empty">Loading the schedule…</div>`; return; }
  const views = { home: viewHome, schedule: viewSchedule, teams: viewTeams, quiz: viewQuiz, hr: viewHR };
  if (S.tab === "hr" && !isAdmin()) S.tab = "home";
  v.innerHTML = (views[S.tab] || viewHome)();
  $("footer").innerHTML = B.mode === "preview"
    ? `Preview mode: demo data saved only in this browser.`
    : `${esc(CFG.orgName)} · ${esc(CFG.appName)} · updates live`;
}
function renderWho() {
  const pill = !B ? `<span class="pill"><i></i>Connecting…</span>` : B.mode === "preview" ? `<span class="pill"><i></i>Preview · demo</span>` : `<span class="pill live"><i></i>Live</span>`;
  let me = "";
  if (B && B.mode === "live" && !S.me) me = `<button class="btn" data-act="signin">Sign in</button>`;
  else if (S.me) { const e = myEmp(); me = `<span class="chip"><span class="av"><i class="tc0" style="background:var(--accent)">${esc(initials(e && e.name))}</i></span>${esc((e && e.name) || "You")}</span>` + (B.mode === "live" ? `<button class="linkbtn" data-act="signout">Sign out</button>` : ""); }
  $("who").innerHTML = pill + me;
}
function renderTabs() {
  const signedIn = !B || B.mode === "preview" || S.me;
  $("tabs").hidden = !signedIn;
  const emp = myEmp();
  $("tabs").innerHTML = TABS.filter((t) => !t.admin || isAdmin()).map((t) => {
    let count = "";
    if (t.id === "quiz" && emp && !emp.teams.length) count = `<span class="count">start here</span>`;
    return `<button role="tab" aria-selected="${S.tab === t.id}" data-act="tab" data-tab="${t.id}">${t.label}${count}</button>`;
  }).join("");
}
function renderNotice() {
  let h = S.settings.announcement ? `<div class="announce" role="note"><span class="eyebrow">Announcement</span><p>${esc(S.settings.announcement)}</p></div>` : "";
  if (S.notice) h += `<p class="notice" role="status">${esc(S.notice)}</p>`;
  if (S.noAdmin && S.me && !S.me.isAdmin) h += `<p class="notice info">This schedule has no HR admin yet. If you run it, <button class="btn sm" data-act="claim">Claim admin</button></p>`;
  $("notice").innerHTML = h;
}
function signedOut() {
  return `<section class="card hero"><div><span class="eyebrow">${esc(CFG.orgName)} · staff only</span>
    <h2>Your shifts, your team, your 40 hours, all in one place.</h2>
    <p class="muted">DSPs pick 4-hour shifts on their activity team and see their week fill up. HR sees coverage for every home at a glance.</p>
    <button class="btn lg" data-act="signin">Sign in with email</button></div>
    <ol><li><b>Find your team.</b> A 2-minute quiz matches you to House & Daily Living, On-Campus, Outings or Learning.</li>
    <li><b>Pick 4-hour shifts.</b> Want a full day? Take two back to back.</li>
    <li><b>Watch your week fill.</b> A progress bar tracks you toward 40 hours.</li></ol></section>`;
}

/* ---------- HOME ---------- */
function viewHome() {
  const emp = myEmp();
  if (!emp) return `<div class="empty"><h3>Setting up your profile…</h3>Refresh in a moment.</div>`;
  const ws = weekStart(S.weekRef), we = addDays(ws, 6);
  const mine = empShifts(emp.id, ws, we), hours = mine.length * 4, target = emp.weeklyTarget || 40;
  const pay = mine.reduce((a, s) => a + rate(emp, s.block) * 4, 0), nightH = mine.filter((s) => isNight(s.block)).length * 4;
  const scale = Math.max(target, hours, 1);
  const perTeam = {}; mine.forEach((s) => (perTeam[s.teamId] = (perTeam[s.teamId] || 0) + 4));
  const status = hours >= target ? (hours > target ? `<span class="badge warn">${hours - target} hrs over</span>` : `<span class="badge good">Target met</span>`) : `<span class="badge">${target - hours} hrs to go</span>`;
  const needName = !emp.name.trim();

  let h = `<div class="hello"><div><h2>${needName ? "Welcome!" : "Hi, " + esc(emp.name.split(" ")[0])}</h2>
    <div class="chips" style="margin-top:6px"><span class="badge">${esc(emp.level)}</span>${emp.teams.map((id) => { const t = teamById(id); return t ? `<span class="chip ${teamClass(t)}"><span class="dot tbg"></span>${esc(t.shortName)}</span>` : ""; }).join("")}</div></div></div>`;
  if (needName) h += `<div class="card" style="margin-bottom:18px"><form class="form" data-form="myname"><label class="wide">Your name (shown to HR and your team)<input name="name" maxlength="60" required placeholder="First and last name"></label><button class="btn lg">Save</button></form></div>`;
  if (!emp.teams.length) h += `<div class="card" style="margin-bottom:18px;border-color:var(--accent)"><div class="sec-title"><h2>First, find your team</h2></div><p class="muted" style="margin:0 0 12px">You'll only see and take shifts on your team(s). Take the 2-minute quiz, or pick teams yourself.</p><button class="btn lg" data-act="tab" data-tab="quiz">Take the quiz</button> <button class="btn ghost lg" data-act="tab" data-tab="teams">Browse teams</button></div>`;

  h += `<div class="grid2"><div class="stack">`;
  // week progress
  h += `<section class="card week"><div class="sec-title"><h3>Week of ${fmt(ws, { month: "short", day: "numeric" })} – ${fmt(we, { month: "short", day: "numeric" })}</h3>
    <div class="weeknav"><button data-act="week" data-d="-7" aria-label="Previous week">‹</button><button class="linkbtn" data-act="week" data-d="0">This week</button><button data-act="week" data-d="7" aria-label="Next week">›</button></div></div>
    <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap"><div class="bignum">${hours}<small> / ${target} hrs</small></div>${status}</div>
    <div class="progress" role="img" aria-label="${hours} of ${target} hours scheduled">${Object.entries(perTeam).map(([tid, n]) => { const t = teamById(+tid); return `<span class="${teamClass(t)} tbg" style="width:${(n / scale) * 100}%" title="${esc(t ? t.shortName : "")}: ${n}h"></span>`; }).join("")}<i class="target" style="left:calc(${(target / scale) * 100}% - 1px)"></i></div>
    <div class="progress-key">${Object.entries(perTeam).map(([tid, n]) => { const t = teamById(+tid); return `<span class="${teamClass(t)}"><i></i>${esc(t ? t.shortName : "")} ${n}h</span>`; }).join("") || "<span>No shifts this week yet</span>"}</div>
    <div class="statrow"><div class="stat"><div class="v">${mine.length}</div><div class="k">4-hr shifts</div></div><div class="stat"><div class="v">${money(pay)}</div><div class="k">est. pay before tax</div></div><div class="stat"><div class="v">${money(rate(emp, 2))}<small class="muted">/hr</small></div><div class="k">your day rate${nightH ? ` · +$${CFG.nightBonus.toFixed(2)} nights` : ""}</div></div></div>
    <div class="days7">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const d = addDays(ws, i), ss = mine.filter((s) => s.date === d);
      return `<button class="d7${d === TODAY ? " today" : ""}" data-act="openday" data-date="${d}"><span class="dn">${fmt(d, { weekday: "short" })} ${parse(d).getDate()}</span>${ss.length ? ss.map((s) => { const t = teamById(s.teamId); return `<span class="bar ${teamClass(t)}">${hShort(BLOCKS[s.block].start)}–${hShort(BLOCKS[s.block].end)}</span>`; }).join("") : `<span class="off">Off</span>`}</button>`; }).join("")}</div></section>`;
  // open shifts to fill the week
  h += fillWeek(emp, ws, we, hours, target);
  h += `</div><div class="stack">`;
  h += nextShift(emp) + cycleCard() + profileCard(emp);
  h += `</div></div>`;
  return h;
}
function fillWeek(emp, ws, we, hours, target) {
  if (!emp.teams.length) return "";
  const from = ws > TODAY ? ws : TODAY, list = [];
  for (let d = from; d <= we; d = addDays(d, 1)) for (let b = 0; b < 6; b++) for (const tid of emp.teams) {
    const t = teamById(tid); if (t && canTake(emp, d, b, t)) list.push({ d, b, t, eight: b < 5 && canTake(emp, d, b + 1, t) });
  }
  const title = hours >= target ? "Want extra hours?" : `Fill your week · ${target - hours} hrs to go`;
  if (!list.length) return `<section class="card"><div class="sec-title"><h3>${title}</h3></div><p class="muted" style="margin:0">No open shifts on your teams for the rest of this week. Try next week or the Schedule tab.</p></section>`;
  const dayFirst = list.sort((a, b) => (a.d !== b.d ? (a.d < b.d ? -1 : 1) : a.b - b.b || a.t.sort - b.t.sort)).slice(0, 8);
  return `<section class="card"><div class="sec-title"><h3>${title}</h3><button class="linkbtn" data-act="tab" data-tab="schedule">Full schedule</button></div><div class="openlist">${dayFirst.map((x) => {
    const open = x.t.needs[x.b] - shiftsOn(x.d, x.b, x.t.id).length;
    return `<div class="orow ${teamClass(x.t)}"><div class="d">${short(x.d)}<small>${x.d === TODAY ? "Today" : x.d === addDays(TODAY, 1) ? "Tomorrow" : ""}</small></div>
      <div class="t"><b>${BLOCKS[x.b].label}</b> ${isNight(x.b) ? `<span class="badge night">Overnight</span>` : ""}<small>${esc(x.t.shortName)} · ${open} open</small></div>
      <div class="acts"><button class="btn" data-act="take" data-date="${x.d}" data-block="${x.b}" data-team="${x.t.id}">4 hrs</button>${x.eight ? `<button class="btn ghost" data-act="take" data-date="${x.d}" data-block="${x.b}" data-team="${x.t.id}" data-two="1" title="This block plus the next one">8 hrs</button>` : ""}</div></div>`;
  }).join("")}</div></section>`;
}
function rotationHtml(team, block) {
  const r = rotation(team, block);
  if (!r) return `<p class="muted" style="margin:8px 0 0;font-size:13px">Overnight residential coverage: stay with your assigned home.</p>`;
  return `<div class="rot">${r.map((x) => `<div><b>${hShort(x.hour)}–${hShort(x.hour + 1)} · Cluster ${x.cluster}</b>${esc(x.activity)}<br><span class="muted" style="font-size:11.5px">Homes ${x.homes[0] || ""}–${x.homes[x.homes.length - 1] || ""}</span></div>`).join("")}</div>`;
}
function nextShift(emp) {
  const nowH = NOW.getHours();
  const up = empShifts(emp.id, TODAY, addDays(TODAY, 35)).filter((s) => s.date > TODAY || BLOCKS[s.block].end > nowH);
  if (!up.length) return `<section class="card"><span class="eyebrow">Next shift</span><p class="muted" style="margin:6px 0 0">Nothing booked yet.</p></section>`;
  const s = up[0], t = teamById(s.teamId), b = BLOCKS[s.block];
  const pair = up[1] && up[1].date === s.date && up[1].block === s.block + 1;
  const days = Math.round((parse(s.date) - parse(TODAY)) / 864e5);
  const when = days === 0 ? (b.start <= nowH ? "Happening now" : "Today") : days === 1 ? "Tomorrow" : `In ${days} days`;
  return `<section class="card next ${teamClass(t)}"><span class="eyebrow">Next shift · ${when}</span>
    <div class="when">${short(s.date)} · ${hShort(b.start)}–${hShort(pair ? BLOCKS[s.block + 1].end : b.end)}</div>
    <div class="muted" style="font-size:14px">${esc(t ? t.name : "")}${pair ? " · 8-hour day" : ""}</div>${t ? rotationHtml(t, s.block) : ""}</section>`;
}
function cycleCard() {
  const d = NOW.getDate(), next = iso(new Date(NOW.getFullYear(), NOW.getMonth() + 1, 1)), nk = monthKey(next);
  const locked = S.settings.lockedMonths.includes(nk);
  const due = `${parse(next).toLocaleDateString("en-US", { month: "long" })}`;
  let msg;
  if (locked) msg = `<b>${due} schedule is final.</b> Need a change? Ask your Lead DSP or HR.`;
  else if (d <= CFG.availabilityDueDay) msg = `<b>Pick your ${due} shifts by the ${CFG.availabilityDueDay}th.</b> HR publishes the final schedule by the ${CFG.schedulePublishDay}th.`;
  else msg = `<b>HR is finalizing ${due}.</b> Schedule out by the ${CFG.schedulePublishDay}th. You can still add open shifts until then.`;
  return `<section class="card"><span class="eyebrow">Schedule cycle</span><p style="margin:6px 0 0;font-size:14px">${msg}</p></section>`;
}
function profileCard(emp) {
  return `<section class="card"><span class="eyebrow">My profile</span>
    <div class="checks" style="margin:10px 0"><label><input type="checkbox" data-act="mylicense" ${emp.hasLicense ? "checked" : ""}> I have a driver's license</label><label><input type="checkbox" data-act="mycna" ${emp.hasCna ? "checked" : ""}> CNA certified (+$${CFG.cnaBonus.toFixed(2)}/hr)</label>
    <label><input type="checkbox" data-act="remind" ${S.me && S.me.reminders !== false ? "checked" : ""}> Email me the night before a shift</label></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-act="ics">Add my shifts to my phone calendar</button><button class="linkbtn" data-act="rename">Change name</button></div></section>`;
}

/* ---------- SCHEDULE ---------- */
function viewSchedule() {
  const emp = myEmp(), first = new Date(S.y, S.m, 1).getDay(), days = new Date(S.y, S.m + 1, 0).getDate(), mk = `${S.y}-${pad(S.m + 1)}`;
  let cal = "";
  for (let i = 0; i < first; i++) cal += `<div class="cell pad" aria-hidden="true"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${mk}-${pad(d)}`, mine = emp ? S.signups.filter((s) => s.employeeId === emp.id && s.date === ds).sort((a, b) => a.block - b.block) : [];
    let need = 0, have = 0;
    for (const t of activeTeams()) for (let b = 0; b < 6; b++) { need += t.needs[b]; have += Math.min(shiftsOn(ds, b, t.id).length, t.needs[b]); }
    const pct = need ? have / need : 1;
    cal += `<button class="cell${ds < TODAY ? " past" : ""}" data-act="day" data-date="${ds}" aria-pressed="${ds === S.sel}" aria-label="${long(ds)}, ${Math.round(pct * 100)}% staffed${mine.length ? ", you work " + mine.length * 4 + " hours" : ""}">
      <span class="num">${d}${ds === TODAY ? `<span class="badge good" style="padding:0 5px">Today</span>` : ""}</span>
      ${mine.map((s) => { const t = teamById(s.teamId); return `<span class="mine ${teamClass(t)}">${hShort(BLOCKS[s.block].start)} ${esc(t ? t.shortName : "")}</span>`; }).join("")}
      <span class="cov${pct < 0.7 ? " low" : ""}" title="${Math.round(pct * 100)}% staffed"><span style="width:${pct * 100}%"></span></span></button>`;
  }
  return `<div class="grid2"><div><div class="calhead"><button class="iconbtn" data-act="month" data-d="-1" aria-label="Previous month">‹</button><h2>${monthName(mk)}</h2><button class="iconbtn" data-act="month" data-d="1" aria-label="Next month">›</button>
    ${isLocked(mk + "-01") ? `<span class="badge good">Published</span>` : `<span class="badge">Open for sign-up</span>`}</div>
    <div class="dow">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => `<div>${x}</div>`).join("")}</div><div class="cal">${cal}</div>
    <p class="muted" style="font-size:12.5px;margin-top:10px">Colored tags are your shifts. The bar under each day shows how fully staffed it is (orange = short).</p></div>
    <aside class="card day" id="day">${dayPanel(emp)}</aside></div>`;
}
function dayPanel(emp) {
  const ds = S.sel, past = ds < TODAY, locked = isLocked(ds);
  const hr = isAdmin() && S.hrTools;
  const teams = activeTeams().filter((t) => hr || !S.myTeamsOnly || !emp || emp.teams.includes(t.id));
  let h = `<div class="sec-title"><div><h2>${long(ds)}</h2><span class="muted" style="font-size:13px">${past ? "Past day · view only" : locked ? "Published schedule · changes go through HR" : "Tap 4 hrs for one block, 8 hrs for two in a row"}</span></div>
    <span class="checks">${emp && !hr ? `<label><input type="checkbox" data-act="myonly" ${S.myTeamsOnly ? "checked" : ""}> My teams only</label>` : ""}${isAdmin() ? `<label><input type="checkbox" data-act="hrtools" ${S.hrTools ? "checked" : ""}> HR tools</label>` : ""}</span></div>`;
  if (!teams.length) return h + `<div class="empty">You're not on a team yet. <button class="linkbtn" data-act="tab" data-tab="quiz">Find your team</button></div>`;
  for (let b = 0; b < 6; b++) {
    const here = teams.filter((t) => t.needs[b] > 0); if (!here.length) continue;
    const myHere = emp && S.signups.find((s) => s.employeeId === emp.id && s.date === ds && s.block === b);
    h += `<div class="blockrow"><div class="bl">${BLOCKS[b].label}<br>${isNight(b) ? `<span class="badge night">Overnight +$${CFG.nightBonus.toFixed(2)}</span>` : ""}</div><div class="slots">`;
    for (const t of here) {
      const ppl = shiftsOn(ds, b, t.id), need = t.needs[b], amMine = myHere && myHere.teamId === t.id, onTeam = emp && emp.teams.includes(t.id);
      let acts = "";
      if (amMine && !past && !locked) acts = `<button class="btn ghost sm" data-act="drop" data-id="${myHere.id}">Drop</button>`;
      else if (amMine) acts = `<span class="badge good">You</span>`;
      else if (canTake(emp, ds, b, t)) acts = `<button class="btn sm" data-act="take" data-date="${ds}" data-block="${b}" data-team="${t.id}">4 hrs</button>` + (b < 5 && canTake(emp, ds, b + 1, t) ? ` <button class="btn ghost sm" data-act="take" data-date="${ds}" data-block="${b}" data-team="${t.id}" data-two="1">8 hrs</button>` : "");
      else if (myHere) acts = `<span class="muted" style="font-size:12px">You're on ${esc((teamById(myHere.teamId) || {}).shortName || "another team")}</span>`;
      else if (emp && !onTeam) acts = `<span class="muted" style="font-size:12px">Not your team</span>`;
      if (hr && ppl.length < need) {
        const free = S.employees.filter((e) => e.active !== false && e.teams.includes(t.id) && !S.signups.some((s) => s.employeeId === e.id && s.date === ds && s.block === b));
        if (free.length) acts += ` <select data-assign="${ds}|${b}|${t.id}" aria-label="Assign someone"><option value="">Assign…</option>${free.map((e) => `<option value="${esc(e.id)}">${esc(e.name || "Unnamed")}</option>`).join("")}</select>`;
      }
      h += `<div class="slot ${teamClass(t)}${amMine ? " mine" : ""}${emp && !onTeam && !hr ? " dim" : ""}"><span class="nm">${esc(t.shortName)}</span><span class="fill${ppl.length >= need ? " full" : ""}">${ppl.length}/${need}</span>${acts}
        ${ppl.length ? `<div class="ppl">${ppl.map((s) => { const e = empById(s.employeeId); return `<span class="av${emp && s.employeeId === emp.id ? " me" : ""}"><i class="${teamClass(t)}">${esc(initials(e && e.name))}</i>${esc(e ? e.name.split(" ")[0] : "?")}${hr ? `<button data-act="remove" data-id="${s.id}" data-name="${esc(e ? e.name : "")}" aria-label="Remove">×</button>` : ""}</span>`; }).join("")}</div>` : ""}</div>`;
    }
    h += `</div></div>`;
  }
  return h;
}

/* ---------- TEAMS & HOMES ---------- */
function viewTeams() {
  const emp = myEmp();
  let h = `<div class="sec-title"><h2>Activity teams</h2><span class="muted" style="font-size:13px">Each team: 1 Lead DSP, 2 DSP II, 1–2 DSP I</span></div><div class="grid3">`;
  for (const t of activeTeams()) {
    const on = emp && emp.teams.includes(t.id), members = S.employees.filter((e) => e.active !== false && e.teams.includes(t.id)).length;
    h += `<article class="card team ${teamClass(t)}"><h3>${esc(t.name)}</h3><p class="muted" style="margin:0;font-size:13.5px">${esc(t.description)}</p>
      <div class="acts">${t.activities.map((a) => `<span>${esc(a)}</span>`).join("")}</div>
      <div><span class="eyebrow">Works</span><div class="blocksmini" style="margin-top:4px">${BLOCKS.map((b, i) => `<span class="${t.needs[i] ? "on" : ""}" title="${b.label}: ${t.needs[i]} needed">${hShort(b.start)}</span>`).join("")}</div></div>
      <div class="foot"><span class="muted" style="font-size:12.5px">${members} DSPs${t.needsLicense ? " · license required" : ""}</span>
      ${emp ? (on ? `<button class="btn ghost sm" data-act="leave" data-team="${t.id}">Leave team</button>` : `<button class="btn sm" data-act="join" data-team="${t.id}">Join team</button>`) : ""}</div></article>`;
  }
  h += `</div>`;
  // career ladder
  const lvl = emp ? emp.level : "";
  h += `<section class="card" style="margin-top:18px"><div class="sec-title"><h2>Career ladder</h2><span class="muted" style="font-size:13px">+$${CFG.cnaBonus.toFixed(2)}/hr with CNA · +$${CFG.nightBonus.toFixed(2)}/hr overnight (8 PM–8 AM) · +$1/hr merit month for core-value awards</span></div>
    <div class="ladder">${[["DSP I", "First 6 months. Shadow shifts, learn your team's routine."], ["DSP II", "After 6 months. Helps run activities and works with volunteers."], ["Lead DSP", "After 1 year (bachelor's or CNA). Leads the team, mentors DSP I, weekly check-ins."]].map(([n, d]) => `<div class="rung${n === lvl ? " me" : ""}"><span class="eyebrow">${n}${n === lvl ? " · you" : ""}</span><div class="v">$${CFG.pay[n].toFixed(2)}<small class="muted" style="font-size:13px">/hr</small></div><div class="muted" style="font-size:13px">${d}</div></div>`).join("")}</div></section>`;
  // homes by cluster
  h += `<section style="margin-top:18px"><div class="sec-title"><h2>Homes by cluster</h2><span class="muted" style="font-size:13px">${S.homes.length} homes · ${S.homes.reduce((a, x) => a + (+x.residents || 0), 0)} residents</span></div><div class="clusters">`;
  for (const c of "ABCD") {
    const hs = S.homes.filter((x) => x.cluster === c).sort((a, b) => a.sort - b.sort);
    h += `<div class="card cluster"><h3>Cluster ${c}</h3><ul>${hs.map((x) => `<li><span>${esc(x.name)}</span><span class="muted">${esc(x.location)} · ${x.residents}</span></li>`).join("") || "<li class='muted'>No homes</li>"}</ul></div>`;
  }
  h += `</div></section>`;
  // sample rotation
  const teams = activeTeams().filter((t) => !BLOCKS[3].night && t.needs[3]);
  h += `<section class="card" style="margin-top:18px"><div class="sec-title"><h2>How a 12–4 PM shift rotates</h2><span class="muted" style="font-size:13px">Each team visits every cluster once, one hour at a time</span></div><div class="tw"><table class="grid"><thead><tr><th>Hour</th>${"ABCD".split("").map((c) => `<th>Cluster ${c}</th>`).join("")}</tr></thead><tbody>`;
  for (let hr = 0; hr < 4; hr++) {
    h += `<tr><th>${hShort(12 + hr)}–${hShort(13 + hr)}</th>`;
    for (const c of "ABCD") {
      const t = teams.find((tt) => { const r = rotation(tt, 3); return r && r[hr].cluster === c; });
      h += t ? `<td class="${teamClass(t)}"><b>${esc(rotation(t, 3)[hr].activity)}</b><small>${esc(t.shortName)}</small></td>` : `<td style="background:var(--sunk);border-left-color:var(--line)"><small>Home staff</small></td>`;
    }
    h += `</tr>`;
  }
  h += `</tbody></table></div><p class="muted" style="font-size:12px;margin:8px 0 0">Illustrative. Every home also keeps its own continuous residential coverage.</p></section>`;
  return h;
}

/* ---------- QUIZ ---------- */
const QUIZ = [
  { q: "Pick your ideal afternoon at work.", a: [["Cooking a great meal and getting a home in order", "house"], ["Gardening, shooting hoops or doing crafts outside", "campus"], ["A trip to the mall or the bowling alley", "outings"], ["Reading together or a music session", "learning"]] },
  { q: "You feel your best when you're…", a: [["Keeping a steady routine and taking care of a home", "house"], ["Up and moving, active all day", "campus"], ["Out in the community, meeting people", "outings"], ["Teaching and helping someone learn something new", "learning"]] },
  { q: "How do you feel about driving residents around town?", a: [["I'd rather not drive", "house,campus,learning"], ["Happy to, and I have a license", "outings"], ["Sometimes is fine", "campus,outings"]] },
  { q: "Which hours fit your life best?", a: [["Nights or early mornings work for me", "house"], ["Daytime, 8 AM to 8 PM", "campus,outings,learning"], ["Flexible, whatever's needed", "house,outings"]] },
  { q: "Your biggest strength?", a: [["Organized and patient", "house"], ["Energetic and sporty", "campus"], ["Outgoing and social", "outings"], ["Calm and creative", "learning"]] },
  { q: "Which moment would make your day?", a: [["Helping someone get ready for their job at Ochsner", "house"], ["Seeing someone hit a new fitness goal", "campus"], ["Watching someone light up at a community event", "outings"], ["Hearing someone read a whole page on their own", "learning"]] },
];
function quizScores(answers) {
  const sc = {};
  answers.forEach((ai, qi) => { if (ai == null) return; const keys = QUIZ[qi].a[ai][1].split(","); keys.forEach((k) => (sc[k] = (sc[k] || 0) + 1 / keys.length)); });
  return sc;
}
function viewQuiz() {
  const emp = myEmp(), Q = S.quiz;
  if (Q.i < QUIZ.length) {
    const it = QUIZ[Q.i];
    return `<div class="card quiz"><span class="eyebrow">Find my team · question ${Q.i + 1} of ${QUIZ.length}</span><div class="qprog"><span style="width:${(Q.i / QUIZ.length) * 100}%"></span></div>
      <h2>${esc(it.q)}</h2><div class="opts">${it.a.map((a, i) => `<button class="opt" data-act="answer" data-i="${i}" aria-pressed="${Q.answers[Q.i] === i}">${esc(a[0])}</button>`).join("")}</div>
      ${Q.i ? `<div class="rowact" style="justify-content:flex-start"><button class="linkbtn" data-act="qback">Back</button></div>` : ""}</div>`;
  }
  const sc = quizScores(Q.answers), max = Math.max(1, ...Object.values(sc));
  const ranked = activeTeams().filter((t) => sc[t.key] != null || ["house", "campus", "outings", "learning"].includes(t.key)).map((t) => ({ t, v: sc[t.key] || 0 })).sort((a, b) => b.v - a.v);
  const top = ranked[0], second = ranked[1];
  const noLicense = Q.answers[2] === 0;
  return `<div class="card quiz"><span class="eyebrow">Your match</span><div class="qprog"><span style="width:100%"></span></div>
    <h2>You'd thrive on ${esc(top.t.name)}</h2><p class="muted" style="margin:0">${esc(top.t.description)}</p>
    <div class="scores">${ranked.map((r) => `<div class="score ${teamClass(r.t)}"><span>${esc(r.t.shortName)}</span><span class="b"><span style="width:${(r.v / max) * 100}%"></span></span><span class="mono" style="font-size:12px">${Math.round((r.v / QUIZ.length) * 100)}%</span></div>`).join("")}</div>
    ${noLicense && top.t.needsLicense ? `<p class="notice">This team needs a driver's license. You said you'd rather not drive, so consider your second match.</p>` : ""}
    <div class="rowact" style="justify-content:flex-start">${emp ? `<button class="btn lg" data-act="quizjoin" data-teams="${top.t.id}">Join ${esc(top.t.shortName)}</button>${second && second.v > 0 ? `<button class="btn ghost lg" data-act="quizjoin" data-teams="${top.t.id},${second.t.id}">Join ${esc(top.t.shortName)} + ${esc(second.t.shortName)}</button>` : ""}` : ""}<button class="linkbtn" data-act="qreset">Retake</button></div>
    <p class="muted" style="font-size:12.5px;margin:12px 0 0">You can change teams anytime on the Teams tab. HR may adjust teams to keep every home covered.</p></div>`;
}

/* ---------- HR ---------- */
function viewHR() {
  const subs = [["coverage", "Coverage"], ["people", "Employees"], ["teams", "Teams & staffing"], ["homes", "Homes"], ["settings", "Settings"]];
  const body = { coverage: hrCoverage, people: hrPeople, teams: hrTeams, homes: hrHomes, settings: hrSettings }[S.hrSub]();
  return `<div class="subtabs">${subs.map(([id, l]) => `<button data-act="hrsub" data-sub="${id}" aria-pressed="${S.hrSub === id}">${l}</button>`).join("")}</div>${body}`;
}
function hrWeekNav() {
  const ws = weekStart(S.hrWeekRef);
  return `<div class="weeknav"><button data-act="hrweek" data-d="-7" aria-label="Previous week">‹</button><b style="min-width:9em;text-align:center">${fmt(ws, { month: "short", day: "numeric" })} – ${fmt(addDays(ws, 6), { month: "short", day: "numeric" })}</b><button data-act="hrweek" data-d="7" aria-label="Next week">›</button><button class="linkbtn" data-act="hrweek" data-d="0">This week</button></div>`;
}
function hrCoverage() {
  const ws = weekStart(S.hrWeekRef), days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ws, i)), teams = activeTeams();
  let need = 0, have = 0, shortSlots = 0;
  for (const d of days) for (const t of teams) for (let b = 0; b < 6; b++) { const n = t.needs[b], c = Math.min(shiftsOn(d, b, t.id).length, n); need += n; have += c; if (c < n) shortSlots += n - c; }
  const emps = S.employees.filter((e) => e.active !== false), hrs = emps.map((e) => ({ e, h: weekHours(e.id, ws) }));
  const under = hrs.filter((x) => x.h < x.e.weeklyTarget).length, over = hrs.filter((x) => x.h > x.e.weeklyTarget).length;
  const payroll = S.signups.filter((s) => s.date >= ws && s.date <= days[6]).reduce((a, s) => { const e = empById(s.employeeId); return a + (e ? rate(e, s.block) * 4 : 0); }, 0);
  let h = `<div class="sec-title"><h2>Coverage</h2>${hrWeekNav()}</div><div class="cards">
    <div class="card kpi"><div class="v">${need ? Math.round((have / need) * 100) : 0}%</div><div class="k">of needed shifts filled (${have}/${need})</div></div>
    <div class="card kpi${shortSlots ? " warn" : ""}"><div class="v">${shortSlots}</div><div class="k">open DSP slots this week</div></div>
    <div class="card kpi${under ? " warn" : ""}"><div class="v">${under}</div><div class="k">DSPs under their weekly target</div></div>
    <div class="card kpi"><div class="v">${money(payroll)}</div><div class="k">scheduled payroll (est.)${over ? ` · ${over} over target` : ""}</div></div></div>`;
  h += `<div class="card tw"><table class="covgrid"><thead><tr><th>Block</th>${days.map((d) => `<th>${fmt(d, { weekday: "short", month: "numeric", day: "numeric" })}</th>`).join("")}</tr></thead><tbody>`;
  for (let b = 0; b < 6; b++) {
    const tb = teams.filter((t) => t.needs[b]); if (!tb.length) continue;
    h += `<tr><th>${BLOCKS[b].label}</th>${days.map((d) => `<td>${tb.map((t) => { const c = shiftsOn(d, b, t.id).length, n = t.needs[b]; return `<div class="tm ${teamClass(t)}${c < n ? " short" : ""}" title="${esc(t.shortName)}"><i></i>${c}/${n}</div>`; }).join("")}</td>`).join("")}</tr>`;
  }
  h += `</tbody></table><div class="progress-key" style="margin-top:8px">${teams.map((t) => `<span class="${teamClass(t)}"><i></i>${esc(t.shortName)}</span>`).join("")}<span style="color:var(--warn)">orange = short-staffed</span></div></div>
    <div class="rowact"><button class="btn ghost" data-act="csv">Download this week (CSV)</button><button class="btn quiet" data-act="print">Print</button></div>`;
  return h;
}
function hrPeople() {
  const ws = weekStart(S.hrWeekRef), q = S.peopleQ.toLowerCase();
  const list = S.employees.filter((e) => !q || (e.name + " " + e.email + " " + e.level).toLowerCase().includes(q)).sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active === false ? 1 : -1));
  let h = `<div class="sec-title"><h2>Employees</h2>${hrWeekNav()}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><input id="peopleq" placeholder="Search name, email or level" value="${esc(S.peopleQ)}" style="flex:1;min-width:200px"><button class="btn" data-act="addemp">Add employee</button></div>`;
  if (S.editEmp) h += empForm(S.editEmp);
  h += `<div class="tw"><table class="data"><thead><tr><th>Name</th><th>Level</th><th>Teams</th><th>Hours this week</th><th>Rate</th><th>Login</th><th></th></tr></thead><tbody>`;
  for (const e of list) {
    const hrs = weekHours(e.id, ws), tgt = e.weeklyTarget || 0, admin = S.admins && e.userId && S.admins.includes(e.userId);
    h += `<tr${e.active === false ? ' style="opacity:.5"' : ""}><td><b>${esc(e.name || "Unnamed")}</b>${e.demo ? ' <span class="badge">demo</span>' : ""}${admin ? ' <span class="badge good">HR</span>' : ""}<br><span class="muted" style="font-size:12px">${esc(e.email)}${e.hasLicense ? " · license" : ""}${e.hasCna ? " · CNA" : ""}</span></td>
      <td>${esc(e.level)}</td><td>${e.teams.map((id) => { const t = teamById(id); return t ? `<span class="chip ${teamClass(t)}" style="margin:1px"><span class="dot tbg"></span>${esc(t.shortName)}</span>` : ""; }).join("") || '<span class="muted">none</span>'}</td>
      <td style="white-space:nowrap"><span class="minibar${hrs < tgt ? " low" : ""}"><span style="width:${Math.min(100, tgt ? (hrs / tgt) * 100 : 100)}%"></span></span><span class="mono">${hrs}/${tgt}</span></td>
      <td class="n">${money(rate(e, 2))}</td><td>${e.userId ? "Yes" : '<span class="muted">No</span>'}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn quiet sm" data-act="editemp" data-id="${esc(e.id)}">Edit</button>${e.userId && S.me && e.userId !== S.me.userId ? ` <button class="linkbtn" data-act="admin" data-user="${esc(e.userId)}" data-on="${admin ? 0 : 1}" data-name="${esc(e.name)}">${admin ? "Remove HR" : "Make HR"}</button>` : ""}</td></tr>`;
  }
  return h + `</tbody></table></div>`;
}
function empForm(e) {
  return `<form class="card form" data-form="emp" style="margin-bottom:14px"><input type="hidden" name="id" value="${esc(e.id || "")}">
    <label>Name<input name="name" value="${esc(e.name || "")}" required maxlength="60"></label>
    <label>Level<select name="level">${LEVELS.map((l) => `<option${l === e.level ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    <label>Weekly hours target<input name="target" type="number" min="0" max="60" value="${e.weeklyTarget == null ? 40 : e.weeklyTarget}"></label>
    <label>Hire date<input name="hire" type="date" value="${esc(e.hireDate || TODAY)}"></label>
    <div class="wide"><span class="eyebrow">Teams</span><div class="checks">${activeTeams().map((t) => `<label><input type="checkbox" name="team" value="${t.id}" ${(e.teams || []).includes(t.id) ? "checked" : ""}> ${esc(t.shortName)}</label>`).join("")}</div></div>
    <div class="wide checks"><label><input type="checkbox" name="license" ${e.hasLicense ? "checked" : ""}> Driver's license</label><label><input type="checkbox" name="cna" ${e.hasCna ? "checked" : ""}> CNA</label><label><input type="checkbox" name="active" ${e.active !== false ? "checked" : ""}> Active</label></div>
    <div class="wide rowact" style="margin:0"><button type="button" class="btn quiet" data-act="cancelemp">Cancel</button><button class="btn">${e.id ? "Save" : "Add employee"}</button></div></form>`;
}
function hrTeams() {
  let h = `<div class="sec-title"><h2>Teams & staffing</h2><button class="btn" data-act="addteam">Add team</button></div><p class="muted" style="margin:-4px 0 14px;font-size:13.5px">"Needed" = DSPs per 4-hour block. Set 0 for blocks a team doesn't work.</p><div class="stack">`;
  const list = S.editTeam === "new" ? [...activeTeams(), { id: null, name: "", shortName: "", description: "", activities: [], needs: [0, 0, 5, 5, 5, 0], color: S.teams.length % 8, needsLicense: false }] : activeTeams();
  for (const t of list) {
    h += `<form class="card form ${teamClass(t)}" data-form="team" style="border-top:5px solid var(--tc)"><input type="hidden" name="id" value="${t.id || ""}">
      <label>Team name<input name="name" value="${esc(t.name)}" required maxlength="60"></label><label>Short name<input name="short" value="${esc(t.shortName)}" maxlength="24"></label>
      <label>Color<select name="color">${[0, 1, 2, 3, 4, 5, 6, 7].map((c) => `<option value="${c}"${c === t.color ? " selected" : ""}>Color ${c + 1}</option>`).join("")}</select></label>
      <label class="wide">Description<input name="desc" value="${esc(t.description)}" maxlength="400"></label>
      <label class="wide">Activities (comma separated)<input name="acts" value="${esc(t.activities.join(", "))}"></label>
      <div class="wide"><span class="eyebrow">Needed per block</span><div class="needs">${BLOCKS.map((b, i) => `<label>${b.label}<input name="need${i}" type="number" min="0" max="50" value="${t.needs[i] || 0}"></label>`).join("")}</div></div>
      <div class="wide checks"><label><input type="checkbox" name="license" ${t.needsLicense ? "checked" : ""}> Driver's license required</label>${t.id ? `<label><input type="checkbox" name="active" checked> Active</label>` : ""}</div>
      <div class="wide rowact" style="margin:0">${t.id ? "" : `<button type="button" class="btn quiet" data-act="cancelteam">Cancel</button>`}<button class="btn">Save team</button></div></form>`;
  }
  return h + `</div>`;
}
function hrHomes() {
  let h = `<div class="sec-title"><h2>Homes</h2><button class="btn" data-act="addhome">Add home</button></div><div class="tw"><table class="data"><thead><tr><th>Name</th><th>Cluster</th><th>Location</th><th>Residents</th><th></th></tr></thead><tbody>`;
  for (const x of [...S.homes].sort((a, b) => (a.cluster + String(a.sort).padStart(3, "0") < b.cluster + String(b.sort).padStart(3, "0") ? -1 : 1))) {
    h += `<tr><td><input data-home="${x.id}" data-f="name" value="${esc(x.name)}" maxlength="60"></td>
      <td><select data-home="${x.id}" data-f="cluster">${"ABCD".split("").map((c) => `<option${c === x.cluster ? " selected" : ""}>${c}</option>`).join("")}</select></td>
      <td><select data-home="${x.id}" data-f="location">${["Campus", "Community"].map((c) => `<option${c === x.location ? " selected" : ""}>${c}</option>`).join("")}</select></td>
      <td><input data-home="${x.id}" data-f="residents" type="number" min="0" max="20" value="${x.residents}" style="width:70px"></td>
      <td style="text-align:right"><button class="linkbtn" data-act="delhome" data-id="${x.id}" data-name="${esc(x.name)}">Remove</button></td></tr>`;
  }
  return h + `</tbody></table></div><p class="muted" style="font-size:12.5px">Changes save when you leave a field.</p>`;
}
function hrSettings() {
  const thisM = monthKey(TODAY), nextM = monthKey(iso(new Date(NOW.getFullYear(), NOW.getMonth() + 1, 1)));
  const demo = S.employees.filter((e) => e.demo).length;
  return `<div class="stack"><section class="card"><span class="eyebrow">Announcement banner</span><textarea id="ann" rows="2" maxlength="280" style="width:100%;margin:8px 0" placeholder="e.g. Staff appreciation lunch Friday at 3 PM. Leave empty to hide.">${esc(S.settings.announcement)}</textarea><button class="btn" data-act="ann">Save announcement</button></section>
    <section class="card"><span class="eyebrow">Publish schedules</span><p style="margin:6px 0 12px;font-size:14px">DSPs pick next month's shifts by the ${CFG.availabilityDueDay}th. Publish by the ${CFG.schedulePublishDay}th to lock it: DSPs can't add or drop shifts after that, but HR can still assign and remove.</p>
      ${[thisM, nextM].map((m) => { const on = S.settings.lockedMonths.includes(m); return `<div style="display:flex;align-items:center;gap:10px;margin:6px 0"><b style="min-width:9em">${monthName(m)}</b>${on ? `<span class="badge good">Published</span><button class="btn quiet sm" data-act="lock" data-m="${m}" data-on="0">Reopen</button>` : `<span class="badge">Open</span><button class="btn sm" data-act="lock" data-m="${m}" data-on="1">Publish &amp; lock</button>`}</div>`; }).join("")}</section>
    <section class="card"><span class="eyebrow">Demo data</span><p style="margin:6px 0 12px;font-size:14px">${demo} demo DSPs (Sally Thompson and team) and their shifts are loaded for presentations.</p>
      ${demo ? `<button class="btn danger" data-act="wipedemo">Remove demo data</button>` : ""}${B.mode === "preview" ? ` <button class="btn quiet" data-act="resetdemo">Reset preview</button>` : ""}</section></div>`;
}

/* ---------- actions ---------- */
function goDay(ds) { const d = parse(ds); S.y = d.getFullYear(); S.m = d.getMonth(); S.sel = ds; S.tab = "schedule"; syncHash(); refresh(); }
function syncHash() { const h = "#" + S.tab; if (location.hash !== h) history.replaceState(null, "", location.pathname + location.search + h); }
async function takeShift(date, block, teamId, two, employeeId) {
  const t = teamById(teamId);
  await act(async () => { await B.take(date, block, teamId, employeeId); if (two) await B.take(date, block + 1, teamId, employeeId); },
    `Booked ${short(date)}, ${hShort(BLOCKS[block].start)}–${hShort(BLOCKS[block + (two ? 1 : 0)].end)} · ${t ? t.shortName : ""}`);
}
const actions = {
  signin: openSignIn,
  signout: () => act(() => B.signOut(), "Signed out."),
  claim: () => act(async () => { const ok = await B.claimAdmin(); S.noAdmin = false; if (!ok) throw Object.assign(new Error(), { friendly: "Someone already claimed admin." }); }, "You're the HR admin now."),
  tab: (d) => { S.tab = d.tab; syncHash(); render(); window.scrollTo(0, 0); },
  week: (d) => { S.weekRef = +d.d ? addDays(S.weekRef, +d.d) : TODAY; refresh(); },
  hrweek: (d) => { S.hrWeekRef = +d.d ? addDays(S.hrWeekRef, +d.d) : TODAY; refresh(); },
  month: (d) => { let m = S.m + +d.d, y = S.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } S.y = y; S.m = m; const f = `${y}-${pad(m + 1)}-01`; S.sel = monthKey(TODAY) === monthKey(f) ? TODAY : f; refresh(); },
  day: (d) => { S.sel = d.date; render(); if (matchMedia("(max-width: 880px)").matches) $("day").scrollIntoView({ behavior: "smooth", block: "start" }); },
  openday: (d) => goDay(d.date),
  take: (d) => takeShift(d.date, +d.block, +d.team, d.two === "1"),
  drop: (d) => act(() => B.drop(+d.id), "Shift dropped."),
  remove: (d) => { if (confirm(`Remove ${d.name} from this shift?`)) act(() => B.drop(+d.id), `Removed ${d.name}.`); },
  join: (d) => {
    const emp = myEmp(), t = teamById(+d.team);
    if (t.needsLicense && !emp.hasLicense && !confirm(`${t.name} needs a driver's license. Join anyway and tell HR you'll have one?`)) return;
    act(() => B.updateMe({ teams: [...new Set([...emp.teams, t.id])] }), `You joined ${t.shortName}.`);
  },
  leave: (d) => { const emp = myEmp(); act(() => B.updateMe({ teams: emp.teams.filter((x) => x !== +d.team) }), "Left the team."); },
  answer: (d) => { S.quiz.answers[S.quiz.i] = +d.i; S.quiz.i++; render(); },
  qback: () => { S.quiz.i = Math.max(0, S.quiz.i - 1); render(); },
  qreset: () => { S.quiz = { i: 0, answers: [] }; render(); },
  quizjoin: (d) => {
    const emp = myEmp(), ids = d.teams.split(",").map(Number);
    const patch = { teams: [...new Set([...emp.teams, ...ids])], quizTeam: ids[0] };
    if (S.quiz.answers[2] === 1) patch.hasLicense = true;
    act(() => B.updateMe(patch), "Team saved. Your matching shifts are on the My week tab.").then(() => { S.tab = "home"; syncHash(); render(); });
  },
  myonly: () => { S.myTeamsOnly = !S.myTeamsOnly; render(); },
  ics: () => {
    const emp = myEmp(); const ss = empShifts(emp.id, TODAY, addDays(TODAY, 35));
    if (!ss.length) return toast("No upcoming shifts to add yet.");
    const ev = ss.map((s) => { const t = teamById(s.teamId), b = BLOCKS[s.block], r = t && rotation(t, s.block);
      return { uid: `${s.id}`, date: s.date, start: b.start, end: b.end, title: `${t ? t.shortName : "Shift"} · Magnolia`, description: r ? r.map((x) => `${hShort(x.hour)}: Cluster ${x.cluster} · ${x.activity}`).join("\n") : "Overnight residential coverage" }; });
    downloadFile("magnolia-shifts.ics", buildIcs(ev, "Magnolia shifts"), "text/calendar");
    toast(`Downloaded ${ss.length} shifts. Open the file to add them to your calendar.`);
  },
  rename: () => { const emp = myEmp(); const v = prompt("Your name", emp.name); if (v && v.trim()) act(() => B.updateMe({ name: v.trim().slice(0, 60) }), "Name saved."); },
  hrsub: (d) => { S.hrSub = d.sub; S.editEmp = null; S.editTeam = null; render(); },
  addemp: () => { S.editEmp = { id: null, name: "", level: "DSP I", weeklyTarget: 40, teams: [], hasLicense: false, hasCna: false, active: true, hireDate: TODAY }; render(); },
  editemp: (d) => { S.editEmp = { ...empById(d.id) }; render(); window.scrollTo({ top: 0, behavior: "smooth" }); },
  cancelemp: () => { S.editEmp = null; render(); },
  admin: (d) => { const on = d.on === "1"; if (confirm(on ? `Make ${d.name} an HR admin? They'll see everyone's info and can change schedules.` : `Remove HR access from ${d.name}?`)) act(async () => { await B.setAdmin(d.user, on); S.admins = null; }, on ? `${d.name} is now HR.` : `${d.name} is no longer HR.`); },
  addteam: () => { S.editTeam = "new"; render(); },
  cancelteam: () => { S.editTeam = null; render(); },
  addhome: () => act(() => B.saveHome({ name: `Home ${S.homes.length + 1}`, cluster: "D", location: "Community", residents: 6 }), "Home added."),
  delhome: (d) => { if (confirm(`Remove ${d.name}?`)) act(() => B.deleteHome(+d.id), "Home removed."); },
  ann: () => { const v = $("ann").value.trim().slice(0, 280); act(() => B.saveAnnouncement(v), v ? "Announcement posted." : "Announcement removed."); },
  lock: (d) => act(() => B.setLock(d.m, d.on === "1"), d.on === "1" ? `${monthName(d.m)} published and locked.` : `${monthName(d.m)} reopened.`),
  wipedemo: () => { if (confirm("Remove all demo DSPs and their shifts? Real people and their shifts stay.")) act(() => B.wipeDemo(), (n) => `Removed ${n} demo DSPs.`); },
  resetdemo: () => { if (confirm("Reset all preview data on this device?")) { B.resetDemo(); } },
  print: () => window.print(),
  csv: () => {
    const ws = weekStart(S.hrWeekRef), we = addDays(ws, 6), q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [["Date", "Block", "Team", "Employee", "Level", "Hours", "Rate"].map(q).join(",")];
    S.signups.filter((s) => s.date >= ws && s.date <= we).sort((a, b) => (a.date + a.block < b.date + b.block ? -1 : 1)).forEach((s) => {
      const e = empById(s.employeeId), t = teamById(s.teamId);
      rows.push([s.date, BLOCKS[s.block].label, t ? t.name : "", e ? e.name : "", e ? e.level : "", 4, e ? rate(e, s.block).toFixed(2) : ""].map(q).join(","));
    });
    downloadFile(`magnolia-schedule-${ws}.csv`, rows.join("\n"), "text/csv");
  },
};
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]"); if (!el || el.tagName === "INPUT") return;
  const fn = actions[el.dataset.act]; if (fn) { ev.preventDefault(); fn(el.dataset); }
});
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.matches("select[data-assign]") && el.value) {
    const [d, b, t] = el.dataset.assign.split("|"), e = empById(el.value);
    takeShift(d, +b, +t, false, el.value).then(() => toast(`Assigned ${e ? e.name : ""}.`));
  } else if (el.dataset.act === "mylicense") act(() => B.updateMe({ hasLicense: el.checked }), "Saved.");
  else if (el.dataset.act === "mycna") act(() => B.updateMe({ hasCna: el.checked }), "Saved.");
  else if (el.dataset.act === "remind") act(() => B.setReminders(el.checked), el.checked ? "Reminders on." : "Reminders off.");
  else if (el.dataset.act === "myonly") { S.myTeamsOnly = el.checked; render(); }
  else if (el.dataset.act === "hrtools") { S.hrTools = el.checked; render(); }
  else if (el.dataset.home) {
    const h = S.homes.find((x) => x.id === +el.dataset.home); if (!h) return;
    const v = el.dataset.f === "residents" ? +el.value : el.value; if (h[el.dataset.f] === v) return;
    act(() => B.saveHome({ ...h, [el.dataset.f]: v }), "Saved.");
  }
});
document.addEventListener("input", (ev) => {
  if (ev.target.id === "peopleq") { S.peopleQ = ev.target.value; const pos = ev.target.selectionStart; render(); const n = $("peopleq"); n.focus(); n.setSelectionRange(pos, pos); }
});
document.addEventListener("submit", (ev) => {
  const f = ev.target.closest("form[data-form]"); if (!f) return; ev.preventDefault();
  const fd = new FormData(f), kind = f.dataset.form;
  if (kind === "myname") act(() => B.updateMe({ name: String(fd.get("name")).trim().slice(0, 60) }), "Welcome aboard!");
  if (kind === "emp") {
    const emp = { id: fd.get("id") || null, name: String(fd.get("name")).trim(), level: fd.get("level"), weeklyTarget: +fd.get("target") || 0, hireDate: fd.get("hire"),
      teams: fd.getAll("team").map(Number), hasLicense: !!fd.get("license"), hasCna: !!fd.get("cna"), active: !!fd.get("active") };
    act(async () => { await B.hrSaveEmployee(emp); S.editEmp = null; }, emp.id ? "Employee saved." : "Employee added.");
  }
  if (kind === "team") {
    const t = { id: +fd.get("id") || null, name: String(fd.get("name")).trim(), shortName: String(fd.get("short") || fd.get("name")).trim().slice(0, 24), description: String(fd.get("desc")).trim(),
      activities: String(fd.get("acts")).split(",").map((x) => x.trim()).filter(Boolean), needs: BLOCKS.map((_, i) => Math.max(0, +fd.get("need" + i) || 0)),
      color: +fd.get("color") || 0, needsLicense: !!fd.get("license"), active: fd.get("id") ? !!fd.get("active") : true };
    act(async () => { await B.saveTeam(t); S.editTeam = null; }, "Team saved.");
  }
});

/* ---------- boot ---------- */
const h0 = location.hash.slice(1);
if (TABS.some((t) => t.id === h0)) S.tab = h0;
window.addEventListener("hashchange", () => { const t = location.hash.slice(1); if (TABS.some((x) => x.id === t) && t !== S.tab) { S.tab = t; render(); } });
render();
(async () => {
  B = await createBackend();
  await B.init(() => refresh());
  S.mode = B.mode;
  await refresh();
  if (location.hash && !TABS.some((t) => "#" + t.id === location.hash)) syncHash();
})();
})();
