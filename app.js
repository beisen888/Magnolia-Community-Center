/* Magnolia DSP Schedule — UI. Data comes from data.js (backend object B); settings from config.js.
 * Staffing rules (slotNeed, clusterBlock, clusterMap…) live in data.js so both backends and this file agree. */
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
const STAFFING = { fixed: "One group per block", home: "Per house", cluster: "Per outing cluster (monthly)" };

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
const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const hShort = (h) => (h % 24 === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? h + "a" : (h - 12) + "p");
const clock = (mins) => { const h = Math.floor(mins / 60) % 24, m = mins % 60; return `${h % 12 || 12}${m ? ":" + pad(m) : ""} ${h >= 12 ? "PM" : "AM"}`; };
const isNight = (b) => !!BLOCKS[b].night;
const monthName = (key) => parse(key + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });
const addMonth = (key, n) => { const d = parse(key + "-01"); d.setMonth(d.getMonth() + n); return iso(d).slice(0, 7); };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* ---------- state ---------- */
const S = {
  tab: "home", y: NOW.getFullYear(), m: NOW.getMonth(), sel: TODAY, weekRef: TODAY, hrWeekRef: TODAY, hrSub: "coverage", resMonth: monthKey(TODAY),
  myTeamsOnly: true, hrTools: false, quiz: { i: 0, answers: [] }, editEmp: null, editTeam: null, peopleQ: "", open: "", pick: "",
  me: null, mode: "connecting", loaded: false, notice: "", noAdmin: undefined, admins: null, push: { supported: false, here: false, ios: false }, newPriv: "",
  teams: [], homes: [], employees: [], signups: [], residents: [], clusters: [], waitlist: [], settings: { announcement: "", lockedWeeks: [], vapidPublic: "" },
};
let B = null;

/* ---------- derived ---------- */
const teamById = (id) => S.teams.find((t) => t.id === id);
const empById = (id) => S.employees.find((e) => e.id === id);
const homeById = (id) => S.homes.find((h) => h.id === id);
const activeTeams = () => S.teams.filter((t) => t.active !== false).sort((a, b) => a.sort - b.sort);
const sortedHomes = () => [...S.homes].sort((a, b) => a.sort - b.sort || a.id - b.id);
const myEmp = () => (S.me ? S.employees.find((e) => e.userId === S.me.userId) : null);
const isAdmin = () => !!(S.me && S.me.isAdmin);
const isLocked = (date) => (S.settings.lockedWeeks || []).includes(weekStart(date));
const lastPickDay = () => addDays(weekStart(TODAY), 7 * (CFG.signupWeeksAhead + 1) - 1);
const leadOf = (emp) => emp && emp.level === "Lead DSP";
const ctx = () => ({ homes: S.homes, residents: S.residents, clusters: S.clusters });
const teamClass = (t) => "tc" + ((t && t.color) || 0);

/* fast lookups, rebuilt after every load */
const skey = (s) => `${s.date}|${s.block}|${s.teamId}|${s.homeId ?? ""}|${s.clusterNo ?? ""}`;
let IDX = { slot: new Map(), team: new Map(), wait: new Map(), cm: {} };
function reindex() {
  IDX = { slot: new Map(), team: new Map(), wait: new Map(), cm: {} };
  const push = (m, k, v) => { const a = m.get(k); a ? a.push(v) : m.set(k, [v]); };
  for (const s of S.signups) { push(IDX.slot, skey(s), s); push(IDX.team, `${s.date}|${s.block}|${s.teamId}`, s); }
  for (const w of [...S.waitlist].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) push(IDX.wait, skey(w), w);
}
const inSlot = (sl) => IDX.slot.get(skey(sl)) || [];
const inTeam = (date, block, teamId) => IDX.team.get(`${date}|${block}|${teamId}`) || [];
const waitOf = (sl) => IDX.wait.get(skey(sl)) || [];
const monthClusters = (month) => (IDX.cm[month] ||= clusterMap(S.clusters, S.residents, month));
const groupOf = (date, clusterNo) => (clusterNo == null ? null : monthClusters(monthKey(date))[clusterNo] || null);

/* every bookable slot ("unit") a team has in one block: one per house, one per outing cluster going out, or one shared pool */
function units(team, date, block) {
  const base = team.needs[block] || 0; if (!base || team.active === false) return [];
  const u = (homeId, clusterNo, need, label, extra) => ({ date, block, teamId: team.id, homeId, clusterNo, need, label, ...extra });
  if (team.staffing === "home") return sortedHomes().map((h) => u(h.id, null, base, h.name, { short: h.name.replace(/^Home\s*/i, "") }));
  if (team.staffing === "cluster") {
    const cm = monthClusters(monthKey(date)), nos = Object.keys(cm).map(Number).sort((a, b) => a - b);
    if (!nos.length) return [u(null, null, base, "")];
    return nos.filter((c) => clusterBlock(team, date, c) === block).map((c) => u(null, c, base + cm[c].ones, `Cluster ${c}`, { short: String(c), group: cm[c] }));
  }
  return [u(null, null, base, "")];
}
function totals(team, date, block) {
  let need = 0, have = 0;
  for (const x of units(team, date, block)) { need += x.need; have += Math.min(inSlot(x).length, x.need); }
  // sign-ups that no longer match a slot (e.g. a house removed) still show as people
  return { need, have };
}
const extraMin = (s) => { const t = teamById(s.teamId), g = t && t.staffing === "cluster" && groupOf(s.date, s.clusterNo); return g && g.ones ? 30 : 0; };
const shiftHours = (s) => 4 + extraMin(s) / 60;
const placeOf = (s) => { const h = s.homeId != null && homeById(s.homeId); return h ? h.name : s.clusterNo != null ? `Cluster ${s.clusterNo}` : ""; };
const startsAt = (s) => shiftStart(s.date, s.block);
const canDrop = (s) => startsAt(s) - Date.now() > DROP_HOURS * 36e5;
const empShifts = (empId, from, to) => S.signups.filter((s) => s.employeeId === empId && s.date >= from && s.date <= to).sort((a, b) => (a.date + a.block < b.date + b.block ? -1 : 1));
const weekHours = (empId, ws) => empShifts(empId, ws, addDays(ws, 6)).reduce((a, s) => a + shiftHours(s), 0);
const hrsTxt = (h) => (Math.round(h * 10) / 10).toString();
const busyAt = (emp, date, block) => emp && S.signups.find((s) => s.employeeId === emp.id && s.date === date && s.block === block);
const myWait = (emp, sl) => emp && waitOf(sl).find((w) => w.employeeId === emp.id);

function basicOk(emp, date, block, team) {
  if (!emp || !team || !emp.teams.includes(team.id)) return false;
  if (date < TODAY || date > lastPickDay()) return false;
  if (date === TODAY && BLOCKS[block].start <= NOW.getHours()) return false;
  return true;
}
function canTake(emp, sl, team) {
  if (!basicOk(emp, sl.date, sl.block, team) || isLocked(sl.date) || busyAt(emp, sl.date, sl.block)) return false;
  const need = sl.need ?? slotNeed(team, sl.date, sl.block, sl.homeId ?? null, sl.clusterNo ?? null, ctx());
  return need > 0 && inSlot(sl).length < need;
}
function canWait(emp, sl, team) {
  if (!basicOk(emp, sl.date, sl.block, team) || busyAt(emp, sl.date, sl.block) || myWait(emp, sl)) return false;
  const need = sl.need ?? slotNeed(team, sl.date, sl.block, sl.homeId ?? null, sl.clusterNo ?? null, ctx());
  return need > 0 && inSlot(sl).length >= need && waitOf(sl).length < WAITLIST_MAX;
}
/* the house this DSP usually works (keeps people consistent with the same residents) */
function usualHome(emp, teamId) {
  const c = {}; for (const s of S.signups) if (s.employeeId === emp.id && s.teamId === teamId && s.homeId != null) c[s.homeId] = (c[s.homeId] || 0) + 1;
  const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return best ? +best[0] : null;
}
/* the hourly area rotation from the proposal: each on-campus team visits areas A–D one hour at a time */
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
  const starts = [ms, weekStart(S.weekRef), weekStart(S.hrWeekRef), weekStart(TODAY), S.resMonth + "-01"].sort();
  const ends = [me, addDays(weekStart(S.weekRef), 6), addDays(weekStart(S.hrWeekRef), 6), addDays(TODAY, 35), iso(new Date(+S.resMonth.slice(0, 4), +S.resMonth.slice(5), 0))].sort();
  try {
    const d = await B.load(starts[0], ends[ends.length - 1]);
    if (seq !== loadSeq) return;
    Object.assign(S, d, { mode: B.mode, loaded: true });
    reindex();
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
  t.textContent = msg; t.hidden = false; t.classList.remove("show"); void t.offsetWidth; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 4500);
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

/* ---------- phone alerts (web push) ---------- */
const b64uBytes = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const bytesB64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function swReg() { return navigator.serviceWorker.register("/sw.js"); }
async function checkPush() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let here = false;
  try {
    if (supported && B && B.mode === "preview") here = (await B.pushStatus()).count > 0 && Notification.permission === "granted";
    else if (supported) { const reg = await navigator.serviceWorker.getRegistration("/"); here = !!(reg && (await reg.pushManager.getSubscription())); }
  } catch (_) {}
  S.push = { supported, here, ios, needsInstall: ios && !standalone, denied: supported && Notification.permission === "denied" };
}
async function enablePush() {
  if (S.push.needsInstall) return toast("On iPhone: tap Share, then 'Add to Home Screen', open Magnolia from your home screen, and turn alerts on there.");
  if (!S.push.supported) return toast("This browser can't get alerts. Try Chrome, or Safari from your home screen. You'll still get emails.");
  if (B.mode === "live" && !S.settings.vapidPublic) return toast("HR hasn't finished setting up phone alerts yet. You'll still get emails.");
  try {
    const reg = await swReg(); await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { await checkPush(); render(); return toast("Alerts are blocked. Allow notifications for this site in your phone's settings."); }
    if (B.mode === "preview") {
      await B.savePush();
      reg.showNotification("Magnolia · sample alert", { body: "Tomorrow: 8 AM–4 PM · House & Daily Living · Home 7", icon: "/icon.svg" });
    } else {
      const old = await reg.pushManager.getSubscription();
      const sub = old || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(S.settings.vapidPublic) }));
      await B.savePush(sub);
    }
    await checkPush(); render(); toast("Phone alerts are on: 24 hours and 1 hour before each shift.");
  } catch (e) { toast((e && e.friendly) || "Couldn't turn on alerts on this device."); }
}
async function disablePush() {
  try {
    if (B.mode === "preview") await B.removePush();
    else { const reg = await navigator.serviceWorker.getRegistration("/"); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) { await B.removePush(sub.endpoint); await sub.unsubscribe(); } }
  } catch (_) {}
  await checkPush(); render(); toast("Phone alerts off for this device. You'll still get emails.");
}

/* ---------- render shell ---------- */
let lastViewKey = "", countdownTimer = null;
function untilText(ms) {
  if (ms <= 0) return "";
  const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return "Starts in " + (d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm} min`);
}
function startCountdowns() {
  clearInterval(countdownTimer);
  const tick = () => document.querySelectorAll("[data-at]").forEach((el) => { el.textContent = untilText(+el.dataset.at - Date.now()); });
  tick(); if (document.querySelector("[data-at]")) countdownTimer = setInterval(tick, 30000);
}
function render() {
  document.title = `${CFG.appName} · ${CFG.orgName}`;
  renderWho(); renderTabs(); renderNotice();
  const v = $("view");
  if (B && B.mode === "live" && !S.me) { v.innerHTML = signedOut(); $("footer").textContent = ""; return; }
  if (!S.loaded) { v.innerHTML = `<div class="empty">Loading the schedule…</div>`; return; }
  const views = { home: viewHome, schedule: viewSchedule, teams: viewTeams, quiz: viewQuiz, hr: viewHR };
  if (S.tab === "hr" && !isAdmin()) S.tab = "home";
  v.innerHTML = (views[S.tab] || viewHome)();
  const key = [S.tab, S.weekRef, S.hrSub, S.hrWeekRef, S.y, S.m, S.quiz.i, S.resMonth].join("|");
  if (key !== lastViewKey) { lastViewKey = key; v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter"); }
  startCountdowns();
  $("footer").innerHTML = B.mode === "preview"
    ? `Preview mode: demo data saved only in this browser.`
    : `${esc(CFG.orgName)} · ${esc(CFG.appName)} · updates live`;
}
function renderWho() {
  const pill = !B ? `<span class="pill"><i></i>Connecting…</span>` : B.mode === "preview" ? `<span class="pill"><i></i>Preview · demo</span>` : `<span class="pill live"><i></i>Live</span>`;
  let me = "";
  if (B && B.mode === "live" && !S.me) me = `<button class="btn" data-act="signin">Sign in</button>`;
  else if (S.me) { const e = myEmp(); me = `<span class="chip"><span class="av"><i style="background:var(--accent);color:var(--accent-ink)">${esc(initials(e && e.name))}</i></span>${esc((e && e.name) || "You")}</span>` + (B.mode === "live" ? `<button class="linkbtn" data-act="signout">Sign out</button>` : ""); }
  $("who").innerHTML = pill + me;
}
function renderTabs() {
  const signedIn = !B || B.mode === "preview" || S.me;
  $("tabs").parentElement.hidden = !signedIn;
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
    <li><b>Pick 4-hour shifts.</b> Want a full day? Take two back to back. Full? Join the waitlist.</li>
    <li><b>Get a heads-up.</b> Phone alerts 24 hours and 1 hour before every shift.</li></ol></section>`;
}

/* ---------- small shared pieces ---------- */
const avatar = (e, t, extra = "") => `<span class="av"><i class="${teamClass(t)}">${esc(initials(e && e.name))}</i>${esc(e ? e.name.split(" ")[0] : "?")}${leadOf(e) ? ` <b class="lead">Lead</b>` : ""}${extra}</span>`;
const timeRange = (s, two) => { const b = BLOCKS[s.block], end = (two ? BLOCKS[s.block + 1].end : b.end) * 60 + extraMin(s); return `${clock(b.start * 60)}–${clock(end)}`; };
function groupHtml(g, compact) {
  if (!g) return "";
  return `<div class="residents${compact ? " compact" : ""}">${g.members.map((r) => { const h = homeById(r.homeId); return `<span class="res${r.ownDsp ? " one" : ""}" title="${esc(h ? h.name : "")}">${esc(r.firstName)}${compact ? "" : `<small>${esc(h ? h.name.replace(/^Home\s*/i, "H") : "")}</small>`}${r.ownDsp ? `<b>1:1</b>` : ""}</span>`; }).join("")}</div>
    ${g.ones ? (compact ? `<p class="muted note">1:1 = needs their own DSP · +${g.ones} DSP, about 30 min longer</p>` : `<p class="muted note">${plural(g.ones, "resident")} here ${g.ones === 1 ? "needs" : "need"} their own DSP, so this outing gets ${g.ones} extra DSP${g.ones === 1 ? "" : "s"} and runs about 30 minutes longer.</p>`) : ""}`;
}

/* ---------- HOME ---------- */
function viewHome() {
  const emp = myEmp();
  if (!emp) return `<div class="empty"><h3>Setting up your profile…</h3>Refresh in a moment.</div>`;
  const ws = weekStart(S.weekRef), we = addDays(ws, 6);
  const mine = empShifts(emp.id, ws, we), hours = mine.reduce((a, s) => a + shiftHours(s), 0), target = emp.weeklyTarget || 40;
  const scale = Math.max(target, hours, 1);
  const perTeam = {}; mine.forEach((s) => (perTeam[s.teamId] = (perTeam[s.teamId] || 0) + shiftHours(s)));
  const status = hours >= target ? (hours > target ? `<span class="badge warn">${hrsTxt(hours - target)} hrs over</span>` : `<span class="badge good">Target met</span>`) : `<span class="badge">${hrsTxt(target - hours)} hrs to go</span>`;
  const needName = !emp.name.trim();

  let h = `<div class="hello"><div><h2>${needName ? "Welcome!" : "Hi, " + esc(emp.name.split(" ")[0])}</h2>
    <div class="chips" style="margin-top:6px"><span class="badge">${esc(emp.level)}</span>${emp.teams.map((id) => { const t = teamById(id); return t ? `<span class="chip ${teamClass(t)}"><span class="dot tbg"></span>${esc(t.shortName)}</span>` : ""; }).join("")}</div></div></div>`;
  if (needName) h += `<div class="card" style="margin-bottom:18px"><form class="form" data-form="myname"><label class="wide">Your name (shown to HR and your team)<input name="name" maxlength="60" required placeholder="First and last name"></label><button class="btn lg">Save</button></form></div>`;
  if (!emp.teams.length) h += `<div class="card" style="margin-bottom:18px;border-color:var(--accent)"><div class="sec-title"><h2>First, find your team</h2></div><p class="muted" style="margin:0 0 12px">You'll only see and take shifts on your team(s). Take the 2-minute quiz, or pick teams yourself.</p><button class="btn lg" data-act="tab" data-tab="quiz">Take the quiz</button> <button class="btn ghost lg" data-act="tab" data-tab="teams">Browse teams</button></div>`;

  if (!seenTips() && emp.teams.length) h += `<section class="card tips"><div class="sec-title"><h3>Welcome to the new schedule</h3><button class="btn sm" data-act="tipsdone">Got it</button></div>
    <ol><li><b>Pick shifts below.</b> House shifts name your house; outing shifts name your resident cluster.</li><li><b>Shift full?</b> Join the waitlist. If someone drops, you're added automatically.</li><li><b>Turn on phone alerts</b> (My profile) for a heads-up 24 hours and 1 hour before.</li></ol></section>`;
  h += `<div class="grid2"><div class="stack">`;
  h += `<section class="card week"><div class="sec-title"><h3>Week of ${fmt(ws, { month: "short", day: "numeric" })} – ${fmt(we, { month: "short", day: "numeric" })}</h3>
    <div class="weeknav"><button data-act="week" data-d="-7" aria-label="Previous week">‹</button><button class="linkbtn" data-act="week" data-d="0">This week</button><button data-act="week" data-d="7" aria-label="Next week">›</button></div></div>
    <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap"><div class="bignum">${hrsTxt(hours)}<small> / ${target} hrs</small></div>${status}<span class="muted" style="font-size:14px;margin-left:auto">${plural(mine.length, "shift")}${isLocked(ws) ? " · final schedule" : ""}</span></div>
    <div class="progress" role="img" aria-label="${hrsTxt(hours)} of ${target} hours scheduled">${Object.entries(perTeam).map(([tid, n]) => { const t = teamById(+tid); return `<span class="${teamClass(t)} tbg" style="width:${(n / scale) * 100}%" title="${esc(t ? t.shortName : "")}: ${hrsTxt(n)}h"></span>`; }).join("")}<i class="target" style="left:calc(${(target / scale) * 100}% - 1px)"></i></div>
    <div class="progress-key">${Object.entries(perTeam).map(([tid, n]) => { const t = teamById(+tid); return `<span class="${teamClass(t)}"><i></i>${esc(t ? t.shortName : "")} ${hrsTxt(n)}h</span>`; }).join("") || "<span>No shifts this week yet</span>"}</div>
    <div class="days7">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const d = addDays(ws, i), ss = mine.filter((s) => s.date === d);
      return `<button class="d7${d === TODAY ? " today" : ""}" data-act="openday" data-date="${d}"><span class="dn">${fmt(d, { weekday: "short" })} ${parse(d).getDate()}</span>${ss.length ? ss.map((s) => { const t = teamById(s.teamId), p = placeOf(s); return `<span class="bar ${teamClass(t)}" title="${esc(t ? t.shortName : "")}${p ? " · " + esc(p) : ""}">${hShort(BLOCKS[s.block].start)}–${hShort(BLOCKS[s.block].end)}${p ? `<em>${esc(p.replace(/^Home\s*/i, "H").replace(/^Cluster\s*/i, "C"))}</em>` : ""}</span>`; }).join("") : `<span class="off">Off</span>`}</button>`; }).join("")}</div></section>`;
  h += fillWeek(emp, ws, we, hours, target);
  h += `</div><div class="stack">`;
  h += nextShift(emp) + waitCard(emp) + myTeamCard(emp, ws, we) + cycleCard() + profileCard(emp);
  h += `</div></div>`;
  return h;
}
let selSeq = 0;
function fillWeek(emp, ws, we, hours, target) {
  if (!emp.teams.length) return "";
  const from = ws > TODAY ? ws : TODAY, list = [];
  for (let d = from; d <= we && list.length < 40; d = addDays(d, 1)) for (let b = 0; b < 6; b++) for (const tid of emp.teams) {
    const t = teamById(tid); if (!t || !basicOk(emp, d, b, t) || isLocked(d) || busyAt(emp, d, b)) continue;
    const open = units(t, d, b).filter((u) => inSlot(u).length < u.need);
    if (!open.length) continue;
    let pick = open[0];
    if (t.staffing === "home") { const fav = usualHome(emp, t.id); pick = open.find((u) => u.homeId === fav) || open.sort((a, b2) => inSlot(a).length - inSlot(b2).length)[0]; }
    list.push({ d, b, t, open, pick });
  }
  const title = hours >= target ? "Want extra hours?" : `Fill your week · ${hrsTxt(target - hours)} hrs to go`;
  if (!list.length) return `<section class="card"><div class="sec-title"><h3>${title}</h3></div><p class="muted" style="margin:0">No open shifts on your teams for the rest of this week. Try next week, or join a waitlist on the Schedule tab.</p></section>`;
  const rows = list.sort((a, b) => (a.d !== b.d ? (a.d < b.d ? -1 : 1) : a.b - b.b || a.t.sort - b.t.sort)).slice(0, 8);
  return `<section class="card"><div class="sec-title"><h3>${title}</h3><button class="linkbtn" data-act="tab" data-tab="schedule">Full schedule</button></div><div class="openlist">${rows.map((x) => {
    const multi = x.t.staffing !== "fixed" && x.pick.label, id = "u" + ++selSeq;
    const next = x.b < 5 && x.t.staffing !== "cluster" && units(x.t, x.d, x.b + 1).find((u) => u.homeId === x.pick.homeId && u.clusterNo === x.pick.clusterNo);
    const eight = next && canTake(emp, next, x.t);
    const sel = multi ? `<select id="${id}" class="unitsel" aria-label="${x.t.staffing === "home" ? "House" : "Cluster"}">${x.open.map((u) => `<option value="${u.homeId ?? ""}|${u.clusterNo ?? ""}"${u === x.pick ? " selected" : ""}>${esc(u.label)} · ${u.need - inSlot(u).length} open</option>`).join("")}</select>` : "";
    const opens = x.open.reduce((a, u) => a + u.need - inSlot(u).length, 0);
    return `<div class="orow ${teamClass(x.t)}"><div class="d">${short(x.d)}<small>${x.d === TODAY ? "Today" : x.d === addDays(TODAY, 1) ? "Tomorrow" : ""}</small></div>
      <div class="t"><b>${BLOCKS[x.b].label}</b> ${isNight(x.b) ? `<span class="badge night">Overnight</span>` : ""}<small>${esc(x.t.shortName)} · ${opens} open${x.t.staffing === "home" ? ` in ${plural(x.open.length, "house")}` : ""}</small>${sel}</div>
      <div class="acts"><button class="btn" data-act="take" data-date="${x.d}" data-block="${x.b}" data-team="${x.t.id}" data-home="${x.pick.homeId ?? ""}" data-cl="${x.pick.clusterNo ?? ""}"${multi ? ` data-sel="${id}"` : ""}>4 hrs</button>${eight ? `<button class="btn ghost" data-act="take" data-date="${x.d}" data-block="${x.b}" data-team="${x.t.id}" data-home="${x.pick.homeId ?? ""}" data-cl="" data-two="1"${multi ? ` data-sel="${id}"` : ""} title="This block plus the next one">8 hrs</button>` : ""}</div></div>`;
  }).join("")}</div></section>`;
}
function seenTips() { try { return localStorage.getItem("magnolia-tips-done") === "1"; } catch (_) { return true; } }
function waitCard(emp) {
  const mine = S.waitlist.filter((w) => w.employeeId === emp.id && w.date >= TODAY).sort((a, b) => (a.date + a.block < b.date + b.block ? -1 : 1));
  if (!mine.length) return "";
  return `<section class="card"><span class="eyebrow">My waitlists</span><div class="waits">${mine.map((w) => { const t = teamById(w.teamId), q = waitOf(w), pos = q.findIndex((x) => x.id === w.id) + 1;
    return `<div class="wrow ${teamClass(t)}"><div><b>${short(w.date)} · ${BLOCKS[w.block].label}</b><small>${esc(t ? t.shortName : "")}${placeOf(w) ? " · " + esc(placeOf(w)) : ""}</small></div><span class="badge">#${pos} of ${q.length}</span><button class="linkbtn" data-act="leavewait" data-id="${w.id}">Leave</button></div>`; }).join("")}</div>
    <p class="muted note">If someone drops, the first person in line gets the shift automatically and an alert.</p></section>`;
}
function myTeamCard(emp, ws, we) {
  if (!emp.teams.length) return "";
  const mine = empShifts(emp.id, ws, we), mates = {};
  for (const s of mine) for (const o of inSlot(s)) if (o.employeeId !== emp.id) mates[o.employeeId] = (mates[o.employeeId] || 0) + 1;
  const top = Object.entries(mates).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const leads = emp.teams.map((id) => { const t = teamById(id); const l = S.employees.filter((e) => e.active !== false && e.teams.includes(id) && e.level === "Lead DSP"); return t ? `<div class="rosterrow"><span class="eyebrow ${teamClass(t)}" style="color:var(--tc)">${esc(t.shortName)}</span><span>Lead: ${l.length ? l.map((e) => esc(e.name)).join(", ") : '<span class="muted">not assigned</span>'}</span></div>` : ""; }).join("");
  const home = emp.teams.map((id) => teamById(id)).find((t) => t && t.staffing === "home");
  const fav = home && usualHome(emp, home.id), favH = fav && homeById(fav);
  return `<section class="card"><span class="eyebrow">My team</span><div class="roster mt" style="margin-top:8px">${leads}${favH ? `<div class="rosterrow"><span class="eyebrow">My house</span><span>${esc(favH.name)} <span class="muted">· usually</span></span></div>` : ""}</div>
    <div style="margin-top:10px;font-size:14px"><b>Working with you this week</b><div class="mates">${top.length ? top.map(([id, n]) => { const e = empById(id); return `<span class="av"><i style="background:var(--accent);color:var(--accent-ink)">${esc(initials(e && e.name))}</i>${esc(e ? e.name.split(" ")[0] : "?")}${leadOf(e) ? ' <b class="lead">Lead</b>' : ""} <span class="muted">· ${n}</span></span>`; }).join("") : '<span class="muted">Pick shifts to see who you\'ll work with.</span>'}</div></div></section>`;
}
function rotationHtml(team, s) {
  if (team.staffing === "home") { const h = homeById(s.homeId); const rs = S.residents.filter((r) => r.active !== false && r.homeId === s.homeId); return `<p class="muted note">Stay with ${esc(h ? h.name : "your house")}${rs.length ? ": " + rs.map((r) => esc(r.firstName)).join(", ") : ""}.</p>`; }
  if (team.staffing === "cluster") { const g = groupOf(s.date, s.clusterNo); return g ? `<div style="margin-top:10px"><b style="font-size:13.5px">Your cluster: ${plural(g.members.length, "resident")}</b>${groupHtml(g, true)}</div>` : ""; }
  const r = rotation(team, s.block);
  if (!r) return `<p class="muted note">Overnight residential coverage.</p>`;
  return `<div class="rot">${r.map((x) => `<div><b>${hShort(x.hour)}–${hShort(x.hour + 1)} · Area ${x.cluster}</b>${esc(x.activity)}<br><span class="muted" style="font-size:11.5px">Homes ${x.homes[0] || ""}–${x.homes[x.homes.length - 1] || ""}</span></div>`).join("")}</div>`;
}
function nextShift(emp) {
  const nowH = NOW.getHours();
  const up = empShifts(emp.id, TODAY, addDays(TODAY, 35)).filter((s) => s.date > TODAY || BLOCKS[s.block].end > nowH);
  if (!up.length) return `<section class="card"><span class="eyebrow">Next shift</span><p class="muted" style="margin:6px 0 0">Nothing booked yet.</p></section>`;
  const s = up[0], t = teamById(s.teamId), b = BLOCKS[s.block];
  const pair = up[1] && up[1].date === s.date && up[1].block === s.block + 1 && up[1].teamId === s.teamId && up[1].homeId === s.homeId && t && t.staffing !== "cluster";
  const days = Math.round((parse(s.date) - parse(TODAY)) / 864e5);
  const when = days === 0 ? (b.start <= nowH ? "Happening now" : "Today") : days === 1 ? "Tomorrow" : `In ${days} days`;
  const place = placeOf(s);
  return `<section class="card next ${teamClass(t)}"><span class="eyebrow">Next shift · ${when}</span><div class="countdown" data-at="${startsAt(s).getTime()}"></div>
    <div class="when">${short(s.date)} · ${timeRange(s, pair)}</div>
    <div class="muted" style="font-size:14px">${esc(t ? t.name : "")}${place ? ` · <b style="color:var(--ink)">${esc(place)}</b>` : ""}${pair ? " · 8-hour day" : ""}${extraMin(s) ? " · runs ~30 min longer" : ""}</div>
    ${t ? rotationHtml(t, s) : ""}
    <div class="rowact" style="justify-content:flex-start;margin:10px 0 0">${canDrop(s) ? `<button class="linkbtn" data-act="drop" data-id="${s.id}">Can't make it? Drop this shift</button>` : `<span class="muted note" style="margin:0">Within 48 hours: to change it, talk to your Lead DSP.</span>`}</div></section>`;
}
function cycleCard() {
  const thisW = weekStart(TODAY), nextW = addDays(thisW, 7), last = lastPickDay();
  const msg = isLocked(nextW)
    ? `<b>Next week's schedule is final</b> and was emailed to you. Pick shifts through ${fmt(last, { month: "short", day: "numeric" })}.`
    : `<b>Pick your shifts through ${fmt(last, { month: "short", day: "numeric" })}.</b> HR emails the final schedule for each week before it starts.`;
  return `<section class="card"><span class="eyebrow">How scheduling works</span><p style="margin:6px 0 0;font-size:15px">${msg}</p>
    <p class="muted note">You can drop a shift until 48 hours before it starts; the next person on the waitlist gets it.</p></section>`;
}
function alertsBlock() {
  const P = S.push;
  let body;
  if (P.here) body = `<span class="badge good">On for this device</span> <button class="btn quiet sm" data-act="pushtest">Send a test</button> <button class="linkbtn" data-act="pushoff">Turn off</button>`;
  else if (P.needsInstall) body = `<span class="muted" style="font-size:13.5px">iPhone: tap <b>Share</b> → <b>Add to Home Screen</b>, open Magnolia from your home screen, then turn alerts on.</span>`;
  else if (P.denied) body = `<span class="muted" style="font-size:13.5px">Notifications are blocked for this site. Allow them in your browser or phone settings.</span>`;
  else if (!P.supported) body = `<span class="muted" style="font-size:13.5px">This browser can't get alerts. You'll still get emails.</span>`;
  else body = `<button class="btn" data-act="pushon">Turn on phone alerts</button>`;
  return `<div class="alerts"><b>Phone alerts</b><span class="muted" style="font-size:13px">24 hours and 1 hour before each shift</span><div style="margin-top:6px">${body}</div></div>`;
}
function profileCard(emp) {
  return `<section class="card"><span class="eyebrow">My profile</span>
    ${alertsBlock()}
    <div class="checks" style="margin:10px 0"><label><input type="checkbox" data-act="mylicense" ${emp.hasLicense ? "checked" : ""}> I have a driver's license</label><label><input type="checkbox" data-act="mycna" ${emp.hasCna ? "checked" : ""}> CNA certified</label>
    <label><input type="checkbox" data-act="remind" ${S.me && S.me.reminders !== false ? "checked" : ""}> Email me shift reminders too</label></div>
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
    for (const t of activeTeams()) for (let b = 0; b < 6; b++) { const x = totals(t, ds, b); need += x.need; have += x.have; }
    const pct = need ? have / need : 1;
    cal += `<button class="cell${ds < TODAY ? " past" : ""}" data-act="day" data-date="${ds}" aria-pressed="${ds === S.sel}" aria-label="${long(ds)}, ${Math.round(pct * 100)}% staffed${mine.length ? ", you work " + plural(mine.length, "block") : ""}">
      <span class="num">${d}${ds === TODAY ? `<span class="badge good" style="padding:0 5px">Today</span>` : ""}</span>
      ${mine.map((s) => { const t = teamById(s.teamId), p = placeOf(s); return `<span class="mine ${teamClass(t)}">${hShort(BLOCKS[s.block].start)} ${esc(p ? p.replace(/^Home\s*/i, "H").replace(/^Cluster\s*/i, "C") : t ? t.shortName : "")}</span>`; }).join("")}
      <span class="cov${pct < 0.7 ? " low" : ""}" title="${Math.round(pct * 100)}% staffed"><span style="width:${pct * 100}%"></span></span></button>`;
  }
  return `<div class="grid2"><div><div class="calhead"><button class="iconbtn" data-act="month" data-d="-1" aria-label="Previous month">‹</button><h2>${monthName(mk)}</h2><button class="iconbtn" data-act="month" data-d="1" aria-label="Next month">›</button>
</div>
    <div class="dow">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => `<div>${x}</div>`).join("")}</div><div class="cal">${cal}</div>
    <p class="muted" style="font-size:13px;margin-top:10px">Colored tags are your shifts (H = house, C = outing cluster). The bar under each day shows staffing (orange = short). You can pick shifts through ${fmt(lastPickDay(), { month: "short", day: "numeric" })}.</p></div>
    <aside class="card day" id="day">${dayPanel(emp)}</aside></div>`;
}
/* buttons for one slot: take / drop / waitlist / why not */
function slotActs(emp, u, t, hr) {
  const ppl = inSlot(u), mineHere = emp && ppl.find((s) => s.employeeId === emp.id), busy = busyAt(emp, u.date, u.block), past = u.date < TODAY;
  const data = `data-date="${u.date}" data-block="${u.block}" data-team="${t.id}" data-home="${u.homeId ?? ""}" data-cl="${u.clusterNo ?? ""}"`;
  let a = "";
  if (mineHere) a = canDrop(mineHere) ? `<button class="btn ghost sm" data-act="drop" data-id="${mineHere.id}">Drop</button>` : `<span class="badge good">You</span>${past ? "" : `<span class="muted tiny">Within 48 hrs: talk to your Lead DSP to change</span>`}`;
  else if (canTake(emp, u, t)) {
    const next = u.block < 5 && t.staffing !== "cluster" && units(t, u.date, u.block + 1).find((x) => x.homeId === u.homeId && x.clusterNo === u.clusterNo);
    a = `<button class="btn sm" data-act="take" ${data}>4 hrs</button>` + (next && canTake(emp, next, t) ? ` <button class="btn ghost sm" data-act="take" ${data} data-two="1">8 hrs</button>` : "");
  } else if (myWait(emp, u)) { const q = waitOf(u), w = myWait(emp, u); a = `<span class="badge">Waitlist #${q.indexOf(w) + 1}</span> <button class="linkbtn" data-act="leavewait" data-id="${w.id}">Leave</button>`; }
  else if (canWait(emp, u, t)) a = `<button class="btn quiet sm" data-act="wait" ${data}>Join waitlist${waitOf(u).length ? ` · ${waitOf(u).length} ahead` : ""}</button>`;
  else if (busy && !past) { const bt = teamById(busy.teamId); a = `<span class="muted tiny">You're on ${esc(bt ? bt.shortName : "another shift")}${placeOf(busy) ? " · " + esc(placeOf(busy)) : ""}</span>`; }
  else if (emp && !emp.teams.includes(t.id)) a = `<span class="muted tiny">Not your team</span>`;
  else if (!past && ppl.length >= u.need && waitOf(u).length >= WAITLIST_MAX) a = `<span class="muted tiny">Full · waitlist full</span>`;
  if (hr && ppl.length < u.need && !past) {
    const free = S.employees.filter((e) => e.active !== false && e.teams.includes(t.id) && !busyAt(e, u.date, u.block));
    if (free.length) a += ` <select data-assign="${u.date}|${u.block}|${t.id}|${u.homeId ?? ""}|${u.clusterNo ?? ""}" aria-label="Assign someone"><option value="">Assign…</option>${free.map((e) => `<option value="${esc(e.id)}">${esc(e.name || "Unnamed")}</option>`).join("")}</select>`;
  }
  return a;
}
function pplHtml(emp, u, t, hr) {
  const ppl = inSlot(u), q = waitOf(u);
  if (!ppl.length && !q.length) return "";
  return `<div class="ppl">${ppl.map((s) => { const e = empById(s.employeeId); return avatar(e, t, hr ? `<button data-act="remove" data-id="${s.id}" data-name="${esc(e ? e.name : "")}" aria-label="Remove">×</button>` : "").replace('class="av"', `class="av${emp && s.employeeId === emp.id ? " me" : ""}"`); }).join("")}
    ${q.length ? `<span class="muted tiny" style="align-self:center">Waitlist: ${q.map((w) => esc((empById(w.employeeId) || {}).name ? empById(w.employeeId).name.split(" ")[0] : "?")).join(", ")}</span>` : ""}</div>`;
}
function dayPanel(emp) {
  const ds = S.sel, past = ds < TODAY, locked = isLocked(ds);
  const hr = isAdmin() && S.hrTools;
  const teams = activeTeams().filter((t) => hr || !S.myTeamsOnly || !emp || emp.teams.includes(t.id));
  let h = `<div class="sec-title"><div><h2>${long(ds)}</h2><span class="muted" style="font-size:13px">${past ? "Past day · view only" : locked ? "Final schedule (published). Full shifts still take waitlists." : ds > lastPickDay() ? "Not open for sign-up yet" : "Tap 4 hrs for one block, 8 hrs for two in a row"}</span></div>
    <span class="checks">${emp && !hr ? `<label><input type="checkbox" data-act="myonly" ${S.myTeamsOnly ? "checked" : ""}> My teams only</label>` : ""}${isAdmin() ? `<label><input type="checkbox" data-act="hrtools" ${S.hrTools ? "checked" : ""}> HR tools</label>` : ""}</span></div>`;
  if (!teams.length) return h + `<div class="empty">You're not on a team yet. <button class="linkbtn" data-act="tab" data-tab="quiz">Find your team</button></div>`;
  for (let b = 0; b < 6; b++) {
    const here = teams.filter((t) => t.needs[b] > 0); if (!here.length) continue;
    h += `<div class="blockrow"><div class="bl">${BLOCKS[b].label}<br>${isNight(b) ? `<span class="badge night">Overnight</span>` : ""}</div><div class="slots">`;
    for (const t of here) {
      const us = units(t, ds, b), onTeam = emp && emp.teams.includes(t.id), dim = emp && !onTeam && !hr ? " dim" : "";
      if (t.staffing === "fixed" || (us.length === 1 && !us[0].label)) {
        const u = us[0]; if (!u) continue;
        const ppl = inSlot(u), mineHere = emp && ppl.some((s) => s.employeeId === emp.id);
        h += `<div class="slot ${teamClass(t)}${mineHere ? " mine" : ""}${dim}"><span class="nm">${esc(t.shortName)}</span><span class="fill${ppl.length >= u.need ? " full" : ""}">${ppl.length}/${u.need}</span>${hr && ppl.length && !ppl.some((s) => leadOf(empById(s.employeeId))) ? `<span class="badge warn">No Lead DSP</span>` : ""}${slotActs(emp, u, t, hr)}${pplHtml(emp, u, t, hr)}</div>`;
        continue;
      }
      // per-house or per-cluster team: summary + pick grid
      const key = `${ds}|${b}|${t.id}`, tot = totals(t, ds, b), mine = emp && inTeam(ds, b, t.id).find((s) => s.employeeId === emp.id);
      const openUnits = us.filter((u) => inSlot(u).length < u.need).length, word = t.staffing === "home" ? "house" : "cluster";
      const open = S.open === key;
      h += `<div class="slot big ${teamClass(t)}${mine ? " mine" : ""}${dim}"><span class="nm">${esc(t.shortName)}<small>${us.length ? `${plural(us.length, word)}${t.staffing === "cluster" ? " out" : ""} · ${openUnits} with room` : `No ${word}s out this block`}</small></span><span class="fill${tot.have >= tot.need ? " full" : ""}">${tot.have}/${tot.need}</span>
        ${mine ? `<span class="badge good">You · ${esc(placeOf(mine))}</span>${canDrop(mine) ? ` <button class="btn ghost sm" data-act="drop" data-id="${mine.id}">Drop</button>` : ""}` : ""}
        ${us.length ? `<button class="btn ${open ? "quiet" : "ghost"} sm" data-act="openunits" data-key="${key}" aria-expanded="${open}">${open ? "Close" : mine ? `See ${word}s` : `Pick a ${word}`}</button>` : ""}
        ${open ? unitGrid(emp, t, us, hr) : ""}</div>`;
    }
    h += `</div></div>`;
  }
  return h;
}
function unitGrid(emp, t, us, hr) {
  const fav = emp && t.staffing === "home" ? usualHome(emp, t.id) : null;
  const sel = us.find((u) => skey(u) === S.pick) || (emp && us.find((u) => inSlot(u).some((s) => s.employeeId === emp.id))) || us.find((u) => u.homeId === fav && inSlot(u).length < u.need) || us.find((u) => inSlot(u).length < u.need) || us[0];
  const chips = us.map((u) => { const n = inSlot(u).length, mine = emp && inSlot(u).some((s) => s.employeeId === emp.id), q = waitOf(u).length;
    return `<button class="uchip${n >= u.need ? " full" : n === 0 ? " empty" : ""}${mine ? " mine" : ""}${u === sel ? " on" : ""}" data-act="pickunit" data-k="${esc(skey(u))}" aria-pressed="${u === sel}" title="${esc(u.label)}: ${n} of ${u.need}${q ? `, ${q} waiting` : ""}">
      <b>${esc(t.staffing === "home" ? u.short : "C" + u.short)}</b><span class="dots">${Array.from({ length: u.need }, (_, i) => `<i class="${i < n ? "f" : ""}"></i>`).join("")}</span>${u.homeId === fav ? `<em>usual</em>` : ""}</button>`; }).join("");
  const n = inSlot(sel).length;
  return `<div class="ugrid">${chips}</div>
    <div class="udetail"><div class="uhead"><b>${esc(sel.label)}</b><span class="fill${n >= sel.need ? " full" : ""}">${n}/${sel.need} DSPs</span>${t.staffing === "cluster" && sel.group && sel.group.ones ? `<span class="badge">+30 min</span>` : ""}${slotActs(emp, sel, t, hr)}</div>
    ${t.staffing === "cluster" ? groupHtml(sel.group) : (() => { const rs = S.residents.filter((r) => r.active !== false && r.homeId === sel.homeId); return rs.length ? `<p class="muted note">Residents: ${rs.map((r) => esc(r.firstName)).join(", ")}</p>` : ""; })()}
    ${pplHtml(emp, sel, t, hr)}</div>`;
}

/* ---------- TEAMS & HOMES ---------- */
function viewTeams() {
  const emp = myEmp();
  let h = `<div class="sec-title"><h2>Activity teams</h2><span class="muted" style="font-size:14px">Each team has a Lead DSP, DSP IIs and DSP Is, assigned by HR</span></div><div class="grid3">`;
  for (const t of activeTeams()) {
    const on = emp && emp.teams.includes(t.id), members = S.employees.filter((e) => e.active !== false && e.teams.includes(t.id)).length;
    const how = t.staffing === "home" ? `${Math.max(...t.needs)} DSPs per house per block` : t.staffing === "cluster" ? `${Math.max(...t.needs)} DSPs per cluster + 1 per resident who needs their own` : "";
    h += `<article class="card team ${teamClass(t)}"><h3>${esc(t.name)}</h3><p class="muted" style="margin:0;font-size:13.5px">${esc(t.description)}</p>
      <div class="acts">${t.activities.map((a) => `<span>${esc(a)}</span>`).join("")}</div>
      ${roster(t)}
      <div><span class="eyebrow">Works</span><div class="blocksmini" style="margin-top:4px">${BLOCKS.map((b, i) => `<span class="${t.needs[i] ? "on" : ""}" title="${b.label}: ${t.needs[i]} needed">${hShort(b.start)}</span>`).join("")}</div>${how ? `<div class="muted" style="font-size:12.5px;margin-top:4px">${how}</div>` : ""}</div>
      <div class="foot"><span class="muted" style="font-size:12.5px">${members} DSPs${t.needsLicense ? " · license required" : ""}</span>
      ${emp ? (on ? `<button class="btn ghost sm" data-act="leave" data-team="${t.id}">Leave team</button>` : `<button class="btn sm" data-act="join" data-team="${t.id}">Join team</button>`) : ""}</div></article>`;
  }
  h += `</div>`;
  const lvl = emp ? emp.level : "";
  h += `<section class="card" style="margin-top:18px"><div class="sec-title"><h2>Team roles</h2><span class="muted" style="font-size:14px">HR assigns each person's role</span></div>
    <div class="ladder">${[["Lead DSP", "Runs the team's shifts, mentors DSP Is, leads shadow shifts and holds a weekly check-in."], ["DSP II", "Experienced DSP (6+ months). Helps run activities and works with volunteers."], ["DSP I", "First 6 months. Learns the team's routine with shadow shifts and a Lead DSP as mentor."]].map(([n, d]) => `<div class="rung${n === lvl ? " me" : ""}"><span class="eyebrow">${n === lvl ? "Your role" : "Role"}</span><div class="v" style="font-size:20px">${n}</div><div class="muted" style="font-size:14px">${d}</div></div>`).join("")}</div></section>`;
  h += outingClusters(monthKey(TODAY), false);
  h += `<section style="margin-top:18px"><div class="sec-title"><h2>Homes by area</h2><span class="muted" style="font-size:13px">${S.homes.length} homes · ${S.homes.reduce((a, x) => a + (+x.residents || 0), 0)} residents</span></div><div class="clusters">`;
  for (const c of "ABCD") {
    const hs = S.homes.filter((x) => x.cluster === c).sort((a, b) => a.sort - b.sort);
    h += `<div class="card cluster"><h3>Area ${c}</h3><ul>${hs.map((x) => `<li><span>${esc(x.name)}</span><span class="muted">${esc(x.location)} · ${x.residents}</span></li>`).join("") || "<li class='muted'>No homes</li>"}</ul></div>`;
  }
  h += `</div></section>`;
  const teams = activeTeams().filter((t) => t.staffing === "fixed" && t.needs[3]);
  if (teams.length) {
    h += `<section class="card" style="margin-top:18px"><div class="sec-title"><h2>How an on-campus 12–4 PM shift rotates</h2><span class="muted" style="font-size:13px">Each team visits every area once, one hour at a time</span></div><div class="tw"><table class="grid"><thead><tr><th>Hour</th>${"ABCD".split("").map((c) => `<th>Area ${c}</th>`).join("")}</tr></thead><tbody>`;
    for (let hr = 0; hr < 4; hr++) {
      h += `<tr><th>${hShort(12 + hr)}–${hShort(13 + hr)}</th>`;
      for (const c of "ABCD") {
        const t = teams.find((tt) => { const r = rotation(tt, 3); return r && r[hr].cluster === c; });
        h += t ? `<td class="${teamClass(t)}"><b>${esc(rotation(t, 3)[hr].activity)}</b><small>${esc(t.shortName)}</small></td>` : `<td style="background:var(--sunk);border-left-color:var(--line)"><small>House staff</small></td>`;
      }
      h += `</tr>`;
    }
    h += `</tbody></table></div><p class="muted" style="font-size:12px;margin:8px 0 0">Illustrative. Every home also keeps its own House & Daily Living DSPs.</p></section>`;
  }
  return h;
}
function outingClusters(month, hrView) {
  const t = activeTeams().find((x) => x.staffing === "cluster"), cm = monthClusters(month), nos = Object.keys(cm).map(Number).sort((a, b) => a - b);
  if (!t && !hrView) return "";
  const today = monthKey(TODAY) === month ? TODAY : month + "-01";
  let h = `<section style="margin-top:18px"><div class="sec-title"><h2>Outing clusters · ${monthName(month)}</h2><span class="muted" style="font-size:13px">${nos.length ? `${plural(nos.length, "cluster")} of 8 or fewer · new clusters every month` : ""}</span></div>`;
  if (!nos.length) return h + `<div class="card empty" style="padding:18px">${S.residents.length ? "Clusters for this month will appear once someone opens it." : "No residents entered yet. HR adds them under HR → Residents."}</div></section>`;
  h += `<div class="clusters">`;
  for (const c of nos) {
    const g = cm[c], blk = t ? clusterBlock(t, today, c) : -1;
    h += `<div class="card cluster ${t ? teamClass(t) : ""}"><h3>Cluster ${c}</h3><div class="muted" style="font-size:12.5px;margin:-2px 0 6px">${plural(g.members.length, "resident")} · ${t ? (t.needs[blk] || 2) + g.ones : 2 + g.ones} DSPs${blk >= 0 ? ` · ${monthKey(TODAY) === month ? "today" : "on the 1st"} ${BLOCKS[blk].label}` : ""}</div>${groupHtml(g, true)}</div>`;
  }
  return h + `</div></section>`;
}
function roster(t) {
  const ppl = S.employees.filter((e) => e.active !== false && e.teams.includes(t.id));
  const row = (lvl) => { const xs = ppl.filter((e) => e.level === lvl); return `<div class="rosterrow"><span class="eyebrow">${lvl}</span><span>${xs.length ? xs.map((e) => esc(e.name || "Unnamed")).join(", ") : '<span class="muted">Open</span>'}</span></div>`; };
  return `<div class="roster">${row("Lead DSP")}${row("DSP II")}${row("DSP I")}</div>`;
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
  const subs = [["coverage", "Coverage"], ["people", "Employees"], ["residents", "Residents & clusters"], ["teams", "Teams & staffing"], ["homes", "Homes"], ["settings", "Settings"]];
  const body = { coverage: hrCoverage, people: hrPeople, residents: hrResidents, teams: hrTeams, homes: hrHomes, settings: hrSettings }[S.hrSub]();
  return `<div class="subtabs">${subs.map(([id, l]) => `<button data-act="hrsub" data-sub="${id}" aria-pressed="${S.hrSub === id}">${l}</button>`).join("")}</div>${body}`;
}
function hrWeekNav() {
  const ws = weekStart(S.hrWeekRef);
  return `<div class="weeknav"><button data-act="hrweek" data-d="-7" aria-label="Previous week">‹</button><b style="min-width:9em;text-align:center">${fmt(ws, { month: "short", day: "numeric" })} – ${fmt(addDays(ws, 6), { month: "short", day: "numeric" })}</b><button data-act="hrweek" data-d="7" aria-label="Next week">›</button><button class="linkbtn" data-act="hrweek" data-d="0">This week</button></div>`;
}
function hrCoverage() {
  const ws = weekStart(S.hrWeekRef), days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ws, i)), teams = activeTeams();
  let need = 0, have = 0;
  const cell = {};
  for (const d of days) for (const t of teams) for (let b = 0; b < 6; b++) { const x = totals(t, d, b); cell[`${d}|${b}|${t.id}`] = x; need += x.need; have += x.have; }
  const emps = S.employees.filter((e) => e.active !== false), hrs = emps.map((e) => ({ e, h: weekHours(e.id, ws) }));
  const under = hrs.filter((x) => x.h < x.e.weeklyTarget).length, over = hrs.filter((x) => x.h > x.e.weeklyTarget).length;
  let noLead = 0;
  for (const d of days) for (const t of teams) for (let b = 0; b < 6; b++) { const p = inTeam(d, b, t.id); if (p.length && !p.some((s) => leadOf(empById(s.employeeId)))) noLead++; }
  const waiting = S.waitlist.filter((w) => w.date >= ws && w.date <= addDays(ws, 6)).length;
  const pub = isLocked(ws);
  let h = `<div class="sec-title"><h2>Coverage</h2>${hrWeekNav()}</div>
    <div class="card publish${pub ? " done" : ""}"><div><b>${pub ? "Published" : "Not published yet"}</b><span class="muted"> · week of ${fmt(ws, { month: "short", day: "numeric" })}</span><div class="muted" style="font-size:14px">${pub ? "No new picks this week. DSPs can still drop until 48 hours before a shift; the waitlist fills the gap." : "When coverage looks right, publish to lock the week and email every DSP their final schedule."}</div></div>
    ${pub ? `<button class="btn quiet" data-act="unpublish" data-w="${ws}">Reopen week</button>` : `<button class="btn lg" data-act="publish" data-w="${ws}">Publish &amp; email schedule</button>`}</div><div class="cards">
    <div class="card kpi"><div class="v">${need ? Math.round((have / need) * 100) : 0}%</div><div class="k">of needed shifts filled (${have}/${need})</div></div>
    <div class="card kpi${need - have ? " warn" : ""}"><div class="v">${need - have}</div><div class="k">open DSP slots this week${waiting ? ` · ${waiting} on waitlists` : ""}</div></div>
    <div class="card kpi${under ? " warn" : ""}"><div class="v">${under}</div><div class="k">DSPs under their weekly target</div></div>
    <div class="card kpi${noLead ? " warn" : ""}"><div class="v">${noLead}</div><div class="k">team shifts without a Lead DSP${over ? ` · ${over} DSPs over target` : ""}</div></div></div>`;
  h += `<div class="card tw"><table class="covgrid"><thead><tr><th>Block</th>${days.map((d) => `<th>${fmt(d, { weekday: "short", month: "numeric", day: "numeric" })}</th>`).join("")}</tr></thead><tbody>`;
  for (let b = 0; b < 6; b++) {
    const tb = teams.filter((t) => t.needs[b]); if (!tb.length) continue;
    h += `<tr><th>${BLOCKS[b].label}</th>${days.map((d) => `<td>${tb.map((t) => { const x = cell[`${d}|${b}|${t.id}`]; return `<div class="tm ${teamClass(t)}${x.have < x.need ? " short" : ""}" title="${esc(t.shortName)}"><i></i>${x.have}/${x.need}</div>`; }).join("")}</td>`).join("")}</tr>`;
  }
  h += `</tbody></table><div class="progress-key" style="margin-top:8px">${teams.map((t) => `<span class="${teamClass(t)}"><i></i>${esc(t.shortName)}${t.staffing === "home" ? " (all houses)" : t.staffing === "cluster" ? " (all clusters)" : ""}</span>`).join("")}<span style="color:var(--warn)">orange = short-staffed</span></div></div>
    <div class="rowact"><button class="btn ghost" data-act="csv">Download this week (CSV)</button><button class="btn quiet" data-act="print">Print</button></div>`;
  return h;
}
function hrPeople() {
  const ws = weekStart(S.hrWeekRef), q = S.peopleQ.toLowerCase();
  const list = S.employees.filter((e) => !q || (e.name + " " + e.email + " " + e.level).toLowerCase().includes(q)).sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active === false ? 1 : -1));
  let h = `<div class="sec-title"><h2>Employees</h2>${hrWeekNav()}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><input id="peopleq" placeholder="Search name, email or level" value="${esc(S.peopleQ)}" style="flex:1;min-width:200px"><button class="btn" data-act="addemp">Add employee</button></div>`;
  if (S.editEmp) h += empForm(S.editEmp);
  h += `<div class="tw"><table class="data"><thead><tr><th>Name</th><th>Level</th><th>Teams</th><th>Hours this week</th><th>Login</th><th></th></tr></thead><tbody>`;
  for (const e of list) {
    const hrs = weekHours(e.id, ws), tgt = e.weeklyTarget || 0, admin = S.admins && e.userId && S.admins.includes(e.userId);
    h += `<tr${e.active === false ? ' style="opacity:.5"' : ""}><td><b>${esc(e.name || "Unnamed")}</b>${e.demo ? ' <span class="badge">demo</span>' : ""}${admin ? ' <span class="badge good">HR</span>' : ""}<br><span class="muted" style="font-size:12px">${esc(e.email)}${e.hasLicense ? " · license" : ""}${e.hasCna ? " · CNA" : ""}</span></td>
      <td>${esc(e.level)}</td><td>${e.teams.map((id) => { const t = teamById(id); return t ? `<span class="chip ${teamClass(t)}" style="margin:1px"><span class="dot tbg"></span>${esc(t.shortName)}</span>` : ""; }).join("") || '<span class="muted">none</span>'}</td>
      <td style="white-space:nowrap"><span class="minibar${hrs < tgt ? " low" : ""}"><span style="width:${Math.min(100, tgt ? (hrs / tgt) * 100 : 100)}%"></span></span><span class="mono">${hrsTxt(hrs)}/${tgt}</span></td>
      <td>${e.userId ? "Yes" : '<span class="muted">No</span>'}</td>
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
function hrResidents() {
  const homes = sortedHomes(), list = [...S.residents].sort((a, b) => ((homeById(a.homeId) || {}).sort || 99) - ((homeById(b.homeId) || {}).sort || 99) || a.firstName.localeCompare(b.firstName));
  const ones = S.residents.filter((r) => r.active !== false && r.ownDsp).length, act = S.residents.filter((r) => r.active !== false).length;
  const homeOpts = (sel) => `<option value="">No house</option>` + homes.map((x) => `<option value="${x.id}"${x.id === sel ? " selected" : ""}>${esc(x.name)}</option>`).join("");
  let h = `<div class="sec-title"><h2>Residents & outing clusters</h2><div class="weeknav"><button data-act="resmonth" data-d="-1" aria-label="Previous month">‹</button><b style="min-width:8em;text-align:center">${monthName(S.resMonth)}</b><button data-act="resmonth" data-d="1" aria-label="Next month">›</button></div></div>
    <p class="muted" style="margin:-4px 0 14px;font-size:13.5px">Store first names only, never diagnoses. Every month the app deals residents into new outing clusters of 8 or fewer, spreading out people who need their own DSP. Each outing gets 2 DSPs plus 1 for every resident who needs their own.</p>
    <div class="cards"><div class="card kpi"><div class="v">${act}</div><div class="k">active residents</div></div><div class="card kpi"><div class="v">${ones}</div><div class="k">need their own DSP on outings</div></div><div class="card kpi"><div class="v">${Object.keys(monthClusters(S.resMonth)).length}</div><div class="k">clusters in ${monthName(S.resMonth).split(" ")[0]}</div></div></div>`;
  h += `<div class="rowact" style="justify-content:flex-start;margin:0 0 6px"><button class="btn" data-act="clustersync" data-m="${S.resMonth}">Add new residents to ${monthName(S.resMonth).split(" ")[0]}'s clusters</button><button class="btn quiet" data-act="reshuffle" data-m="${S.resMonth}">Reshuffle ${monthName(S.resMonth).split(" ")[0]}</button></div>`;
  h += outingClusters(S.resMonth, true);
  h += `<section style="margin-top:18px"><div class="sec-title"><h2>Residents</h2></div>
    <form class="card form" data-form="resident" style="margin-bottom:12px"><label>First name<input name="first" required maxlength="40" placeholder="First name only"></label><label>House<select name="home">${homeOpts(null)}</select></label>
    <div class="checks" style="align-self:end"><label><input type="checkbox" name="own"> Needs their own DSP on outings</label></div><div class="rowact" style="margin:0;align-self:end"><button class="btn">Add resident</button></div></form>
    <div class="tw"><table class="data"><thead><tr><th>First name</th><th>House</th><th>Own DSP</th><th>Active</th><th>Cluster (${monthName(S.resMonth).split(" ")[0]})</th><th></th></tr></thead><tbody>`;
  for (const r of list) {
    const c = S.clusters.find((x) => x.month === S.resMonth && x.residentId === r.id);
    h += `<tr${r.active === false ? ' style="opacity:.5"' : ""}><td><input data-res="${r.id}" data-f="firstName" value="${esc(r.firstName)}" maxlength="40"></td><td><select data-res="${r.id}" data-f="homeId">${homeOpts(r.homeId)}</select></td>
      <td><input type="checkbox" data-res="${r.id}" data-f="ownDsp" ${r.ownDsp ? "checked" : ""} aria-label="Needs own DSP"></td><td><input type="checkbox" data-res="${r.id}" data-f="active" ${r.active !== false ? "checked" : ""} aria-label="Active"></td>
      <td>${c ? `Cluster ${c.clusterNo}` : '<span class="muted">not yet</span>'}${r.demo ? ' <span class="badge">demo</span>' : ""}</td><td style="text-align:right"><button class="linkbtn" data-act="delres" data-id="${r.id}" data-name="${esc(r.firstName)}">Remove</button></td></tr>`;
  }
  return h + `</tbody></table></div><p class="muted" style="font-size:12.5px">Changes save when you leave a field.</p></section>`;
}
function hrTeams() {
  let h = `<div class="sec-title"><h2>Teams & staffing</h2><button class="btn" data-act="addteam">Add team</button></div><p class="muted" style="margin:-4px 0 14px;font-size:13.5px">"Needed" = DSPs per 4-hour block, counted per house or per outing cluster when the team works that way. Set 0 for blocks a team doesn't work.</p><div class="stack">`;
  const list = S.editTeam === "new" ? [...activeTeams(), { id: null, name: "", shortName: "", description: "", activities: [], needs: [0, 0, 5, 5, 5, 0], staffing: "fixed", color: S.teams.length % 8, needsLicense: false }] : activeTeams();
  for (const t of list) {
    const per = t.staffing === "home" ? ` (per house × ${S.homes.length})` : t.staffing === "cluster" ? " (per cluster, + 1:1s)" : "";
    h += `<form class="card form ${teamClass(t)}" data-form="team" style="border-top:5px solid var(--tc)"><input type="hidden" name="id" value="${t.id || ""}">
      <label>Team name<input name="name" value="${esc(t.name)}" required maxlength="60"></label><label>Short name<input name="short" value="${esc(t.shortName)}" maxlength="24"></label>
      <label>Color<select name="color">${[0, 1, 2, 3, 4, 5, 6, 7].map((c) => `<option value="${c}"${c === t.color ? " selected" : ""}>Color ${c + 1}</option>`).join("")}</select></label>
      <label>How it's staffed<select name="staffing">${Object.entries(STAFFING).map(([k, l]) => `<option value="${k}"${k === (t.staffing || "fixed") ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="wide">Description<input name="desc" value="${esc(t.description)}" maxlength="400"></label>
      <label class="wide">Activities (comma separated)<input name="acts" value="${esc(t.activities.join(", "))}"></label>
      <div class="wide"><span class="eyebrow">Needed per block${per}</span><div class="needs">${BLOCKS.map((b, i) => `<label>${b.label}<input name="need${i}" type="number" min="0" max="50" value="${t.needs[i] || 0}"></label>`).join("")}</div></div>
      <div class="wide checks"><label><input type="checkbox" name="license" ${t.needsLicense ? "checked" : ""}> Driver's license required</label>${t.id ? `<label><input type="checkbox" name="active" checked> Active</label>` : ""}</div>
      <div class="wide rowact" style="margin:0">${t.id ? "" : `<button type="button" class="btn quiet" data-act="cancelteam">Cancel</button>`}<button class="btn">Save team</button></div></form>`;
  }
  return h + `</div>`;
}
function hrHomes() {
  let h = `<div class="sec-title"><h2>Homes</h2><button class="btn" data-act="addhome">Add home</button></div><div class="tw"><table class="data"><thead><tr><th>Name</th><th>Area</th><th>Location</th><th>Residents</th><th></th></tr></thead><tbody>`;
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
  const demo = S.employees.filter((e) => e.demo).length, key = S.settings.vapidPublic;
  return `<div class="stack"><section class="card"><span class="eyebrow">Announcement banner</span><textarea id="ann" rows="2" maxlength="280" style="width:100%;margin:8px 0" placeholder="e.g. Staff appreciation lunch Friday at 3 PM. Leave empty to hide.">${esc(S.settings.announcement)}</textarea><button class="btn" data-act="ann">Save announcement</button></section>
    <section class="card"><span class="eyebrow">Phone alerts setup</span>
      <p style="margin:6px 0 10px;font-size:15px">${key ? `<span class="badge good">Alert keys created</span> DSPs can turn on alerts from My week → My profile.` : "One-time setup so the app can send shift alerts to DSPs' phones."}</p>
      ${S.newPriv ? `<div class="secretbox"><b>Copy this private key now. It's shown only once.</b><textarea readonly rows="2" id="privkey">${esc(S.newPriv)}</textarea>
        <div class="rowact" style="justify-content:flex-start;margin:6px 0"><button class="btn sm" data-act="copypriv">Copy</button></div>
        <ol class="steps"><li>Vercel → your project → <b>Settings → Environment Variables</b> → add <b>VAPID_PRIVATE_KEY</b> and paste it.</li><li><b>Deployments → ⋯ → Redeploy</b>.</li><li>In Supabase → SQL editor, run <b>supabase/alerts-cron.sql</b> once (the 10-minute timer).</li></ol>
        <button class="linkbtn" data-act="privdone">I've saved it</button></div>`
        : `<button class="btn ${key ? "quiet" : ""}" data-act="vapid">${key ? "Replace alert keys" : "Create alert keys"}</button>${key ? `<p class="muted note">Replacing keys means everyone has to turn alerts on again.</p>` : ""}`}</section>
    <section class="card"><span class="eyebrow">Publishing</span><p style="margin:6px 0 0;font-size:15px">Publish each week from <button class="linkbtn" data-act="hrsub" data-sub="coverage">Coverage</button>. DSPs can pick shifts up to ${CFG.signupWeeksAhead} weeks ahead and drop until 48 hours before a shift. Publishing locks new picks and emails every DSP their final schedule.</p></section>
    <section class="card"><span class="eyebrow">Demo data</span><p style="margin:6px 0 12px;font-size:14px">${demo} demo DSPs (Sally Thompson and team), ${S.residents.filter((r) => r.demo).length} demo residents and their shifts are loaded for presentations.</p>
      ${demo || S.residents.some((r) => r.demo) ? `<button class="btn danger" data-act="wipedemo">Remove demo data</button>` : ""}${B.mode === "preview" ? ` <button class="btn quiet" data-act="resetdemo">Reset preview</button>` : ""}</section></div>`;
}

/* ---------- actions ---------- */
function goDay(ds) { const d = parse(ds); S.y = d.getFullYear(); S.m = d.getMonth(); S.sel = ds; S.tab = "schedule"; syncHash(); refresh(); }
function syncHash() { const h = "#" + S.tab; if (location.hash !== h) history.replaceState(null, "", location.pathname + location.search + h); }
const unitFrom = (d) => {
  let home = d.home, cl = d.cl;
  if (d.sel && $(d.sel)) [home, cl] = $(d.sel).value.split("|");
  return { homeId: home === "" || home == null ? null : +home, clusterNo: cl === "" || cl == null ? null : +cl };
};
async function takeShift(slot, two, employeeId) {
  const t = teamById(slot.teamId), place = placeOf(slot);
  await act(async () => { await B.take(slot, employeeId); if (two) await B.take({ ...slot, block: slot.block + 1 }, employeeId); },
    `Booked ${short(slot.date)}, ${hShort(BLOCKS[slot.block].start)}–${hShort(BLOCKS[slot.block + (two ? 1 : 0)].end)} · ${t ? t.shortName : ""}${place ? " · " + place : ""}`);
  setTimeout(() => { const w = document.querySelector(".week"); if (w && !employeeId) { w.classList.remove("pulse"); void w.offsetWidth; w.classList.add("pulse"); } }, 60);
}
const slotFrom = (d) => ({ date: d.date, block: +d.block, teamId: +d.team, ...unitFrom(d) });
async function makeVapid() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { pub: bytesB64u(raw), priv: jwk.d };
}
const actions = {
  signin: openSignIn,
  signout: () => act(() => B.signOut(), "Signed out."),
  claim: () => act(async () => { const ok = await B.claimAdmin(); S.noAdmin = false; if (!ok) throw Object.assign(new Error(), { friendly: "Someone already claimed admin." }); }, "You're the HR admin now."),
  tab: (d) => { S.tab = d.tab; syncHash(); render(); window.scrollTo(0, 0); },
  week: (d) => { S.weekRef = +d.d ? addDays(S.weekRef, +d.d) : TODAY; refresh(); },
  hrweek: (d) => { S.hrWeekRef = +d.d ? addDays(S.hrWeekRef, +d.d) : TODAY; refresh(); },
  resmonth: (d) => { S.resMonth = addMonth(S.resMonth, +d.d); refresh(); },
  month: (d) => { let m = S.m + +d.d, y = S.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } S.y = y; S.m = m; const f = `${y}-${pad(m + 1)}-01`; S.sel = monthKey(TODAY) === monthKey(f) ? TODAY : f; refresh(); },
  day: (d) => { S.sel = d.date; S.open = ""; render(); const dp = $("day"); if (dp) { dp.classList.remove("enter"); void dp.offsetWidth; dp.classList.add("enter"); } if (matchMedia("(max-width: 880px)").matches) $("day").scrollIntoView({ behavior: "smooth", block: "start" }); },
  openday: (d) => goDay(d.date),
  openunits: (d) => { S.open = S.open === d.key ? "" : d.key; S.pick = ""; render(); },
  pickunit: (d) => { S.pick = d.k; render(); },
  take: (d) => takeShift(slotFrom(d), d.two === "1"),
  wait: (d) => act(() => B.joinWait(slotFrom(d)), "You're on the waitlist. If a spot opens, you'll get it automatically."),
  leavewait: (d) => act(() => B.leaveWait(+d.id), "Left the waitlist."),
  drop: (d) => {
    const s = S.signups.find((x) => x.id === +d.id); if (!s) return;
    const q = waitOf(s).length;
    if (!confirm(`Drop your ${short(s.date)} ${BLOCKS[s.block].label} shift${placeOf(s) ? " at " + placeOf(s) : ""}?${q ? " The next person on the waitlist will get it." : ""}`)) return;
    act(() => B.drop(+d.id), q ? "Shift dropped. The next person on the waitlist has it now." : "Shift dropped.");
  },
  remove: (d) => { if (confirm(`Remove ${d.name} from this shift?`)) act(() => B.drop(+d.id, true), `Removed ${d.name}.`); },
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
  tipsdone: () => { try { localStorage.setItem("magnolia-tips-done", "1"); } catch (_) {} render(); },
  pushon: () => enablePush(),
  pushoff: () => disablePush(),
  pushtest: async () => {
    if (B.mode === "preview") { const reg = await navigator.serviceWorker.getRegistration("/"); if (reg) reg.showNotification("Test alert from Magnolia", { body: "Phone alerts are working.", icon: "/icon.svg" }); return toast("Sent a test alert to this device."); }
    act(() => B.testPush(), (r) => (r.pushed ? "Test alert sent. Check your phone." : r.error || "No phone got it. Turn alerts off and on again."));
  },
  vapid: async () => {
    if (S.settings.vapidPublic && !confirm("Replace the alert keys? Everyone will need to turn phone alerts on again.")) return;
    try { const k = await makeVapid(); await B.saveVapidPublic(k.pub); S.newPriv = k.priv; await refresh(); }
    catch (e) { toast((e && e.friendly) || "Couldn't create keys in this browser."); }
  },
  copypriv: async () => { try { await navigator.clipboard.writeText(S.newPriv); toast("Copied."); } catch (_) { const t = $("privkey"); t.select(); toast("Press Ctrl+C (or Cmd+C) to copy."); } },
  privdone: () => { if (confirm("Did you paste the key into Vercel? It won't be shown again.")) { S.newPriv = ""; render(); } },
  ics: () => {
    const emp = myEmp(); const ss = empShifts(emp.id, TODAY, addDays(TODAY, 35));
    if (!ss.length) return toast("No upcoming shifts to add yet.");
    const ev = ss.map((s) => { const t = teamById(s.teamId), b = BLOCKS[s.block], g = groupOf(s.date, s.clusterNo), r = t && t.staffing === "fixed" && rotation(t, s.block);
      return { uid: `${s.id}`, date: s.date, start: b.start, end: b.end + extraMin(s) / 60, title: `${t ? t.shortName : "Shift"}${placeOf(s) ? " · " + placeOf(s) : ""} · Magnolia`,
        description: g ? `Cluster ${s.clusterNo}: ${g.members.map((m) => m.firstName + (m.ownDsp ? " (1:1)" : "")).join(", ")}` : r ? r.map((x) => `${hShort(x.hour)}: Area ${x.cluster} · ${x.activity}`).join("\n") : placeOf(s) || "Residential coverage" }; });
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
  delhome: (d) => { if (confirm(`Remove ${d.name}? Its House & Daily Living shifts are removed too.`)) act(() => B.deleteHome(+d.id), "Home removed."); },
  delres: (d) => { if (confirm(`Remove ${d.name}?`)) act(() => B.deleteResident(+d.id), "Resident removed."); },
  clustersync: (d) => act(() => B.ensureClusters(d.m, false), "Clusters updated."),
  reshuffle: (d) => { if (confirm(`Deal ${monthName(d.m)}'s clusters again from scratch? Outing shifts already booked keep their cluster number, but the residents in each cluster will change.`)) act(() => B.ensureClusters(d.m, true), "Clusters reshuffled."); },
  ann: () => { const v = $("ann").value.trim().slice(0, 280); act(() => B.saveAnnouncement(v), v ? "Announcement posted." : "Announcement removed."); },
  publish: (d) => { if (confirm(`Publish the week of ${fmt(d.w, { month: "long", day: "numeric" })}? It locks new picks for that week and emails everyone their final schedule.`)) act(() => B.publishWeek(d.w), (r) => r && r.preview ? "Week published. (Preview mode: no emails sent.)" : `Week published. Emailed ${r.sent} of ${r.people} DSPs${r.failed && r.failed.length ? `; ${r.failed.length} failed` : ""}.`); },
  unpublish: (d) => { if (confirm("Reopen this week? DSPs will be able to pick shifts again.")) act(() => B.setWeekLock(d.w, false), "Week reopened."); },
  wipedemo: () => { if (confirm("Remove all demo DSPs, demo residents and their shifts? Real people and their shifts stay.")) act(() => B.wipeDemo(), (n) => `Removed ${n} demo DSPs and the demo residents.`); },
  resetdemo: () => { if (confirm("Reset all preview data on this device?")) { B.resetDemo(); } },
  print: () => window.print(),
  csv: () => {
    const ws = weekStart(S.hrWeekRef), we = addDays(ws, 6), q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [["Date", "Block", "Team", "House / cluster", "Employee", "Role", "Hours"].map(q).join(",")];
    S.signups.filter((s) => s.date >= ws && s.date <= we).sort((a, b) => (a.date + a.block < b.date + b.block ? -1 : 1)).forEach((s) => {
      const e = empById(s.employeeId), t = teamById(s.teamId);
      rows.push([s.date, BLOCKS[s.block].label, t ? t.name : "", placeOf(s), e ? e.name : "", e ? e.level : "", shiftHours(s)].map(q).join(","));
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
    const [d, b, t, hm, cl] = el.dataset.assign.split("|"), e = empById(el.value);
    takeShift({ date: d, block: +b, teamId: +t, homeId: hm === "" ? null : +hm, clusterNo: cl === "" ? null : +cl }, false, el.value).then(() => toast(`Assigned ${e ? e.name : ""}.`));
  } else if (el.dataset.act === "mylicense") act(() => B.updateMe({ hasLicense: el.checked }), "Saved.");
  else if (el.dataset.act === "mycna") act(() => B.updateMe({ hasCna: el.checked }), "Saved.");
  else if (el.dataset.act === "remind") act(() => B.setReminders(el.checked), el.checked ? "Email reminders on." : "Email reminders off.");
  else if (el.dataset.act === "myonly") { S.myTeamsOnly = el.checked; render(); }
  else if (el.dataset.act === "hrtools") { S.hrTools = el.checked; render(); }
  else if (el.dataset.home) {
    const h = S.homes.find((x) => x.id === +el.dataset.home); if (!h) return;
    const v = el.dataset.f === "residents" ? +el.value : el.value; if (h[el.dataset.f] === v) return;
    act(() => B.saveHome({ ...h, [el.dataset.f]: v }), "Saved.");
  } else if (el.dataset.res) {
    const r = S.residents.find((x) => x.id === +el.dataset.res); if (!r) return;
    const f = el.dataset.f, v = el.type === "checkbox" ? el.checked : f === "homeId" ? (el.value ? +el.value : null) : el.value.trim();
    if (f === "firstName" && !v) return;
    act(() => B.saveResident({ ...r, [f]: v }), "Saved.");
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
  if (kind === "resident") {
    const r = { firstName: String(fd.get("first")).trim().slice(0, 40), homeId: fd.get("home") ? +fd.get("home") : null, ownDsp: !!fd.get("own") };
    if (r.firstName) act(async () => { await B.saveResident(r); await B.ensureClusters(S.resMonth, false); }, `${r.firstName} added and placed in a cluster.`);
  }
  if (kind === "team") {
    const t = { id: +fd.get("id") || null, name: String(fd.get("name")).trim(), shortName: String(fd.get("short") || fd.get("name")).trim().slice(0, 24), description: String(fd.get("desc")).trim(),
      activities: String(fd.get("acts")).split(",").map((x) => x.trim()).filter(Boolean), needs: BLOCKS.map((_, i) => Math.max(0, +fd.get("need" + i) || 0)),
      staffing: fd.get("staffing") || "fixed", color: +fd.get("color") || 0, needsLicense: !!fd.get("license"), active: fd.get("id") ? !!fd.get("active") : true };
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
  if ("serviceWorker" in navigator) swReg().catch(() => {});
  await checkPush();
  await refresh();
  if (location.hash && !TABS.some((t) => "#" + t.id === location.hash)) syncHash();
})();
})();
