/* Magnolia DSP Schedule — UI. Data comes from data.js (backend object B); settings from config.js.
 * Staffing rules (slotNeed, clusterBlock, clusterMap…) live in data.js so both backends and this file agree. */
(() => {
const CFG = window.MAGNOLIA, BLOCKS = CFG.blocks;
const TABS = [
  { id: "home", label: "My week" },
  { id: "schedule", label: "Schedule" },
  { id: "teams", label: "Team" },
  { id: "hr", label: "HR", admin: true },
  { id: "quiz", label: "Find my team", hidden: true },
  { id: "profile", label: "My profile", hidden: true },
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
  tab: "home", y: NOW.getFullYear(), m: NOW.getMonth(), sel: TODAY, weekRef: TODAY, hrWeekRef: TODAY, hrSub: "coverage", tempDay: "", tempFrom: TODAY, resMonth: monthKey(TODAY),
  myTeamsOnly: true, hrTools: false, quiz: { i: 0, answers: [] }, editEmp: null, editTeam: null, peopleQ: "", open: "", pick: "",
  me: null, mode: "connecting", loaded: false, notice: "", noAdmin: undefined, admins: null, push: { supported: false, here: false, ios: false }, newPriv: "",
  teams: [], homes: [], employees: [], signups: [], residents: [], clusters: [], waitlist: [], temps: [], timeOff: [], offers: [], callouts: [], tempHist: null, settings: { announcement: "", lockedWeeks: [], vapidPublic: "" },
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
/* monthly sign-up windows by rank (signupWindow / pickOpen live in data.js) */
const levelOf = (emp) => (emp && emp.level) || "DSP I";
const monthWord = (ds) => parse(ds.slice(0, 7) + "-01").toLocaleDateString("en-US", { month: "long" });
const shortDay = (ds) => fmt(ds, { month: "short", day: "numeric" });
/* the month whose sign-up is happening now (or comes next) */
function activeSignupMonth() {
  for (let k = 0; k < 3; k++) { const m = addMonth(monthKey(TODAY), k), w = signupWindow(m); if (TODAY <= w.close) return m; }
  return addMonth(monthKey(TODAY), 1);
}
/* why someone can't pick on a date, in a few words (or "" when they can) */
function windowNote(emp, date) {
  const w = signupWindow(monthKey(date)), lv = levelOf(emp), opens = rankOpens(w, lv);
  if (TODAY < opens) return `${monthWord(date)} sign-up opens for ${lv}s on ${shortDay(opens)}`;
  if (TODAY > w.close) return `${monthWord(date)} sign-up closed ${shortDay(w.close)}`;
  return "";
}
const someNames = (xs, n = 4) => xs.slice(0, n).map((e) => esc(e.name || "Unnamed")).join(", ") + (xs.length > n ? ` <span class="muted">+ ${xs.length - n} more</span>` : "");
const leadOf = (emp) => emp && emp.level === "Lead DSP";
const ctx = () => ({ homes: S.homes, residents: S.residents, clusters: S.clusters });
const teamClass = (t) => "tc" + ((t && t.color) || 0);

/* fast lookups, rebuilt after every load */
const skey = (s) => `${s.date}|${s.block}|${s.teamId}|${s.homeId ?? ""}|${s.clusterNo ?? ""}`;
let IDX = { slot: new Map(), team: new Map(), wait: new Map(), temp: new Map(), busy: new Map(), cm: {} };
function reindex() {
  IDX = { slot: new Map(), team: new Map(), wait: new Map(), temp: new Map(), busy: new Map(), cm: {} };
  const push = (m, k, v) => { const a = m.get(k); a ? a.push(v) : m.set(k, [v]); };
  for (const s of S.signups) { push(IDX.slot, skey(s), s); push(IDX.team, `${s.date}|${s.block}|${s.teamId}`, s); IDX.busy.set(`${s.employeeId}|${s.date}|${s.block}`, s); }
  for (const x of S.temps || []) IDX.temp.set(skey(x), (IDX.temp.get(skey(x)) || 0) + x.count);
  for (const w of [...S.waitlist].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) push(IDX.wait, skey(w), w);
}
const inSlot = (sl) => IDX.slot.get(skey(sl)) || [];
/* temps HR booked for a slot, and total spots taken (DSPs + temps) */
const tempN = (sl) => IDX.temp.get(skey(sl)) || 0;
const taken = (sl) => (IDX.slot.get(skey(sl)) || []).length + tempN(sl);
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
  for (const x of units(team, date, block)) { need += x.need; have += Math.min(taken(x), x.need); }
  // sign-ups that no longer match a slot (e.g. a house removed) still show as people
  return { need, have };
}
/* spots nobody has taken yet, for shifts that haven't started (what HR may need temps for) */
function openSpots(from, to) {
  const out = [], now = Date.now();
  for (let d = from; d <= to; d = addDays(d, 1)) for (let b = 0; b < 6; b++) {
    if (shiftStart(d, b).getTime() <= now) continue;
    for (const t of activeTeams()) for (const u of units(t, d, b)) { const n = u.need - taken(u); if (n > 0) out.push({ ...u, team: t, open: n }); }
  }
  return out;
}
const sumOpen = (xs) => xs.reduce((a, x) => a + x.open, 0);
/* inside 3 days DSPs can't cancel any more, so whatever is open there needs a temp or an HR assignment */
const openSoon = () => openSpots(TODAY, addDays(TODAY, 3)).filter((x) => shiftStart(x.date, x.block) - Date.now() <= DROP_HOURS * 36e5);
const extraMin = (s) => { const t = teamById(s.teamId), g = t && t.staffing === "cluster" && groupOf(s.date, s.clusterNo); return g && g.ones ? 30 : 0; };
const shiftHours = (s) => 4 + extraMin(s) / 60;
const placeOf = (s) => { const h = s.homeId != null && homeById(s.homeId); return h ? h.name : s.clusterNo != null ? `Cluster ${s.clusterNo}` : ""; };
const startsAt = (s) => shiftStart(s.date, s.block);
const farEnough = (s) => startsAt(s) - Date.now() > DROP_HOURS * 36e5;
/* cancel = 3+ days before AND someone on the waitlist to take it (HR can always remove) */
const canDrop = (s) => farEnough(s) && waitOf(s).length > 0;
const empShifts = (empId, from, to) => S.signups.filter((s) => s.employeeId === empId && s.date >= from && s.date <= to).sort((a, b) => (a.date + a.block < b.date + b.block ? -1 : 1));
const weekHours = (empId, ws) => empShifts(empId, ws, addDays(ws, 6)).reduce((a, s) => a + shiftHours(s), 0);
const hrsTxt = (h) => (Math.round(h * 10) / 10).toString();
const busyAt = (emp, date, block) => emp && IDX.busy.get(`${emp.id}|${date}|${block}`);
const myWait = (emp, sl) => emp && waitOf(sl).find((w) => w.employeeId === emp.id);

const offOn = (empId, day) => (S.timeOff || []).some((x) => x.employeeId === empId && x.day === day);
const offerOf = (signupId) => (S.offers || []).find((o) => o.signupId === signupId);
const signupById = (id) => S.signups.find((x) => x.id === id);
const slotText = (s) => { const t = teamById(s.teamId); return `${short(s.date)} · ${BLOCKS[s.block].label} · ${t ? t.shortName : ""}${placeOf(s) ? " · " + placeOf(s) : ""}`; };
const canApprove = (emp, teamId) => isAdmin() || (leadOf(emp) && emp.teams.includes(teamId));
/* what I can do with my own shift: cancel (3+ days out, someone waiting), call out (inside 3 days), or offer it to a teammate */
function shiftBtns(s) {
  if (startsAt(s).getTime() <= Date.now()) return "";
  const o = offerOf(s.id);
  const swap = o ? `<span class="badge">${o.status === "claimed" ? "Swap waiting for approval" : "Offered to teammates"}</span><button class="linkbtn" data-act="canceloffer" data-id="${o.id}">Cancel offer</button>`
    : `<button class="linkbtn" data-act="offer" data-id="${s.id}">Offer to a teammate</button>`;
  const first = canDrop(s) ? `<button class="btn ghost sm" data-act="drop" data-id="${s.id}">Cancel</button>`
    : farEnough(s) ? `<span class="muted tiny" title="You can cancel 3+ days ahead once someone is on the waitlist">Cancel opens when someone's on the waitlist</span>`
    : `<button class="btn danger sm" data-act="callout" data-id="${s.id}">Emergency call-out</button>`;
  return first + swap;
}
function basicOk(emp, date, block, team) {
  if (!emp || !team || !emp.teams.includes(team.id) || offOn(emp.id, date)) return false;
  if (team.needsLicense && !emp.hasLicense) return false;
  if (date < TODAY) return false;
  if (date === TODAY && BLOCKS[block].start <= NOW.getHours()) return false;
  return true;
}
function canTake(emp, sl, team) {
  if (!basicOk(emp, sl.date, sl.block, team) || !pickOpen(levelOf(emp), sl.date, TODAY) || isLocked(sl.date) || busyAt(emp, sl.date, sl.block)) return false;
  const need = sl.need ?? slotNeed(team, sl.date, sl.block, sl.homeId ?? null, sl.clusterNo ?? null, ctx());
  return need > 0 && taken(sl) < need;
}
function canWait(emp, sl, team) {
  if (!basicOk(emp, sl.date, sl.block, team) || !pickOpened(levelOf(emp), sl.date, TODAY) || busyAt(emp, sl.date, sl.block) || myWait(emp, sl)) return false;
  const need = sl.need ?? slotNeed(team, sl.date, sl.block, sl.homeId ?? null, sl.clusterNo ?? null, ctx());
  return need > 0 && taken(sl) >= need && waitOf(sl).length < WAITLIST_MAX;
}
/* the house this DSP usually works (keeps people consistent with the same residents) */
function usualHome(emp, teamId) {
  const c = {}; for (const s of S.signups) if (s.employeeId === emp.id && s.teamId === teamId && s.homeId != null) c[s.homeId] = (c[s.homeId] || 0) + 1;
  const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return best ? +best[0] : null;
}
/* on-campus rotation: each daytime team spends one hour with each of 4 resident clusters,
   skipping clusters that are out on an outing that block; it shifts day to day so every cluster gets a turn */
function rotation(team, block, date) {
  const b = BLOCKS[block], ti = Math.max(activeTeams().filter((t) => t.staffing === "fixed").findIndex((t) => t.id === team.id), 0);
  if (b.night) return null;
  const ds = date || TODAY, cm = monthClusters(monthKey(ds)), out = [];
  const outing = activeTeams().find((t) => t.staffing === "cluster");
  let nos = Object.keys(cm).map(Number).sort((a, c) => a - c);
  const home = nos.filter((c) => !outing || clusterBlock(outing, ds, c) !== block);
  if (home.length >= 4) nos = home;
  for (let h = 0; h < 4; h++) {
    const c = nos.length ? nos[(dayIndex(ds) * 3 + ti * 4 + h) % nos.length] : null;
    out.push({ hour: b.start + h, cluster: c, size: c ? cm[c].members.length : 0, activity: team.activities.length ? team.activities[(h + ti) % team.activities.length] : "" });
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
  const starts = [ms, weekStart(S.weekRef), weekStart(S.hrWeekRef), weekStart(TODAY), S.tempFrom, S.resMonth + "-01"].sort();
  const ends = [me, addDays(weekStart(S.weekRef), 6), addDays(weekStart(S.hrWeekRef), 6), addDays(TODAY, 35), addDays(S.tempFrom, 6), iso(new Date(+S.resMonth.slice(0, 4), +S.resMonth.slice(5), 0))].sort();
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
  const views = { home: viewHome, schedule: viewSchedule, teams: viewTeams, quiz: viewQuiz, hr: viewHR, profile: viewProfile };
  if (S.tab === "hr" && !isAdmin()) S.tab = "home";
  v.innerHTML = (views[S.tab] || viewHome)();
  const key = [S.tab, S.weekRef, S.hrSub, S.hrWeekRef, S.tempFrom, S.y, S.m, S.quiz.i, S.resMonth].join("|");
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
  else if (S.me) { const e = myEmp(); me = `<button class="chip mechip" data-act="tab" data-tab="profile" aria-label="My profile"${S.tab === "profile" ? ' aria-current="page"' : ""}><span class="av"><i style="background:var(--accent);color:var(--accent-ink)">${esc(initials(e && e.name))}</i></span>${esc((e && e.name && e.name.split(" ")[0]) || "Me")}</button>`; }
  $("who").innerHTML = pill + me;
}
function renderTabs() {
  const signedIn = !B || B.mode === "preview" || S.me;
  $("tabs").parentElement.hidden = !signedIn;
  const emp = myEmp();
  $("tabs").innerHTML = TABS.filter((t) => !t.hidden && (!t.admin || isAdmin())).map((t) => {
    let count = "";
    if (t.id === "teams" && emp && !emp.teams.length) count = `<span class="count">start here</span>`;
    if (t.id === "hr" && S.loaded) { const n = sumOpen(openSoon()); if (n) count = `<span class="count" title="${n} spots open in the next 3 days">${n}<span class="cw"> open</span></span>`; }
    return `<button role="tab" aria-selected="${S.tab === t.id || (t.id === "teams" && S.tab === "quiz")}" data-act="tab" data-tab="${t.id}">${t.label}${count}</button>`;
  }).join("");
}
function renderNotice() {
  let h = S.settings.announcement ? `<div class="announce" role="note"><span class="eyebrow">Announcement</span><p>${esc(S.settings.announcement)}</p></div>` : "";
  if (S.notice) h += `<p class="notice" role="status">${esc(S.notice)}</p>`;
  if (S.noAdmin && S.me && !S.me.isAdmin) h += `<p class="notice info">This schedule has no HR admin yet. If you run it, <button class="btn sm" data-act="claim">Claim admin</button></p>`;
  if (isAdmin() && S.loaded && S.tab === "hr" && S.hrSub !== "temps" && S.hrSub !== "coverage") {
    const n = sumOpen(openSoon());
    if (n) h += `<p class="notice info hrnote"><span><b>HR: ${plural(n, "spot")} still open in the next 3 days.</b> DSPs can't cancel these any more, so they need a temp or an assignment.</span> <button class="btn sm" data-act="gotemps">See temps needed</button></p>`;
  }
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

  let h = `<div class="hello"><div><span class="eyebrow">${long(TODAY)}</span><h2>${needName ? "Welcome!" : "Hi, " + esc(emp.name.split(" ")[0])}</h2>
    <div class="chips" style="margin-top:6px"><span class="badge">${esc(emp.level)}</span>${emp.teams.map((id) => { const t = teamById(id); return t ? `<span class="chip ${teamClass(t)}"><span class="dot tbg"></span>${esc(t.shortName)}</span>` : ""; }).join("")}</div></div></div>`;
  if (needName) h += `<div class="card" style="margin-bottom:18px"><form class="form" data-form="myname"><label class="wide">Your name (shown to HR and your team)<input name="name" maxlength="60" required placeholder="First and last name"></label><button class="btn lg">Save</button></form></div>`;
  if (!emp.teams.length) h += `<div class="card" style="margin-bottom:18px;border-color:var(--accent)"><div class="sec-title"><h2>First, find your team</h2></div><p class="muted" style="margin:0 0 12px">You'll only see and take shifts on your team(s). Take the 2-minute quiz, or pick teams yourself.</p><button class="btn lg" data-act="tab" data-tab="quiz">Take the quiz</button> <button class="btn ghost lg" data-act="tab" data-tab="teams">See the teams</button></div>`;

  if (!seenTips() && emp.teams.length) h += `<section class="card tips"><div class="sec-title"><h3>Welcome to the new schedule</h3><button class="btn sm" data-act="tipsdone">Got it</button></div>
    <ol><li><b>Pick shifts on the Schedule tab.</b> Tap a day, then tap 4 hrs or 8 hrs.</li><li><b>Shift full?</b> Join the waitlist. If someone drops, you're added automatically.</li><li><b>Turn on phone alerts</b> (tap your name, top right) for a heads-up 24 hours and 1 hour before.</li></ol></section>`;
  h += `<div class="grid2"><div class="stack">`;
  h += `<section class="card week"><div class="sec-title"><h3>Week of ${fmt(ws, { month: "short", day: "numeric" })} – ${fmt(we, { month: "short", day: "numeric" })}</h3>
    <div class="weeknav"><button data-act="week" data-d="-7" aria-label="Previous week">‹</button><button class="linkbtn" data-act="week" data-d="0">This week</button><button data-act="week" data-d="7" aria-label="Next week">›</button></div></div>
    <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap"><div class="bignum">${hrsTxt(hours)}<small> / ${target} hrs</small></div>${status}<span class="muted" style="font-size:14px;margin-left:auto">${plural(mine.length, "shift")}${isLocked(ws) ? " · final schedule" : ""}</span>${emp.teams.length ? `<button class="btn" data-act="tab" data-tab="schedule">${hours >= target ? "Add hours" : "Pick shifts"}</button>` : ""}</div>
    <div class="progress" role="img" aria-label="${hrsTxt(hours)} of ${target} hours scheduled">${Object.entries(perTeam).map(([tid, n]) => { const t = teamById(+tid); return `<span class="${teamClass(t)} tbg" style="width:${(n / scale) * 100}%" title="${esc(t ? t.shortName : "")}: ${hrsTxt(n)}h"></span>`; }).join("")}<i class="target" style="left:calc(${(target / scale) * 100}% - 1px)"></i></div>
    <div class="progress-key">${Object.entries(perTeam).map(([tid, n]) => { const t = teamById(+tid); return `<span class="${teamClass(t)}"><i></i>${esc(t ? t.shortName : "")} ${hrsTxt(n)}h</span>`; }).join("") || "<span>No shifts this week yet</span>"}</div>
    <div class="days7">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const d = addDays(ws, i), ss = mine.filter((s) => s.date === d);
      return `<button class="d7${d === TODAY ? " today" : ""}" data-act="openday" data-date="${d}"><span class="dn">${fmt(d, { weekday: "short" })} ${parse(d).getDate()}</span>${ss.length ? ss.map((s) => { const t = teamById(s.teamId), p = placeOf(s); return `<span class="bar ${teamClass(t)}" title="${esc(t ? t.shortName : "")}${p ? " · " + esc(p) : ""}">${hShort(BLOCKS[s.block].start)}<span class="endt">–${hShort(BLOCKS[s.block].end)}</span>${p ? `<em>${esc(p.replace(/^Home\s*/i, "H").replace(/^Cluster\s*/i, "C"))}</em>` : ""}</span>`; }).join("") : `<span class="off">Off</span>`}</button>`; }).join("")}</div></section>`;
  h += `</div><div class="stack">`;
  h += nextShift(emp) + swapsCard(emp) + waitCard(emp);
  h += `</div></div>`;
  return h;
}
/* open shifts on my teams between two dates, with the house/cluster I'd most likely want */
function openForMe(emp, ws, we) {
  const from = ws > TODAY ? ws : TODAY, list = [];
  for (let d = from; d <= we && list.length < 60; d = addDays(d, 1)) for (let b = 0; b < 6; b++) for (const tid of emp.teams) {
    const t = teamById(tid); if (!t || !basicOk(emp, d, b, t) || !pickOpen(levelOf(emp), d, TODAY) || isLocked(d) || busyAt(emp, d, b)) continue;
    const open = units(t, d, b).filter((u) => taken(u) < u.need);
    if (!open.length) continue;
    let pick = open[0];
    if (t.staffing === "home") { const fav = usualHome(emp, t.id); pick = open.find((u) => u.homeId === fav) || open.sort((a, b2) => taken(a) - taken(b2))[0]; }
    list.push({ d, b, t, open, pick });
  }
  return list.sort((a, b) => (a.d !== b.d ? (a.d < b.d ? -1 : 1) : a.b - b.b || a.t.sort - b.t.sort));
}
/* ---------- shift preferences: which days and times I like, and my longest day ---------- */
const DAYN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function prefsOf(emp) {
  if (emp && emp.prefs && emp.prefs.days) return emp.prefs;
  try { const p = JSON.parse(localStorage.getItem("magnolia-prefs") || "null"); if (p && p.days) return p; } catch (_) {}
  return null;
}
function prefsText(p) {
  const d = [...p.days].sort(), k = d.join("");
  const days = k === "0123456" ? "Any day" : k === "12345" ? "Weekdays" : k === "06" ? "Weekends" : [1, 2, 3, 4, 5, 6, 0].filter((x) => d.includes(x)).map((x) => DAYN[x]).join(", ");
  const b = [...p.blocks].sort((x, y) => x - y), run = b.every((x, i) => !i || x === b[i - 1] + 1);
  const times = b.length === 6 ? "any time" : run && b.length ? `${clock(BLOCKS[b[0]].start * 60)}–${clock(BLOCKS[b[b.length - 1]].end * 60)}` : b.map((x) => BLOCKS[x].label).join(", ");
  return `${days} · ${times} · up to ${p.maxPerDay || 8} hrs a day`;
}
/* the form, used in My profile and the first time someone taps Fill my week */
function prefsForm(emp, then) {
  const p = prefsOf(emp) || { days: [1, 2, 3, 4, 5], blocks: [2, 3, 4], maxPerDay: 8 };
  const tog = (name, v, label, on) => `<label class="tog"><input type="checkbox" name="${name}" value="${v}"${on ? " checked" : ""}><span>${label}</span></label>`;
  return `<form class="prefs" data-form="prefs"${then ? ` data-then="${then}"` : ""}>
    <div><span class="eyebrow">Days I like to work</span><div class="togs">${[1, 2, 3, 4, 5, 6, 0].map((d) => tog("day", d, DAYN[d], p.days.includes(d))).join("")}</div></div>
    <div><span class="eyebrow">Times I like to work</span><div class="togs">${BLOCKS.map((b, i) => tog("blk", i, b.label.replace(/\s?(AM|PM)/g, (m) => m.trim().toLowerCase()[0]), p.blocks.includes(i))).join("")}</div></div>
    <div><span class="eyebrow">Longest day</span><div class="togs">${[4, 8].map((n) => `<label class="tog"><input type="radio" name="max" value="${n}"${(p.maxPerDay || 8) === n ? " checked" : ""}><span>${n} hrs</span></label>`).join("")}</div></div>
    <div class="rowact" style="margin:0;justify-content:flex-start">${then ? `<button type="button" class="btn quiet" data-act="cancelplan">Not now</button><button class="btn gold">Save and build my week</button>` : `<button class="btn">Save preferences</button>`}</div></form>`;
}
/* a plan that gets me to my weekly target: at most 8 hours a day, back-to-back blocks first */
function fillPlan(emp, list, hours, target) {
  const P = prefsOf(emp), cap = P ? Math.max(1, (P.maxPerDay || 8) / 4) : 2;
  if (P) list = list.filter((x) => P.days.includes(parse(x.d).getDay()) && P.blocks.includes(x.b));
  const perDay = {}, used = new Set(), plan = []; let h = hours;
  for (const s of S.signups) if (s.employeeId === emp.id) (perDay[s.date] ||= []).push(s.block);
  const score = (x) => ((perDay[x.d] || []).some((b) => Math.abs(b - x.b) === 1) ? 0 : 1);   // next to a block I already have
  for (const pass of [0, 1]) for (const x of list) {
    if (h >= target) return plan;
    const k = `${x.d}|${x.b}`, mine = perDay[x.d] || [];
    if (used.has(k) || mine.length >= cap || (pass === 0 && mine.length && score(x))) continue;
    used.add(k); (perDay[x.d] ||= []).push(x.b); plan.push(x); h += 4;
  }
  return plan;
}
function seenTips() { try { return localStorage.getItem("magnolia-tips-done") === "1"; } catch (_) { return true; } }
function waitCard(emp) {
  const mine = S.waitlist.filter((w) => w.employeeId === emp.id && w.date >= TODAY).sort((a, b) => (a.date + a.block < b.date + b.block ? -1 : 1));
  if (!mine.length) return "";
  return `<section class="card"><span class="eyebrow">My waitlists</span><div class="waits">${mine.map((w) => { const t = teamById(w.teamId), q = waitOf(w), pos = q.findIndex((x) => x.id === w.id) + 1;
    return `<div class="wrow ${teamClass(t)}"><div><b>${short(w.date)} · ${BLOCKS[w.block].label}</b><small>${esc(t ? t.shortName : "")}${placeOf(w) ? " · " + esc(placeOf(w)) : ""}</small></div><span class="badge">#${pos} of ${q.length}</span><button class="linkbtn" data-act="leavewait" data-id="${w.id}">Leave</button></div>`; }).join("")}</div>
    <p class="muted note">If someone drops, the first person in line gets the shift automatically and an alert.</p></section>`;
}
function swapRows(list, btns) {
  return `<div class="waits">${list.map((o) => { const sg = signupById(o.signupId), t = sg && teamById(sg.teamId), a = empById(o.fromId), b = o.toId && empById(o.toId);
    return sg ? `<div class="wrow ${teamClass(t)}"><div><b>${esc(slotText(sg))}</b><small>${b ? `${esc(b.name)} takes it from ${esc(a ? a.name : "?")}` : `Offered by ${esc(a ? a.name : "?")}`}</small></div>${btns(o, sg)}</div>` : ""; }).join("")}</div>`;
}
function swapsCard(emp) {
  const live = (S.offers || []).filter((o) => { const sg = signupById(o.signupId); return sg && startsAt(sg).getTime() > Date.now(); });
  const approve = live.filter((o) => o.status === "claimed" && canApprove(emp, signupById(o.signupId).teamId));
  const grabs = live.filter((o) => { const sg = signupById(o.signupId); return o.status === "open" && o.fromId !== emp.id && emp.teams.includes(sg.teamId) && !busyAt(emp, sg.date, sg.block) && !offOn(emp.id, sg.date); });
  const pending = live.filter((o) => o.status === "claimed" && o.toId === emp.id);
  if (!approve.length && !grabs.length && !pending.length) return "";
  let h = `<section class="card swaps"><span class="eyebrow">Shift swaps</span>`;
  if (approve.length) h += `<p class="swh"><b>Waiting for your OK</b> <span class="badge warn">${approve.length}</span></p>` + swapRows(approve, (o) => `<button class="btn sm" data-act="approve" data-id="${o.id}">Approve</button><button class="linkbtn" data-act="decline" data-id="${o.id}">Decline</button>`);
  if (grabs.length) h += `<p class="swh"><b>Up for grabs on your teams</b></p>` + swapRows(grabs.slice(0, 4), (o) => `<button class="btn sm" data-act="claim" data-id="${o.id}">I'll take it</button>`);
  if (pending.length) h += `<p class="swh"><b>You asked for</b></p>` + swapRows(pending, () => `<span class="badge">Waiting for approval</span>`);
  return h + `<p class="muted note">A swap is final once HR or the team's Lead DSP approves it.</p></section>`;
}
function timeOffBlock(emp) {
  const mine = (S.timeOff || []).filter((x) => x.employeeId === emp.id && x.day >= TODAY).sort((a, b) => (a.day < b.day ? -1 : 1));
  return `<div class="timeoff"><b>Days I can't work</b><span class="muted" style="font-size:13px">HR sees these and you won't be offered shifts on them</span>
    <form data-form="timeoff"><input type="date" name="day" min="${TODAY}" required aria-label="Day"><input name="note" maxlength="120" placeholder="Note (optional)" aria-label="Note"><button class="btn sm">Add</button></form>
    ${mine.length ? `<div class="places">${mine.map((x) => `<span>${short(x.day)}${x.note ? " · " + esc(x.note) : ""} <button class="x" data-act="deltimeoff" data-id="${x.id}" aria-label="Remove ${short(x.day)}">×</button></span>`).join("")}</div>` : ""}</div>`;
}
function myTeamCard(emp, ws, we) {
  if (!emp.teams.length) return "";
  const mine = empShifts(emp.id, ws, we), mates = {};
  for (const s of mine) for (const o of inSlot(s)) if (o.employeeId !== emp.id) mates[o.employeeId] = (mates[o.employeeId] || 0) + 1;
  const top = Object.entries(mates).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const leads = emp.teams.map((id) => { const t = teamById(id); let l = S.employees.filter((e) => e.active !== false && e.teams.includes(id) && e.level === "Lead DSP");
    if (t && t.staffing === "home") { const fh = usualHome(emp, id), mineL = l.filter((e) => usualHome(e, id) === fh); if (fh && mineL.length) l = mineL; }   // the Lead at my house first
    return t ? `<div class="rosterrow"><span class="eyebrow ${teamClass(t)}" style="color:var(--tc)">${esc(t.shortName)}</span><span>Lead: ${l.length ? someNames(l, 3) : '<span class="muted">not assigned</span>'}</span></div>` : ""; }).join("");
  const home = emp.teams.map((id) => teamById(id)).find((t) => t && t.staffing === "home");
  const fav = home && usualHome(emp, home.id), favH = fav && homeById(fav);
  return `<section class="card"><span class="eyebrow">My team</span><div class="roster mt" style="margin-top:8px">${leads}${favH ? `<div class="rosterrow"><span class="eyebrow">My house</span><span>${esc(favH.name)} <span class="muted">· usually</span></span></div>` : ""}</div>
    <div style="margin-top:10px;font-size:14px"><b>Working with you this week</b><div class="mates">${top.length ? top.map(([id, n]) => { const e = empById(id); return `<span class="av"><i style="background:var(--accent);color:var(--accent-ink)">${esc(initials(e && e.name))}</i>${esc(e ? e.name.split(" ")[0] : "?")}${leadOf(e) ? ' <b class="lead">Lead</b>' : ""} <span class="muted">· ${n}</span></span>`; }).join("") : '<span class="muted">Pick shifts to see who you\'ll work with.</span>'}</div></div></section>`;
}
function rotationHtml(team, s) {
  if (team.staffing === "home") { const h = homeById(s.homeId); const rs = S.residents.filter((r) => r.active !== false && r.homeId === s.homeId); return `<p class="muted note">Stay with ${esc(h ? h.name : "your house")}${rs.length ? ": " + rs.map((r) => esc(r.firstName)).join(", ") : ""}.</p>`; }
  if (team.staffing === "cluster") { const g = groupOf(s.date, s.clusterNo); return g ? `<div style="margin-top:10px"><b style="font-size:13.5px">Your cluster: ${plural(g.members.length, "resident")}</b>${groupHtml(g, true)}</div>` : ""; }
  const r = rotation(team, s.block, s.date);
  if (!r) return `<p class="muted note">Overnight residential coverage.</p>`;
  return `<div class="rot">${r.map((x) => `<div><b>${hShort(x.hour)}–${hShort(x.hour + 1)}${x.cluster ? " · Cluster " + x.cluster : ""}</b>${esc(x.activity)}${x.size ? `<br><span class="muted" style="font-size:11.5px">${x.size} residents</span>` : ""}</div>`).join("")}</div>`;
}
/* my hour-by-hour cluster rotation for one on-campus shift, as a short list */
function rotList(team, s) {
  const r = rotation(team, s.block, s.date);
  if (!r || !r.some((x) => x.cluster)) return "";
  return `<div class="myrot"><b>Your rotation</b><ol>${r.map((x) => `<li><span class="tm">${hShort(x.hour)}–${hShort(x.hour + 1)}</span><b>Cluster ${x.cluster}</b><span class="muted">${esc(x.activity)}${x.size ? ` · ${x.size} residents` : ""}</span></li>`).join("")}</ol></div>`;
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
    ${shiftBtns(s) ? `<div class="rowact" style="justify-content:flex-start;align-items:center;margin:12px 0 0"><span class="muted tiny">Can't make it?</span>${shiftBtns(s)}</div>` : ""}</section>`;
}
/* the sign-up calendar for the month being scheduled: Lead DSPs → DSP IIs → DSP Is → closes */
function windowTimeline(month, me) {
  const w = signupWindow(month), steps = [["Lead DSPs", w.lead, "Lead DSP"], ["DSP IIs", w.ii, "DSP II"], ["DSP Is", w.i, "DSP I"], ["Sign-up closes", w.close, null]];
  const now = steps.filter((x) => TODAY >= x[1]).length;   // how many steps have started
  return `<ol class="wline">${steps.map(([lab, d, lv], k) => `<li class="${k < now ? "done" : ""}${k === now - 1 ? " now" : ""}${me && lv === me ? " mine" : ""}"><i></i><b>${lab}</b><span>${k === 3 ? "end of " : ""}${shortDay(d)}</span>${me && lv === me ? `<em>You</em>` : ""}</li>`).join("")}</ol>`;
}
function cycleCard(emp) {
  const m = activeSignupMonth(), w = signupWindow(m), lv = levelOf(emp), opens = rankOpens(w, lv);
  const msg = TODAY < opens ? `<b>${monthWord(m + "-01")} sign-up opens for you on ${long(opens)}.</b> Lead DSPs pick first, then DSP IIs, then DSP Is.`
    : TODAY <= w.close ? `<b>${monthWord(m + "-01")} sign-up is open for you until ${long(w.close)}.</b> After that, HR fills any gaps.`
    : `<b>${monthWord(m + "-01")} sign-up has closed.</b>`;
  return `<section class="card"><span class="eyebrow">Sign-up calendar · ${monthName(m)}</span><p style="margin:6px 0 10px;font-size:15px">${msg}</p>${windowTimeline(m, lv)}
    <p class="muted note">Need to cancel? Only 3 or more days ahead, and only when someone is on the waitlist. Otherwise offer it to a teammate.</p></section>`;
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
function viewProfile() {
  const emp = myEmp();
  if (!emp) return `<div class="empty">Loading…</div>`;
  const P = prefsOf(emp);
  return `<div class="sec-title"><h2>My profile</h2><button class="linkbtn" data-act="tab" data-tab="home">Back to My week</button></div>
    <div class="grid2"><div class="stack"><section class="card"><span class="eyebrow">Shift preferences</span><p class="muted" style="margin:4px 0 12px;font-size:13.5px">${P ? `Now: <b style="color:var(--ink)">${esc(prefsText(P))}</b>. ` : ""}Fill my week only picks shifts that match these.</p>${prefsForm(emp)}</section>${profileCard(emp)}</div><div class="stack">${cycleCard(emp)}</div></div>`;
}
function profileCard(emp) {
  return `<section class="card"><span class="eyebrow">Alerts and details</span>
    ${alertsBlock()}
    ${timeOffBlock(emp)}
    <div class="checks" style="margin:10px 0"><label><input type="checkbox" data-act="mylicense" ${emp.hasLicense ? "checked" : ""}> I have a driver's license</label><label><input type="checkbox" data-act="mycna" ${emp.hasCna ? "checked" : ""}> CNA certified</label>
    <label><input type="checkbox" data-act="remind" ${S.me && S.me.reminders !== false ? "checked" : ""}> Email me shift reminders too</label></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn ghost" data-act="ics">Add my shifts to my phone calendar</button><button class="linkbtn" data-act="rename">Change name</button>${B.mode === "live" ? `<button class="linkbtn" data-act="signout">Sign out</button>` : ""}</div></section>`;
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
      ${S.preview ? S.preview.plan.filter((x) => x.d === ds).map((x) => `<span class="mine ghost ${teamClass(x.t)}">${hShort(BLOCKS[x.b].start)} ${esc(x.pick.label ? x.pick.label.replace(/^Home\s*/i, "H").replace(/^Cluster\s*/i, "C") : x.t.shortName)}</span>`).join("") : ""}
      <span class="cov${pct < 0.7 ? " low" : ""}" title="${Math.round(pct * 100)}% staffed"><span style="width:${pct * 100}%"></span></span></button>`;
  }
  let wk = "";
  if (emp && emp.teams.length) {
    const ws = weekStart(S.sel), hrs = weekHours(emp.id, ws), tgt = emp.weeklyTarget || 40;
    if (S.askPrefs) {
      wk = `<div class="plan ask"><div><b>${prefsOf(emp) ? "Change your preferences" : "First, when do you like to work?"}</b><span class="muted">Fill my week only picks shifts that match. You can change this anytime in My profile.</span></div>${prefsForm(emp, "plan")}</div>`;
    } else if (S.preview && S.preview.ws === ws) { const P = S.preview, n = P.plan.length;
      wk = `<div class="plan"><div><b>Here's a plan: ${plural(n, "shift")}, ${n * 4} hrs</b><span class="muted">Dashed tags on the calendar. Brings you to ${hrsTxt(P.hours + n * 4)} of ${P.target} hrs.</span>
        <span class="muted tiny">Using: ${esc(prefsText(prefsOf(emp)))} · <button class="linkbtn" data-act="editprefs">Change</button></span>
        <ul>${P.plan.map((x) => `<li>${short(x.d)} · ${BLOCKS[x.b].label} · ${esc(x.t.shortName)}${x.pick.label ? " · " + esc(x.pick.label) : ""}</li>`).join("")}</ul></div>
        <div class="rowact" style="margin:0"><button class="btn quiet" data-act="cancelplan">Not now</button><button class="btn gold" data-act="bookplan">Book these</button></div></div>`;
    } else
    wk = `<div class="weekhrs"><span><b>${hrsTxt(hrs)}</b> / ${tgt} hrs <span class="muted">· week of ${fmt(ws, { month: "short", day: "numeric" })}</span></span>${hrs < tgt && addDays(ws, 6) >= TODAY ? `<button class="btn sm gold" data-act="autofill">Fill my week for me</button>` : ""}</div>`;
  }
  return `<div class="grid2"><div><div class="calhead"><button class="iconbtn" data-act="month" data-d="-1" aria-label="Previous month">‹</button><h2>${monthName(mk)}</h2><button class="iconbtn" data-act="month" data-d="1" aria-label="Next month">›</button>
</div>${wk}
    <div class="dow">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => `<div>${x}</div>`).join("")}</div><div class="cal">${cal}</div>
    <p class="muted" style="font-size:13px;margin-top:10px">Colored tags are your shifts (H = house, C = outing cluster). The bar under each day shows staffing (orange = short). ${emp ? esc(windowNote(emp, activeSignupMonth() + "-01") || `${monthWord(activeSignupMonth() + "-01")} sign-up is open for you until ${shortDay(signupWindow(activeSignupMonth()).close)}`) + "." : ""}</p></div>
    <aside class="card day" id="day">${dayPanel(emp)}</aside></div>`;
}
/* buttons for one slot: take / drop / waitlist / why not */
function slotActs(emp, u, t, hr) {
  const ppl = inSlot(u), mineHere = emp && ppl.find((s) => s.employeeId === emp.id), busy = busyAt(emp, u.date, u.block), past = u.date < TODAY;
  const data = `data-date="${u.date}" data-block="${u.block}" data-team="${t.id}" data-home="${u.homeId ?? ""}" data-cl="${u.clusterNo ?? ""}"`;
  let a = "";
  if (mineHere) a = `<span class="badge good">You</span>` + shiftBtns(mineHere);
  else if (canTake(emp, u, t)) {
    const next = u.block < 5 && t.staffing !== "cluster" && units(t, u.date, u.block + 1).find((x) => x.homeId === u.homeId && x.clusterNo === u.clusterNo);
    a = `<button class="btn sm" data-act="take" ${data}>4 hrs</button>` + (next && canTake(emp, next, t) ? ` <button class="btn ghost sm" data-act="take" ${data} data-two="1">8 hrs</button>` : "");
  } else if (myWait(emp, u)) { const q = waitOf(u), w = myWait(emp, u); a = `<span class="badge">Waitlist #${q.indexOf(w) + 1}</span> <button class="linkbtn" data-act="leavewait" data-id="${w.id}">Leave</button>`; }
  else if (canWait(emp, u, t)) a = `<button class="btn quiet sm" data-act="wait" ${data}>Join waitlist${waitOf(u).length ? ` · ${waitOf(u).length} ahead` : ""}</button>`;
  else if (busy && !past) { const bt = teamById(busy.teamId); a = `<span class="muted tiny">You're on ${esc(bt ? bt.shortName : "another shift")}${placeOf(busy) ? " · " + esc(placeOf(busy)) : ""}</span>`; }
  else if (emp && !emp.teams.includes(t.id)) a = `<span class="muted tiny">Not your team</span>`;
  else if (emp && t.needsLicense && !emp.hasLicense && !past) a = `<span class="muted tiny">Needs a driver's license</span>`;
  else if (emp && !past && taken(u) < u.need && windowNote(emp, u.date)) a = `<span class="muted tiny">${esc(windowNote(emp, u.date))}</span>`;
  else if (!past && taken(u) >= u.need && waitOf(u).length >= WAITLIST_MAX) a = `<span class="muted tiny">Full · waitlist full</span>`;
  if (hr && taken(u) < u.need && !past) {
    const free = S.employees.filter((e) => e.active !== false && e.teams.includes(t.id) && !busyAt(e, u.date, u.block) && !offOn(e.id, u.date));
    if (free.length) a += ` <select data-assign="${u.date}|${u.block}|${t.id}|${u.homeId ?? ""}|${u.clusterNo ?? ""}" aria-label="Assign someone"><option value="">Assign…</option>${free.map((e) => `<option value="${esc(e.id)}">${esc(e.name || "Unnamed")}</option>`).join("")}</select>`;
  }
  return a;
}
function pplHtml(emp, u, t, hr) {
  const ppl = inSlot(u), q = waitOf(u), tn = tempN(u);
  if (!ppl.length && !q.length && !tn) return "";
  return `<div class="ppl">${ppl.map((s) => { const e = empById(s.employeeId); return avatar(e, t, hr ? `<button data-act="remove" data-id="${s.id}" data-name="${esc(e ? e.name : "")}" aria-label="Remove">×</button>` : "").replace('class="av"', `class="av${emp && s.employeeId === emp.id ? " me" : ""}"`); }).join("")}
    ${tn ? `<span class="av temp"><i>T</i>Temp${tn > 1 ? " ×" + tn : ""}${hr ? `<button data-act="untemp" data-date="${u.date}" data-block="${u.block}" data-team="${t.id}" data-home="${u.homeId ?? ""}" data-cl="${u.clusterNo ?? ""}" data-n="-1" aria-label="Remove one temp">×</button>` : ""}</span>` : ""}
    ${q.length ? `<span class="muted tiny" style="align-self:center">Waitlist: ${q.map((w) => esc((empById(w.employeeId) || {}).name ? empById(w.employeeId).name.split(" ")[0] : "?")).join(", ")}</span>` : ""}</div>`;
}
function dayPanel(emp) {
  const ds = S.sel, past = ds < TODAY, locked = isLocked(ds);
  const hr = isAdmin() && S.hrTools;
  const teams = activeTeams().filter((t) => hr || !S.myTeamsOnly || !emp || emp.teams.includes(t.id));
  let h = `<div class="sec-title"><div><h2>${long(ds)}</h2><span class="muted" style="font-size:13px">${past ? "Past day · view only" : locked ? "Final schedule (published). Full shifts still take waitlists." : emp && !S.hrTools && windowNote(emp, ds) ? esc(windowNote(emp, ds)) + ". Waitlists stay open." : "Tap 4 hrs for one block, 8 hrs for two in a row"}</span></div>
    <span class="checks">${emp && !hr ? `<label><input type="checkbox" data-act="myonly" ${S.myTeamsOnly ? "checked" : ""}> My teams only</label>` : ""}${isAdmin() ? `<label><input type="checkbox" data-act="hrtools" ${S.hrTools ? "checked" : ""}> HR tools</label>` : ""}</span></div>`;
  if (!teams.length) return h + `<div class="empty">You're not on a team yet. <button class="linkbtn" data-act="tab" data-tab="quiz">Find your team</button></div>`;
  // DSPs see only blocks where they work or can still do something; "Show all" brings back the rest
  const focus = emp && !hr && S.myTeamsOnly && !S.allBlocks && !past;
  const useful = (t, b) => units(t, ds, b).some((u) => inSlot(u).some((x) => x.employeeId === emp.id) || myWait(emp, u) || canTake(emp, u, t) || canWait(emp, u, t));
  let shown = 0, hidden = 0;
  for (let b = 0; b < 6; b++) {
    const all = teams.filter((t) => t.needs[b] > 0), here = focus ? all.filter((t) => useful(t, b)) : all;
    hidden += all.length - here.length;
    if (!here.length) continue;
    shown++;
    h += `<div class="blockrow"><div class="bl">${BLOCKS[b].label}<br>${isNight(b) ? `<span class="badge night">Overnight</span>` : ""}</div><div class="slots">`;
    for (const t of here) {
      const us = units(t, ds, b), onTeam = emp && emp.teams.includes(t.id), dim = emp && !onTeam && !hr ? " dim" : "";
      if (t.staffing === "fixed" || (us.length === 1 && !us[0].label)) {
        const u = us[0]; if (!u) continue;
        const ppl = inSlot(u), mineHere = emp && ppl.some((s) => s.employeeId === emp.id);
        h += `<div class="slot ${teamClass(t)}${mineHere ? " mine" : ""}${dim}"><span class="nm">${esc(t.shortName)}</span><span class="fill${taken(u) >= u.need ? " full" : ""}">${taken(u)}/${u.need}</span>${hr && ppl.length && !ppl.some((s) => leadOf(empById(s.employeeId))) ? `<span class="badge warn">No Lead DSP</span>` : ""}${slotActs(emp, u, t, hr)}${pplHtml(emp, u, t, hr)}${mineHere ? rotList(t, u) : ""}</div>`;
        continue;
      }
      // per-house or per-cluster team: summary + pick grid
      const key = `${ds}|${b}|${t.id}`, tot = totals(t, ds, b), mine = emp && inTeam(ds, b, t.id).find((s) => s.employeeId === emp.id);
      const openUnits = us.filter((u) => taken(u) < u.need).length, word = t.staffing === "home" ? "house" : "cluster";
      const open = S.open === key;
      h += `<div class="slot big ${teamClass(t)}${mine ? " mine" : ""}${dim}"><span class="nm">${esc(t.shortName)}<small>${us.length ? `${plural(us.length, word)}${t.staffing === "cluster" ? " out" : ""} · ${openUnits} with room` : `No ${word}s out this block`}</small></span><span class="fill${tot.have >= tot.need ? " full" : ""}">${tot.have}/${tot.need}</span>
        ${mine ? `<span class="badge good">You · ${esc(placeOf(mine))}</span>` : ""}
        ${!mine && !open ? quickPick(emp, t, us) : ""}
        ${us.length ? `<button class="btn ${open ? "quiet" : "ghost"} sm" data-act="openunits" data-key="${key}" aria-expanded="${open}">${open ? "Close" : mine || past ? `See ${word}s` : quickPick(emp, t, us) ? `Other ${word}s` : openUnits ? `Pick a ${word}` : "Join a waitlist"}</button>` : ""}
        ${open ? unitGrid(emp, t, us, hr) : ""}</div>`;
    }
    h += `</div></div>`;
  }
  if (focus && !shown) h += `<div class="empty" style="padding:22px 10px">Nothing open for you on this day.${hidden ? ` <button class="linkbtn" data-act="allblocks">Show every shift</button>` : ""}</div>`;
  else if (focus && hidden) h += `<p class="muted tiny" style="margin:10px 0 0">Hiding ${plural(hidden, "full shift")}. <button class="linkbtn" data-act="allblocks">Show all</button></p>`;
  else if (S.allBlocks && emp && !hr && !past) h += `<p class="muted tiny" style="margin:10px 0 0"><button class="linkbtn" data-act="allblocks">Only show shifts I can take</button></p>`;
  return h;
}
/* the one slot to offer straight away: my usual house if it has room, else the emptiest one I can take */
function quickPick(emp, t, us) {
  if (!emp) return "";
  const ok = us.filter((u) => canTake(emp, u, t)); if (!ok.length) return "";
  const fav = t.staffing === "home" ? usualHome(emp, t.id) : null;
  const u = ok.find((x) => x.homeId === fav) || ok.sort((a, b) => taken(a) - taken(b))[0];
  const data = `data-date="${u.date}" data-block="${u.block}" data-team="${t.id}" data-home="${u.homeId ?? ""}" data-cl="${u.clusterNo ?? ""}"`;
  const next = u.block < 5 && t.staffing !== "cluster" && units(t, u.date, u.block + 1).find((x) => x.homeId === u.homeId && x.clusterNo === u.clusterNo);
  return `<span class="quick"><button class="btn sm" data-act="take" ${data}>${esc(u.label)} · 4 hrs</button>${next && canTake(emp, next, t) ? `<button class="btn ghost sm" data-act="take" ${data} data-two="1">8 hrs</button>` : ""}${u.homeId != null && u.homeId === fav ? `<span class="muted tiny">your usual</span>` : ""}</span>`;
}
function unitGrid(emp, t, us, hr) {
  const fav = emp && t.staffing === "home" ? usualHome(emp, t.id) : null;
  const sel = us.find((u) => skey(u) === S.pick) || (emp && us.find((u) => inSlot(u).some((s) => s.employeeId === emp.id))) || us.find((u) => u.homeId === fav && taken(u) < u.need) || us.find((u) => taken(u) < u.need) || us[0];
  const chips = us.map((u) => { const n = taken(u), mine = emp && inSlot(u).some((s) => s.employeeId === emp.id), q = waitOf(u).length;
    return `<button class="uchip${n >= u.need ? " full" : n === 0 ? " empty" : ""}${mine ? " mine" : ""}${u === sel ? " on" : ""}" data-act="pickunit" data-k="${esc(skey(u))}" aria-pressed="${u === sel}" title="${esc(u.label)}: ${n} of ${u.need}${q ? `, ${q} waiting` : ""}">
      <b>${esc(t.staffing === "home" ? u.short : "C" + u.short)}</b><span class="dots">${Array.from({ length: u.need }, (_, i) => `<i class="${i < n ? "f" : ""}"></i>`).join("")}</span>${u.homeId === fav ? `<em>usual</em>` : ""}</button>`; }).join("");
  const n = taken(sel);
  return `<div class="ugrid">${chips}</div>
    <div class="udetail"><div class="uhead"><b>${esc(sel.label)}</b><span class="fill${n >= sel.need ? " full" : ""}">${n}/${sel.need} DSPs</span>${t.staffing === "cluster" && sel.group && sel.group.ones ? `<span class="badge">+30 min</span>` : ""}${slotActs(emp, sel, t, hr)}</div>
    ${t.staffing === "cluster" ? groupHtml(sel.group) : (() => { const rs = S.residents.filter((r) => r.active !== false && r.homeId === sel.homeId); return rs.length ? `<p class="muted note">Residents: ${rs.map((r) => esc(r.firstName)).join(", ")}</p>` : ""; })()}
    ${pplHtml(emp, sel, t, hr)}</div>`;
}

/* ---------- TEAMS & HOMES ---------- */
function viewTeams() {
  const emp = myEmp();
  let h = emp && emp.teams.length ? `<div style="margin-bottom:18px">${myTeamCard(emp, weekStart(TODAY), addDays(weekStart(TODAY), 6))}</div>` : "";
  h += `<div class="sec-title"><h2>Activity teams</h2><button class="btn ${emp && !emp.teams.length ? "" : "ghost "}sm" data-act="tab" data-tab="quiz">Not sure? Take the 2-minute quiz</button></div><div class="grid3">`;
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
  // today's cluster rotation, only for the on-campus style teams I'm on (everyone's, if I'm on none)
  const fixedTeams = activeTeams().filter((t) => t.staffing === "fixed"), mineFixed = fixedTeams.filter((t) => emp && emp.teams.includes(t.id));
  const rotTeams = mineFixed.length || (emp && emp.teams.length) ? mineFixed : fixedTeams;
  if (Object.keys(monthClusters(monthKey(TODAY))).length) for (const t of rotTeams) {
    const blks = [0, 1, 2, 3, 4, 5].filter((b) => t.needs[b] && !isNight(b));
    if (!blks.length) continue;
    const rots = blks.map((b) => rotation(t, b, TODAY));
    h += `<section class="card" style="margin-top:18px"><div class="sec-title"><h2>${esc(t.shortName)} rotation · today</h2><span class="muted" style="font-size:13px">One hour with each cluster, then move on</span></div><div class="tw"><table class="grid ${teamClass(t)}"><thead><tr><th></th>${blks.map((b) => `<th>${BLOCKS[b].label}</th>`).join("")}</tr></thead><tbody>`;
    for (let i = 0; i < 4; i++) h += `<tr><th>Hour ${i + 1}</th>${rots.map((r) => `<td><span class="muted tiny">${hShort(r[i].hour)}–${hShort(r[i].hour + 1)}</span><b>${r[i].cluster ? "Cluster " + r[i].cluster : "Open"}</b><small>${esc(r[i].activity)}</small></td>`).join("")}</tr>`;
    h += `</tbody></table></div><p class="muted" style="font-size:12px;margin:8px 0 0">Clusters out on an outing are skipped. The order changes each day so every cluster gets a turn.</p></section>`;
  }
  return h;
}
function outingClusters(month, hrView) {
  const t = activeTeams().find((x) => x.staffing === "cluster"), cm = monthClusters(month), nos = Object.keys(cm).map(Number).sort((a, b) => a - b);
  if (!t && !hrView) return "";
  const today = monthKey(TODAY) === month ? TODAY : month + "-01";
  let h = `<section style="margin-top:18px"><div class="sec-title"><h2>Resident clusters · ${monthName(month)}</h2><span class="muted" style="font-size:13px">${nos.length ? `${plural(nos.length, "cluster")} of 8 or fewer · the same groups every month` : ""}</span></div>`;
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
  const row = (lvl) => { const xs = ppl.filter((e) => e.level === lvl); return `<div class="rosterrow"><span class="eyebrow">${lvl}</span><span>${xs.length ? someNames(xs, 4) : '<span class="muted">Open</span>'}</span></div>`; };
  return `<div class="roster">${row("Lead DSP")}${row("DSP II")}${row("DSP I")}</div>`;
}

/* ---------- QUIZ ---------- */
const QUIZ = [
  { q: "Pick your ideal afternoon at work.", a: [["Cooking a great meal and getting a home in order", "house"], ["Gardening, shooting hoops or doing crafts outside", "campus"], ["A trip to the mall or the bowling alley", "outings"], ["Reading together or a music session", "learning"]] },
  { q: "You feel your best when you're…", a: [["Keeping a steady routine and taking care of a home", "house"], ["Up and moving, active all day", "campus"], ["Out in the community, meeting people", "outings"], ["Teaching and helping someone learn something new", "learning"]] },
  { q: "Do you have a valid driver's license? Every off-campus outing cluster needs a DSP who can drive.", a: [["Yes, and I'm happy to drive residents", "outings"], ["Yes, but I'd rather not drive", "house,campus,learning"], ["No, I don't have a license", "house,campus,learning"]] },
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
  const noLicense = Q.answers[2] === 2;   // can't drive: off-campus teams are out
  const ranked = activeTeams().filter((t) => sc[t.key] != null || ["house", "campus", "outings", "learning"].includes(t.key))
    .map((t) => ({ t, v: noLicense && t.needsLicense ? 0 : sc[t.key] || 0, off: noLicense && t.needsLicense })).sort((a, b) => b.v - a.v);
  const top = ranked[0], second = ranked[1];
  return `<div class="card quiz"><span class="eyebrow">Your match</span><div class="qprog"><span style="width:100%"></span></div>
    <h2>You'd thrive on ${esc(top.t.name)}</h2><p class="muted" style="margin:0">${esc(top.t.description)}</p>
    <div class="scores">${ranked.map((r) => `<div class="score ${teamClass(r.t)}"><span>${esc(r.t.shortName)}</span><span class="b"><span style="width:${(r.v / max) * 100}%"></span></span><span class="mono" style="font-size:12px">${r.off ? "needs license" : Math.round((r.v / QUIZ.length) * 100) + "%"}</span></div>`).join("")}</div>
    ${noLicense ? `<p class="notice">Community Outings take clusters off campus, so they need a driver's license. Once you have one, tick <b>I have a driver's license</b> in My profile (tap your name) and join from the Team tab.</p>` : ""}
    <div class="rowact" style="justify-content:flex-start">${emp ? `<button class="btn lg" data-act="quizjoin" data-teams="${top.t.id}">Join ${esc(top.t.shortName)}</button>${second && second.v > 0 ? `<button class="btn ghost lg" data-act="quizjoin" data-teams="${top.t.id},${second.t.id}">Join ${esc(top.t.shortName)} + ${esc(second.t.shortName)}</button>` : ""}` : ""}<button class="linkbtn" data-act="qreset">Retake</button></div>
    <p class="muted" style="font-size:12.5px;margin:12px 0 0">You can change teams anytime on the Team tab. HR may adjust teams to keep every home covered.</p></div>`;
}

/* ---------- HR ---------- */
function viewHR() {
  const subs = [["coverage", "Coverage"], ["temps", "Temps needed"], ["people", "Employees"], ["residents", "Residents & clusters"], ["teams", "Teams & staffing"], ["homes", "Homes"], ["settings", "Settings"]];
  const body = { coverage: hrCoverage, temps: hrTemps, people: hrPeople, residents: hrResidents, teams: hrTeams, homes: hrHomes, settings: hrSettings }[S.hrSub]();
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
  const sm = activeSignupMonth(), sw = signupWindow(sm);
  let h = hrToday(ws, pub) + `<div class="sec-title" style="margin-top:22px"><h2>Coverage</h2>${hrWeekNav()}</div>
    <p class="muted" style="margin:-4px 0 12px;font-size:13.5px">${pub ? `<span class="badge good">Published</span> Week of ${fmt(ws, { month: "short", day: "numeric" })} is final. <button class="linkbtn" data-act="unpublish" data-w="${ws}">Reopen week</button>` : `<span class="badge">Not published</span> Week of ${fmt(ws, { month: "short", day: "numeric" })}.`} · ${monthName(sm)} sign-up ${TODAY > sw.close ? "has closed" : "closes " + short(sw.close)}.</p><div class="cards">
    <div class="card kpi"><div class="v">${need ? Math.round((have / need) * 100) : 0}%</div><div class="k">of needed shifts filled (${have}/${need})</div></div>
    <div class="card kpi${need - have ? " warn" : ""}"><div class="v">${need - have}</div><div class="k">open DSP slots this week${waiting ? ` · ${waiting} on waitlists` : ""}</div></div>
    <div class="card kpi${under ? " warn" : ""}"><div class="v">${under}</div><div class="k">DSPs under their weekly target</div></div>
    <div class="card kpi${noLead ? " warn" : ""}"><div class="v">${noLead}</div><div class="k">team shifts without a Lead DSP${over ? ` · ${over} DSPs over target` : ""}</div></div></div>`;
  // staffing mix: who is filling this week's spots
  let tm = 0; for (const d of days) for (const t of teams) for (let b = 0; b < 6; b++) for (const u of units(t, d, b)) tm += Math.min(tempN(u), u.need);
  const own = have - tm, open = need - have, pc = (n) => (need ? Math.round((n / need) * 1000) / 10 : 0);
  h += `<div class="card mix"><div class="sec-title" style="margin-bottom:8px"><h3>Who's covering this week</h3><span class="muted" style="font-size:13px">${need} DSP spots</span></div>
    <div class="mixbar" role="img" aria-label="${pc(own)}% Magnolia DSPs, ${pc(tm)}% temps, ${pc(open)}% open">${own ? `<span class="own" style="flex:${own}" title="Magnolia DSPs: ${own} spots (${pc(own)}%)"></span>` : ""}${tm ? `<span class="tmp" style="flex:${tm}" title="Temps: ${tm} spots (${pc(tm)}%)"></span>` : ""}${open ? `<span class="opn" style="flex:${open}" title="Open: ${open} spots (${pc(open)}%)"></span>` : ""}</div>
    <div class="mixkey"><span><i class="own"></i>Magnolia DSPs <b>${pc(own)}%</b> · ${own * 4} hrs</span><span><i class="tmp"></i>Temps <b>${pc(tm)}%</b> · ${tm * 4} hrs</span><span><i class="opn"></i>Still open <b>${pc(open)}%</b> · ${open * 4} hrs</span></div></div>`;
  // one cell per day and block: green when full, orange shades when short; tap for the team breakdown
  h += `<div class="card tw"><table class="covgrid simple"><thead><tr><th>Block</th>${days.map((d) => `<th>${fmt(d, { weekday: "short", month: "numeric", day: "numeric" })}</th>`).join("")}</tr></thead><tbody>`;
  for (let b = 0; b < 6; b++) {
    const tb = teams.filter((t) => t.needs[b]); if (!tb.length) continue;
    h += `<tr><th>${BLOCKS[b].label}</th>${days.map((d) => { let n = 0, hv = 0; for (const t of tb) { const x = cell[`${d}|${b}|${t.id}`]; n += x.need; hv += x.have; }
      const gap = n - hv, k = `${d}|${b}`;
      return `<td><button class="cv${gap ? (gap / n > 0.15 ? " bad" : " short") : " ok"}" data-act="covsel" data-k="${k}" aria-pressed="${S.covSel === k}" title="${hv} of ${n} filled">${gap ? `${gap} open` : "Full"}</button></td>`; }).join("")}</tr>`;
  }
  h += `</tbody></table><div class="progress-key" style="margin-top:8px"><span class="cvkey ok">Full</span><span class="cvkey short">A few open</span><span class="cvkey bad">Short</span><span>Tap a block for the breakdown</span></div>`;
  if (S.covSel && days.includes(S.covSel.split("|")[0])) {
    const [d, b] = S.covSel.split("|"), tb = teams.filter((t) => t.needs[+b]);
    h += `<div class="covdetail"><div class="sec-title" style="margin:0 0 8px"><h3>${short(d)} · ${BLOCKS[+b].label}</h3><button class="btn quiet sm" data-act="tempday2" data-date="${d}">Open in Schedule</button></div>
      <div class="covrows">${tb.map((t) => { const x = cell[`${d}|${b}|${t.id}`]; return `<div class="${teamClass(t)}"><span class="dot tbg"></span><b>${esc(t.shortName)}</b><span class="mono${x.have < x.need ? " warnc" : ""}">${x.have}/${x.need}</span><span class="muted tiny">${x.have < x.need ? `${x.need - x.have} open` : "full"}</span></div>`; }).join("")}</div></div>`;
  }
  h += `</div>`;
  const off = (S.timeOff || []).filter((x) => x.day >= ws && x.day <= addDays(ws, 6)).sort((a, b) => (a.day < b.day ? -1 : 1));
  if (off.length) h += `<p class="muted" style="font-size:13.5px;margin:12px 0 0"><b>Time off this week:</b> ${off.slice(0, 8).map((x) => { const e = empById(x.employeeId); return `${short(x.day)} ${esc(e ? e.name : "?")}${x.note ? ` (${esc(x.note)})` : ""}`; }).join(" · ")}${off.length > 8 ? ` + ${off.length - 8} more` : ""}</p>`;
  h += `<div class="rowact"><button class="btn ghost" data-act="csv">Download this week (CSV)</button><button class="btn quiet" data-act="print">Print</button></div>`;
  return h;
}
function hrTemps() {
  const ws = S.tempFrom, days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ws, i));   // rolling 7 days, starting today by default
  const nav = `<div class="weeknav"><button data-act="tempnav" data-d="-7" aria-label="Previous 7 days">‹</button><b style="min-width:9em;text-align:center">${fmt(ws, { month: "short", day: "numeric" })} – ${fmt(addDays(ws, 6), { month: "short", day: "numeric" })}</b><button data-act="tempnav" data-d="7" aria-label="Next 7 days">›</button><button class="linkbtn" data-act="tempnav" data-d="0">From today</button></div>`;
  const all = openSpots(ws, addDays(ws, 6)), soon = openSoon(), nSoon = sumOpen(soon), nAll = sumOpen(all);
  const booked = (S.temps || []).filter((x) => x.date >= ws && x.date <= addDays(ws, 6));
  const by = {}; for (const x of all) by[`${x.date}|${x.block}`] = (by[`${x.date}|${x.block}`] || 0) + x.open;
  const dayTot = (d) => sumOpen(all.filter((x) => x.date === d));
  const sel = days.includes(S.tempDay) ? S.tempDay : days.find((d) => dayTot(d)) || days[0];
  const max = Math.max(1, ...Object.values(by));
  let h = `<div class="sec-title"><h2>Temps needed</h2>${nav}</div>
    <p class="muted" style="margin:-4px 0 14px;font-size:13.5px">Every spot a DSP hasn't taken. Inside 3 days DSPs can't cancel, so those numbers are firm. When the agency confirms a temp, tap the house or cluster to mark it <b>booked</b>: the spot stops counting as open and the temp hours are logged. HR also gets this list as an email and phone alert every morning.</p>
    <div class="cards">
    <div class="card kpi${nSoon ? " warn" : ""}"><div class="v">${nSoon}</div><div class="k">temp shifts needed in the next 3 days (${nSoon * 4} hrs)</div></div>
    <div class="card kpi"><div class="v">${nAll}</div><div class="k">open spots in these 7 days (${nAll * 4} hrs) · later days may still fill</div></div>
    <div class="card kpi"><div class="v">${new Set(soon.filter((x) => x.homeId != null).map((x) => x.homeId)).size}</div><div class="k">houses short in the next 3 days</div></div>
    <div class="card kpi good"><div class="v">${booked.reduce((a, x) => a + x.count, 0)}</div><div class="k">temp shifts booked in these 7 days (${booked.reduce((a, x) => a + x.count, 0) * 4} hrs)</div></div></div>`;
  h += `<div class="card tw"><table class="covgrid temps"><thead><tr><th>Block</th>${days.map((d) => `<th><button class="daybtn" data-act="tempday" data-date="${d}" aria-pressed="${d === sel}">${fmt(d, { weekday: "short", month: "numeric", day: "numeric" })}</button></th>`).join("")}</tr></thead><tbody>`;
  for (let b = 0; b < 6; b++) h += `<tr><th>${BLOCKS[b].label}</th>${days.map((d) => { const n = by[`${d}|${b}`] || 0, gone = shiftStart(d, b).getTime() <= Date.now();
    return `<td class="${d === sel ? "selcol" : ""}">${gone ? `<span class="muted">–</span>` : n ? `<button class="tneed" data-act="tempday" data-date="${d}" style="--heat:${Math.round((n / max) * 100)}%" title="${n} open">${n}</button>` : `<span class="ok">✓</span>`}</td>`; }).join("")}</tr>`;
  h += `<tr class="tot"><th>Day total</th>${days.map((d) => `<td class="${d === sel ? "selcol" : ""}"><b>${dayTot(d) || (d < TODAY ? "–" : 0)}</b></td>`).join("")}</tr></tbody></table>
    <p class="muted" style="font-size:12.5px;margin:8px 0 0">Number = DSPs still needed in that block across all houses, clusters and teams. Tap a day for the breakdown.</p></div>`;
  const list = all.filter((x) => x.date === sel);
  h += `<section style="margin-top:18px"><div class="sec-title"><h2>${long(sel)}</h2><span class="muted" style="font-size:13.5px">${plural(sumOpen(list), "temp shift")} needed</span></div>`;
  if (!list.length) h += `<div class="card empty" style="padding:18px">${sel < TODAY ? "This day has passed." : "Fully staffed. No temps needed."}</div>`;
  else {
    h += `<div class="tw"><table class="data"><thead><tr><th>Block</th><th>Team</th><th>Needed</th><th>Where (× how many) · tap to book a temp</th><th></th></tr></thead><tbody>`;
    for (let b = 0; b < 6; b++) for (const t of activeTeams()) {
      const xs = list.filter((x) => x.block === b && x.teamId === t.id); if (!xs.length) continue;
      const firm = shiftStart(sel, b) - Date.now() <= DROP_HOURS * 36e5;
      h += `<tr><td style="white-space:nowrap">${BLOCKS[b].label}${firm ? ` <span class="badge warn">firm</span>` : ""}</td><td><span class="chip ${teamClass(t)}"><span class="dot tbg"></span>${esc(t.shortName)}</span></td><td><b>${sumOpen(xs)}</b></td>
        <td><div class="places">${xs.map((x) => `<button data-act="booktemp" data-date="${x.date}" data-block="${x.block}" data-team="${t.id}" data-home="${x.homeId ?? ""}" data-cl="${x.clusterNo ?? ""}" title="Mark one temp booked here">${esc(x.label || "Whole team")} <b>×${x.open}</b></button>`).join("")}</div></td>
        <td style="text-align:right"><button class="btn quiet sm" data-act="bookrow" data-date="${sel}" data-block="${b}" data-team="${t.id}">Book all ${sumOpen(xs)}</button></td></tr>`;
    }
    h += `</tbody></table></div>`;
  }
  const mine = booked.filter((x) => x.date === sel).sort((a, b) => a.block - b.block || a.teamId - b.teamId || (a.homeId ?? a.clusterNo ?? 0) - (b.homeId ?? b.clusterNo ?? 0));
  if (mine.length) {
    h += `<div class="sec-title" style="margin-top:18px"><h3 style="font-size:19px">Temps booked</h3><span class="muted" style="font-size:13.5px">${plural(mine.reduce((a, x) => a + x.count, 0), "temp shift")} · ${mine.reduce((a, x) => a + x.count, 0) * 4} hrs</span></div>
      <div class="tw"><table class="data"><thead><tr><th>Block</th><th>Team</th><th>Where</th><th>Temps</th><th></th></tr></thead><tbody>${mine.map((x) => { const t = teamById(x.teamId), d = `data-date="${x.date}" data-block="${x.block}" data-team="${x.teamId}" data-home="${x.homeId ?? ""}" data-cl="${x.clusterNo ?? ""}"`;
        return `<tr><td style="white-space:nowrap">${BLOCKS[x.block].label}</td><td><span class="chip ${teamClass(t)}"><span class="dot tbg"></span>${esc(t ? t.shortName : "")}</span></td><td>${esc(placeOf(x) || "Whole team")}</td><td><b>${x.count}</b></td>
          <td style="text-align:right;white-space:nowrap">${x.count > 1 ? `<button class="linkbtn" data-act="untemp" ${d} data-n="-1">Remove one</button>` : ""}<button class="linkbtn" data-act="untemp" ${d} data-n="0">Cancel${x.count > 1 ? " all" : ""}</button></td></tr>`; }).join("")}</tbody></table></div>`;
  }
  return h + `<div class="rowact"><button class="btn" data-act="tempcsv">Download temp request (CSV)</button>${booked.length ? `<button class="btn ghost" data-act="bookedcsv">Download temps booked (CSV)</button>` : ""}<button class="btn ghost" data-act="tempday2" data-date="${sel}">Open this day in Schedule</button><button class="btn quiet" data-act="print">Print</button></div></section>` + tempTrend();
}
/* the HR to-do row: swaps to approve, call-outs, time off, 6-month milestones */
/* DSP Is who passed 6 months in the last ~2 months (older ones HR has already looked at) */
const promoReady = () => S.employees.filter((e) => { const d = e.hireDate && (parse(TODAY) - parse(e.hireDate)) / 864e5; return e.active !== false && e.level === "DSP I" && d >= 182 && d <= 240; });
/* HR's front page: what needs doing today, one button each */
function hrToday(ws, pub) {
  const approve = (S.offers || []).filter((o) => o.status === "claimed" && signupById(o.signupId) && startsAt(signupById(o.signupId)).getTime() > Date.now());
  const calls = (S.callouts || []).filter((c) => c.date >= TODAY && !c.filledBy);
  const nSoon = sumOpen(openSoon()), ready = promoReady(), sw = signupWindow(activeSignupMonth());
  const noLogin = S.employees.filter((e) => e.active !== false && !e.userId && e.email).length;
  const rows = [];
  const row = (tone, title, sub, btn, extra = "") => rows.push(`<li class="${tone}"><div><b>${title}</b>${sub ? `<span class="muted">${sub}</span>` : ""}</div>${btn}${extra}</li>`);
  if (nSoon) row("hot", `${plural(nSoon, "spot")} need temps in the next 3 days`, "DSPs can't cancel these any more.", `<button class="btn sm" data-act="gotemps">Book temps</button>`);
  if (calls.length) row("hot", `${plural(calls.length, "call-out")} need${calls.length === 1 ? "s" : ""} cover`, calls.slice(0, 2).map((c) => { const e = empById(c.employeeId); return `${esc(e ? e.name.split(" ")[0] : "A DSP")}: ${esc(slotText(c))}`; }).join(" · "), `<button class="btn sm" data-act="tempday2" data-date="${calls[0].date}">Find cover</button>`);
  if (approve.length) row("", `${plural(approve.length, "swap")} to approve`, "", "", `<div class="todo-sub">${swapRows(approve, (o) => `<button class="btn sm" data-act="approve" data-id="${o.id}">Approve</button><button class="linkbtn" data-act="decline" data-id="${o.id}">Decline</button>`)}</div>`);
  if (!pub && addDays(ws, 6) >= TODAY) row("", `Publish the week of ${fmt(ws, { month: "short", day: "numeric" })}`, "Locks new picks and emails every DSP their final schedule.", `<button class="btn sm" data-act="publish" data-w="${ws}">Publish &amp; email</button>`);
  if (TODAY <= sw.close && (parse(sw.close) - parse(TODAY)) / 864e5 <= 7) row("", `${monthName(activeSignupMonth())} sign-up closes ${short(sw.close)}`, "After that, HR fills the gaps.", `<button class="btn quiet sm" data-act="hrsub" data-sub="temps">See open spots</button>`);
  if (ready.length) row("", `${plural(ready.length, "DSP I")} ready for DSP II`, "Past 6 months on the job.", `<button class="btn quiet sm" data-act="peoplef" data-f="promo">Review</button>`);
  if (noLogin) row("", `${plural(noLogin, "employee")} haven't logged in yet`, "Send them a sign-in invite.", `<button class="btn quiet sm" data-act="peoplef" data-f="nologin">Invite</button>`);
  return `<section class="card todo"><div class="sec-title" style="margin-bottom:6px"><h2>Today</h2><span class="muted" style="font-size:13px">${long(TODAY)}</span></div>
    ${rows.length ? `<ul>${rows.join("")}</ul>` : `<p class="muted" style="margin:0">All caught up. Nothing needs you right now.</p>`}</section>`;
}
/* temp hours by month: one series, so one color; values are labelled and listed in the table beside it */
function tempTrend() {
  if (S.tempHist === null) { S.tempHist = false; B.tempHistory().then((r) => { S.tempHist = r; render(); }).catch(() => { S.tempHist = []; }); }
  if (!S.tempHist) return `<section class="card" style="margin-top:22px"><p class="muted" style="margin:0">Loading temp history…</p></section>`;
  const months = []; for (let i = 5; i >= 0; i--) months.push(addMonth(monthKey(TODAY), -i));
  const tot = months.map((m) => S.tempHist.filter((x) => x.month === m).reduce((a, x) => a + x.hours, 0)), max = Math.max(1, ...tot);
  const first = tot.findIndex((v) => v > 0), lastFull = tot[4], base = first >= 0 && first < 4 ? tot[first] : 0;
  const change = base ? Math.round(((lastFull - base) / base) * 100) : null;
  const byHome = {}; for (const x of S.tempHist) if (months.slice(3).includes(x.month) && x.homeId != null) byHome[x.homeId] = (byHome[x.homeId] || 0) + x.hours;
  const top = Object.entries(byHome).sort((a, b) => b[1] - a[1]).slice(0, 5), topMax = top.length ? top[0][1] : 1;
  const mLabel = (m) => parse(m + "-01").toLocaleDateString("en-US", { month: "short" });
  return `<section class="card trend" style="margin-top:22px"><div class="sec-title"><h2>Temp hours by month</h2><span class="muted" style="font-size:13.5px">Hours covered by agency temps · last 6 months</span></div>
    ${!tot.some(Boolean) ? `<p class="muted" style="margin:0">No temps booked yet. Once HR marks temps as booked, the monthly trend builds here.</p>` : `<div class="trendgrid"><div>
      ${change !== null ? `<p class="headline">Temp hours <b class="${change <= 0 ? "down" : "up"}">${change <= 0 ? "down" : "up"} ${Math.abs(change)}%</b> since ${mLabel(months[first])}</p>` : ""}
      <div class="bars" role="img" aria-label="Temp hours by month: ${months.map((m, i) => `${mLabel(m)} ${tot[i]}`).join(", ")}">${months.map((m, i) => `<div class="bcol${i === 5 ? " partial" : ""}" title="${monthName(m)}: ${tot[i]} temp hours${i === 5 ? " so far" : ""}"><span class="bv">${tot[i]}</span><span class="bar" style="height:${Math.max((tot[i] / max) * 100, tot[i] ? 2 : 0)}%"></span><span class="bl">${mLabel(m)}${i === 5 ? "*" : ""}</span></div>`).join("")}</div>
      <p class="muted note">* this month so far. Every hour here is one a Magnolia DSP didn't cover.</p></div>
      <div><span class="eyebrow">Houses using the most temps · last 3 months</span><table class="mini"><tbody>${top.map(([id, hrs]) => { const hm = homeById(+id); return `<tr><th>${esc(hm ? hm.name : "Home")}</th><td><span class="hbar" style="width:${(hrs / topMax) * 100}%"></span></td><td class="mono">${hrs} hrs</td></tr>`; }).join("")}</tbody></table></div></div>`}</section>`;
}
/* employees after the search box and the quick filter */
function peopleList() {
  const ws = weekStart(S.hrWeekRef), q = S.peopleQ.toLowerCase(), f = S.peopleF || "", ready = new Set(promoReady().map((e) => e.id));
  const pass = (e) => !f ? true : f === "under" ? e.active !== false && weekHours(e.id, ws) < (e.weeklyTarget || 0) : f === "nologin" ? e.active !== false && !e.userId : f === "promo" ? ready.has(e.id) : f.startsWith("team:") ? e.teams.includes(+f.slice(5)) : true;
  return S.employees.filter((e) => (!q || (e.name + " " + e.email + " " + e.level).toLowerCase().includes(q)) && pass(e)).sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active === false ? 1 : -1));
}
function hrPeople() {
  const ws = weekStart(S.hrWeekRef), list = peopleList(), f = S.peopleF || "";
  const chip = (id, label) => `<button class="fchip" data-act="peoplef" data-f="${id}" aria-pressed="${f === id}">${label}</button>`;
  let h = `<div class="sec-title"><h2>Employees</h2>${hrWeekNav()}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><input id="peopleq" placeholder="Search name, email or level" value="${esc(S.peopleQ)}" style="flex:1;min-width:200px"><button class="btn" data-act="addemp">Add employee</button></div>
    <div class="fchips">${chip("under", "Under hours")}${chip("nologin", "No login")}${chip("promo", "Ready for DSP II")}${activeTeams().map((t) => chip("team:" + t.id, esc(t.shortName))).join("")}
      <span class="muted tiny" style="margin-left:auto">${list.length} ${list.length === 1 ? "person" : "people"}</span></div>
    ${f === "nologin" && list.some((e) => e.email) ? `<p class="notice info" style="margin:0 0 12px"><span>Opens your email with everyone below in BCC and a short note on how to sign in.</span> <button class="btn sm" data-act="invite">Email sign-in invite to ${list.filter((e) => e.email).length}</button></p>` : ""}`;
  if (S.editEmp) h += empForm(S.editEmp);
  h += `<div class="tw"><table class="data"><thead><tr><th>Name</th><th>Level</th><th>Teams</th><th>Hours this week</th><th>Login</th><th></th></tr></thead><tbody>`;
  for (const e of list) {
    const hrs = weekHours(e.id, ws), tgt = e.weeklyTarget || 0, admin = S.admins && e.userId && S.admins.includes(e.userId);
    h += `<tr${e.active === false ? ' style="opacity:.5"' : ""}><td><b>${esc(e.name || "Unnamed")}</b>${e.demo ? ' <span class="badge">demo</span>' : ""}${admin ? ' <span class="badge good">HR</span>' : ""}<br><span class="muted" style="font-size:12px">${esc(e.email)}${e.hasLicense ? " · license" : ""}${e.hasCna ? " · CNA" : ""}</span></td>
      <td>${esc(e.level)}</td><td>${e.teams.map((id) => { const t = teamById(id); return t ? `<span class="chip ${teamClass(t)}" style="margin:1px"><span class="dot tbg"></span>${esc(t.shortName)}</span>` : ""; }).join("") || '<span class="muted">none</span>'}</td>
      <td style="white-space:nowrap"><span class="minibar${hrs < tgt ? " low" : ""}"><span style="width:${Math.min(100, tgt ? (hrs / tgt) * 100 : 100)}%"></span></span><span class="mono">${hrsTxt(hrs)}/${tgt}</span></td>
      <td>${e.userId ? "Yes" : '<span class="muted">No</span>'}</td>
      <td style="text-align:right;white-space:nowrap">${f === "promo" ? `<button class="btn sm" data-act="promote" data-id="${esc(e.id)}" data-name="${esc(e.name)}">Promote</button> ` : ""}<button class="btn quiet sm" data-act="editemp" data-id="${esc(e.id)}">Edit</button>${e.userId && S.me && e.userId !== S.me.userId ? ` <button class="linkbtn" data-act="admin" data-user="${esc(e.userId)}" data-on="${admin ? 0 : 1}" data-name="${esc(e.name)}">${admin ? "Remove HR" : "Make HR"}</button>` : ""}</td></tr>`;
  }
  if (!list.length) h += `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">Nobody matches.</td></tr>`;
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
  let h = `<div class="sec-title"><h2>Residents & clusters</h2><div class="weeknav"><button data-act="resmonth" data-d="-1" aria-label="Previous month">‹</button><b style="min-width:8em;text-align:center">${monthName(S.resMonth)}</b><button data-act="resmonth" data-d="1" aria-label="Next month">›</button></div></div>
    <p class="muted" style="margin:-4px 0 14px;font-size:13.5px">Store first names only, never diagnoses. Residents are grouped into clusters of 8 or fewer, spreading out people who need their own DSP. Clusters stay the same from month to month; new residents join the smallest cluster. Each outing gets 2 DSPs plus 1 for every resident who needs their own.</p>
    <div class="cards"><div class="card kpi"><div class="v">${act}</div><div class="k">active residents</div></div><div class="card kpi"><div class="v">${ones}</div><div class="k">need their own DSP on outings</div></div><div class="card kpi"><div class="v">${Object.keys(monthClusters(S.resMonth)).length}</div><div class="k">clusters in ${monthName(S.resMonth).split(" ")[0]}</div></div></div>`;
  h += `<div class="rowact" style="justify-content:flex-start;margin:0 0 6px"><button class="btn" data-act="clustersync" data-m="${S.resMonth}">Add new residents to clusters</button><button class="btn quiet" data-act="reshuffle" data-m="${S.resMonth}">Reshuffle clusters from ${monthName(S.resMonth).split(" ")[0]}</button></div>`;
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
    if (t.id && S.editTeam !== t.id) {
      const n = S.employees.filter((e) => e.active !== false && e.teams.includes(t.id)).length;
      h += `<section class="card teamsum ${teamClass(t)}"><div><h3>${esc(t.name)}</h3><span class="muted tiny">${STAFFING[t.staffing || "fixed"]} · ${n} DSPs${t.needsLicense ? " · license required" : ""}</span></div>
        <div class="blocksmini">${BLOCKS.map((b, i) => `<span class="${t.needs[i] ? "on" : ""}" title="${b.label}">${hShort(b.start)}${t.needs[i] ? ` ×${t.needs[i]}` : ""}</span>`).join("")}</div>
        <button class="btn quiet sm" data-act="editteam" data-team="${t.id}">Edit</button></section>`;
      continue;
    }
    const per = t.staffing === "home" ? ` (per house × ${S.homes.length})` : t.staffing === "cluster" ? " (per cluster, + 1:1s)" : "";
    h += `<form class="card form ${teamClass(t)}" data-form="team" style="border-top:5px solid var(--tc)"><input type="hidden" name="id" value="${t.id || ""}">
      <label>Team name<input name="name" value="${esc(t.name)}" required maxlength="60"></label><label>Short name<input name="short" value="${esc(t.shortName)}" maxlength="24"></label>
      <label>Color<select name="color">${[0, 1, 2, 3, 4, 5, 6, 7].map((c) => `<option value="${c}"${c === t.color ? " selected" : ""}>Color ${c + 1}</option>`).join("")}</select></label>
      <label>How it's staffed<select name="staffing">${Object.entries(STAFFING).map(([k, l]) => `<option value="${k}"${k === (t.staffing || "fixed") ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="wide">Description<input name="desc" value="${esc(t.description)}" maxlength="400"></label>
      <label class="wide">Activities (comma separated)<input name="acts" value="${esc(t.activities.join(", "))}"></label>
      <div class="wide"><span class="eyebrow">Needed per block${per}</span><div class="needs">${BLOCKS.map((b, i) => `<label>${b.label}<input name="need${i}" type="number" min="0" max="50" value="${t.needs[i] || 0}"></label>`).join("")}</div></div>
      <div class="wide checks"><label><input type="checkbox" name="license" ${t.needsLicense ? "checked" : ""}> Driver's license required</label>${t.id ? `<label><input type="checkbox" name="active" checked> Active</label>` : ""}</div>
      <div class="wide rowact" style="margin:0"><button type="button" class="btn quiet" data-act="cancelteam">Cancel</button><button class="btn">Save team</button></div></form>`;
  }
  return h + `</div>`;
}
function hrHomes() {
  let h = `<div class="sec-title"><h2>Homes</h2><button class="btn" data-act="addhome">Add home</button></div><div class="tw"><table class="data"><thead><tr><th>Name</th><th>Location</th><th>Residents</th><th></th></tr></thead><tbody>`;
  for (const x of sortedHomes()) {
    h += `<tr><td><input data-home="${x.id}" data-f="name" value="${esc(x.name)}" maxlength="60"></td>
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
      <p style="margin:6px 0 10px;font-size:15px">${key ? `<span class="badge good">Alert keys created</span> DSPs can turn on alerts from My profile (tap their name, top right).` : "One-time setup so the app can send shift alerts to DSPs' phones."}</p>
      ${S.newPriv ? `<div class="secretbox"><b>Copy this private key now. It's shown only once.</b><textarea readonly rows="2" id="privkey">${esc(S.newPriv)}</textarea>
        <div class="rowact" style="justify-content:flex-start;margin:6px 0"><button class="btn sm" data-act="copypriv">Copy</button></div>
        <ol class="steps"><li>Vercel → your project → <b>Settings → Environment Variables</b> → add <b>VAPID_PRIVATE_KEY</b> and paste it.</li><li><b>Deployments → ⋯ → Redeploy</b>.</li><li>In Supabase → SQL editor, run <b>supabase/alerts-cron.sql</b> once (the 10-minute timer).</li></ol>
        <button class="linkbtn" data-act="privdone">I've saved it</button></div>`
        : `<button class="btn ${key ? "quiet" : ""}" data-act="vapid">${key ? "Replace alert keys" : "Create alert keys"}</button>${key ? `<p class="muted note">Replacing keys means everyone has to turn alerts on again.</p>` : ""}`}</section>
    <section class="card"><span class="eyebrow">Unfilled shift alerts</span><p style="margin:6px 0 0;font-size:15px">Every morning at 7 AM, everyone with HR access gets an email (and a phone alert, if they turned alerts on) listing the spots still open in the next 3 days, by house and cluster. The live numbers are always under <button class="linkbtn" data-act="hrsub" data-sub="temps">Temps needed</button>.</p></section>
    <section class="card"><span class="eyebrow">Sign-up calendar · ${monthName(activeSignupMonth())}</span><p style="margin:6px 0 10px;font-size:15px">Each month's schedule opens in the month before by rank: Lead DSPs the 2nd week, DSP IIs a week later, DSP Is a week after that. Sign-up closes the Sunday before the last week, so HR has that week to fill gaps. HR can assign anyone at any time.</p>${windowTimeline(activeSignupMonth(), null)}</section>
    <section class="card"><span class="eyebrow">Publishing</span><p style="margin:6px 0 0;font-size:15px">Publish each week from <button class="linkbtn" data-act="hrsub" data-sub="coverage">Coverage</button>. DSPs can cancel only 3 or more days ahead, and only when someone is on the waitlist. Publishing locks new picks and emails every DSP their final schedule.</p></section>
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
function celebrate() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div"); box.className = "confetti"; box.setAttribute("aria-hidden", "true");
  const colors = ["#29572D", "#497A39", "#DEA710", "#F3EDD6", "#7A5230"];
  for (let i = 0; i < 70; i++) { const p = document.createElement("i"); p.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % 5]};animation-delay:${Math.random() * 0.5}s;animation-duration:${1.6 + Math.random() * 1.4}s;transform:rotate(${Math.random() * 360}deg)`; box.appendChild(p); }
  document.body.appendChild(box); setTimeout(() => box.remove(), 3600);
}
/* run a booking, then celebrate if it carried me over my weekly target */
async function bookAndCheer(date, fn, msg) {
  const emp = myEmp(), ws = weekStart(date), before = emp ? weekHours(emp.id, ws) : 0;
  await act(fn, msg);
  const after = emp ? weekHours(emp.id, ws) : 0, tgt = emp ? emp.weeklyTarget || 40 : 0;
  if (emp && before < tgt && after >= tgt) { celebrate(); toast(`That's your ${tgt} hours for the week. Nice work, ${emp.name.split(" ")[0]}!`); }
}
async function takeShift(slot, two, employeeId) {
  const t = teamById(slot.teamId), place = placeOf(slot);
  await (employeeId ? act : (fn, msg) => bookAndCheer(slot.date, fn, msg))(async () => { await B.take(slot, employeeId); if (two) await B.take({ ...slot, block: slot.block + 1 }, employeeId); },
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
  covsel: (d) => { S.covSel = S.covSel === d.k ? "" : d.k; render(); },
  peoplef: (d) => { S.peopleF = S.peopleF === d.f ? "" : d.f; S.tab = "hr"; S.hrSub = "people"; S.editEmp = null; syncHash(); render(); },
  invite: () => {
    const xs = peopleList().filter((e) => e.email && !e.userId);
    if (!xs.length) return toast("Everyone in this list already has a login.");
    const body = `Hi! Magnolia's shift schedule is online. Go to ${location.origin}, tap Sign in, and enter this email address. You'll get a link to log in, then you can pick your shifts and turn on phone alerts.`;
    location.href = `mailto:?bcc=${encodeURIComponent(xs.map((e) => e.email).join(","))}&subject=${encodeURIComponent("Your Magnolia schedule login")}&body=${encodeURIComponent(body)}`;
  },
  hrweek: (d) => { S.hrWeekRef = +d.d ? addDays(S.hrWeekRef, +d.d) : TODAY; refresh(); },
  resmonth: (d) => { S.resMonth = addMonth(S.resMonth, +d.d); refresh(); },
  month: (d) => { let m = S.m + +d.d, y = S.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } S.y = y; S.m = m; const f = `${y}-${pad(m + 1)}-01`; S.sel = monthKey(TODAY) === monthKey(f) ? TODAY : f; refresh(); },
  allblocks: () => { S.allBlocks = !S.allBlocks; render(); },
  day: (d) => { S.sel = d.date; S.open = ""; if (S.preview && weekStart(d.date) !== S.preview.ws) S.preview = null; render(); const dp = $("day"); if (dp) { dp.classList.remove("enter"); void dp.offsetWidth; dp.classList.add("enter"); } if (matchMedia("(max-width: 880px)").matches) $("day").scrollIntoView({ behavior: "smooth", block: "start" }); },
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
    if (t.needsLicense && !emp.hasLicense) return toast("Off-campus outings need a driver's license. Tick \"I have a driver's license\" in My profile (tap your name, top right) first.");
    act(() => B.updateMe({ teams: [...new Set([...emp.teams, t.id])] }), `You joined ${t.shortName}.`);
  },
  leave: (d) => {
    const emp = myEmp(), t = teamById(+d.team), left = S.signups.filter((s) => s.employeeId === emp.id && s.teamId === t.id && startsAt(s).getTime() > Date.now());
    if (left.length) return toast(`You still have ${plural(left.length, "upcoming shift")} on ${t.shortName}. Cancel or offer ${left.length === 1 ? "it" : "them"} to a teammate first.`);
    if (confirm(`Leave ${t.shortName}? You won't see its shifts any more.`)) act(() => B.updateMe({ teams: emp.teams.filter((x) => x !== t.id) }), `You left ${t.shortName}.`);
  },
  answer: (d) => { S.quiz.answers[S.quiz.i] = +d.i; S.quiz.i++; render(); },
  qback: () => { S.quiz.i = Math.max(0, S.quiz.i - 1); render(); },
  qreset: () => { S.quiz = { i: 0, answers: [] }; render(); },
  quizjoin: (d) => {
    const emp = myEmp(), ids = d.teams.split(",").map(Number);
    const patch = { teams: [...new Set([...emp.teams, ...ids])], quizTeam: ids[0] };
    if (S.quiz.answers[2] === 0 || S.quiz.answers[2] === 1) patch.hasLicense = true;
    if (S.quiz.answers[2] === 2) { patch.hasLicense = false; patch.teams = patch.teams.filter((id) => { const t = teamById(id); return !(t && t.needsLicense); }); }
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
    const ev = ss.map((s) => { const t = teamById(s.teamId), b = BLOCKS[s.block], g = groupOf(s.date, s.clusterNo), r = t && t.staffing === "fixed" && rotation(t, s.block, s.date);
      return { uid: `${s.id}`, date: s.date, start: b.start, end: b.end + extraMin(s) / 60, title: `${t ? t.shortName : "Shift"}${placeOf(s) ? " · " + placeOf(s) : ""} · Magnolia`,
        description: g ? `Cluster ${s.clusterNo}: ${g.members.map((m) => m.firstName + (m.ownDsp ? " (1:1)" : "")).join(", ")}` : r ? r.map((x) => `${hShort(x.hour)}: ${x.cluster ? "Cluster " + x.cluster + " · " : ""}${x.activity}`).join("\n") : placeOf(s) || "Residential coverage" }; });
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
  editteam: (d) => { S.editTeam = +d.team; render(); },
  addhome: () => act(() => B.saveHome({ name: `Home ${S.homes.length + 1}`, cluster: "A", location: "Community", residents: 6 }), "Home added."),
  delhome: (d) => { if (confirm(`Remove ${d.name}? Its House & Daily Living shifts are removed too.`)) act(() => B.deleteHome(+d.id), "Home removed."); },
  delres: (d) => { if (confirm(`Remove ${d.name}?`)) act(() => B.deleteResident(+d.id), "Resident removed."); },
  clustersync: (d) => act(() => B.ensureClusters(d.m, false), "Clusters updated."),
  reshuffle: (d) => { if (confirm(`Regroup every resident into new clusters, starting ${monthName(d.m)}? Booked shifts keep their cluster number, but the residents in each cluster will change.`)) act(() => B.ensureClusters(d.m, true), "Clusters reshuffled."); },
  ann: () => { const v = $("ann").value.trim().slice(0, 280); act(() => B.saveAnnouncement(v), v ? "Announcement posted." : "Announcement removed."); },
  publish: (d) => { if (confirm(`Publish the week of ${fmt(d.w, { month: "long", day: "numeric" })}? It locks new picks for that week and emails everyone their final schedule.`)) act(() => B.publishWeek(d.w), (r) => r && r.preview ? "Week published. (Preview mode: no emails sent.)" : `Week published. Emailed ${r.sent} of ${r.people} DSPs${r.failed && r.failed.length ? `; ${r.failed.length} failed` : ""}.`); },
  unpublish: (d) => { if (confirm("Reopen this week? DSPs will be able to pick shifts again.")) act(() => B.setWeekLock(d.w, false), "Week reopened."); },
  wipedemo: () => { if (confirm("Remove all demo DSPs, demo residents and their shifts? Real people and their shifts stay.")) act(() => B.wipeDemo(), (n) => `Removed ${n} demo DSPs and the demo residents.`); },
  resetdemo: () => { if (confirm("Reset all preview data on this device?")) { B.resetDemo(); } },
  tempnav: (d) => { S.tempFrom = +d.d ? addDays(S.tempFrom, +d.d) : TODAY; S.tempDay = ""; refresh(); },
  gotemps: () => { S.tab = "hr"; S.hrSub = "temps"; S.tempFrom = TODAY; S.tempDay = ""; syncHash(); refresh(); window.scrollTo(0, 0); },
  tempday: (d) => { S.tempDay = d.date; render(); },
  callout: (d) => {
    const s = signupById(+d.id); if (!s) return;
    const reason = prompt(`Call out of ${slotText(s)}?\n\nHR is told right away and the first person on the waitlist gets the shift. Add a short reason (optional):`, "");
    if (reason === null) return;
    act(() => B.callOut(s.id, reason.trim().slice(0, 200)), (r) => (r && r.filled ? "Called out. Someone from the waitlist has your shift, and HR knows." : "Called out. HR has been told this spot needs cover."));
  },
  offer: (d) => act(() => B.offerShift(+d.id), "Offered to your teammates. It's still yours until someone takes it and it's approved."),
  canceloffer: (d) => act(() => B.cancelOffer(+d.id), "Offer cancelled."),
  claim: (d) => act(() => B.claimOffer(+d.id), "Request sent. You'll get the shift once HR or the Lead DSP approves."),
  approve: (d) => act(() => B.decideOffer(+d.id, true), "Swap approved. Both DSPs have been told."),
  decline: (d) => act(() => B.decideOffer(+d.id, false), "Swap declined. The shift is back up for grabs."),
  deltimeoff: (d) => act(() => B.removeTimeOff(+d.id), "Removed."),
  promote: (d) => { const e = empById(d.id); if (e && confirm(`Promote ${d.name} to DSP II?`)) act(() => B.hrSaveEmployee({ ...e, level: "DSP II" }), `${d.name} is now a DSP II.`); },
  autofill: () => {
    const emp = myEmp(), ws = weekStart(S.sel), we = addDays(ws, 6), hours = weekHours(emp.id, ws), target = emp.weeklyTarget || 40;
    if (!prefsOf(emp)) { S.askPrefs = true; S.preview = null; return render(); }
    S.askPrefs = false;
    const plan = fillPlan(emp, openForMe(emp, ws, we), hours, target);
    if (!plan.length) { S.preview = null; render(); return toast("No open shifts match your preferences this week. Change them, or pick shifts yourself."); }
    S.preview = { ws, plan, hours, target }; render();
  },
  editprefs: () => { S.askPrefs = true; S.preview = null; render(); },
  cancelplan: () => { S.preview = null; S.askPrefs = false; render(); },
  bookplan: () => {
    const P = S.preview; if (!P) return; S.preview = null; let ok = 0;
    bookAndCheer(P.ws, async () => { for (const x of P.plan) { try { await B.take({ date: x.d, block: x.b, teamId: x.t.id, homeId: x.pick.homeId, clusterNo: x.pick.clusterNo }); ok++; } catch (_) {} } }, () => `Booked ${plural(ok, "shift")} (${ok * 4} hours).`);
  },
  booktemp: (d) => { const sl = slotFrom(d); S.tempHist = null; act(() => B.setTemps(sl, tempN(sl) + 1), `Temp booked${placeOf(sl) ? " for " + placeOf(sl) : ""}.`); },
  bookrow: (d) => {
    const t = teamById(+d.team), us = units(t, d.date, +d.block).filter((u) => taken(u) < u.need), n = us.reduce((a, u) => a + u.need - taken(u), 0);
    if (!n || !confirm(`Mark ${plural(n, "temp")} booked for ${t.shortName}, ${short(d.date)} ${BLOCKS[+d.block].label}?`)) return;
    S.tempHist = null; act(async () => { for (const u of us) await B.setTemps(u, tempN(u) + u.need - taken(u)); }, `${plural(n, "temp")} booked.`);
  },
  untemp: (d) => { const sl = slotFrom(d), n = +d.n < 0 ? Math.max(tempN(sl) - 1, 0) : 0; S.tempHist = null; act(() => B.setTemps(sl, n), "Temp booking updated."); },
  bookedcsv: () => {
    const ws = S.tempFrom, q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [["Date", "Day", "Block", "Team", "House / cluster", "Temps booked", "Hours"].map(q).join(",")];
    for (const x of (S.temps || []).filter((x) => x.date >= ws && x.date <= addDays(ws, 6)).sort((a, b) => (a.date + a.block < b.date + b.block ? -1 : 1))) { const t = teamById(x.teamId);
      rows.push([x.date, fmt(x.date, { weekday: "long" }), BLOCKS[x.block].label, t ? t.name : "", placeOf(x), x.count, x.count * 4].map(q).join(",")); }
    downloadFile(`magnolia-temps-booked-${ws}.csv`, rows.join("\n"), "text/csv");
  },
  tempday2: (d) => { S.hrTools = true; goDay(d.date); },
  tempcsv: () => {
    const ws = S.tempFrom, q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [["Date", "Day", "Block", "Team", "House / cluster", "DSPs signed up", "DSPs needed", "Temps needed", "Hours", "Inside 3 days"].map(q).join(",")];
    for (const x of openSpots(ws, addDays(ws, 6))) rows.push([x.date, fmt(x.date, { weekday: "long" }), BLOCKS[x.block].label, x.team.name, x.label, inSlot(x).length, x.need, x.open, x.open * 4,
      shiftStart(x.date, x.block) - Date.now() <= DROP_HOURS * 36e5 ? "yes" : "no"].map(q).join(","));
    if (rows.length === 1) return toast("Nothing open in these 7 days.");
    downloadFile(`magnolia-temps-needed-${ws}.csv`, rows.join("\n"), "text/csv");
  },
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
  if (kind === "prefs") {
    const prefs = { days: fd.getAll("day").map(Number), blocks: fd.getAll("blk").map(Number), maxPerDay: +fd.get("max") || 8 };
    if (!prefs.days.length || !prefs.blocks.length) return toast("Pick at least one day and one time.");
    const emp = myEmp(); emp.prefs = prefs;   // show it right away; the save below confirms
    if (f.dataset.then === "plan") { act(() => B.updateMe({ prefs }), "Preferences saved.").then(() => actions.autofill()); }
    else act(() => B.updateMe({ prefs }), "Preferences saved.");
  }
  if (kind === "timeoff") { const day = String(fd.get("day")); if (day) act(() => B.addTimeOff(day, String(fd.get("note") || "").trim().slice(0, 120)), `${short(day)} marked as a day you can't work.`); }
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

/* ---------- hooks for the Magnolia Helper chat (chat.js) ---------- */
window.MagnoliaApp = {
  me: () => { const e = myEmp(); return { name: (e && e.name) || "", isAdmin: isAdmin(), signedIn: !!(B && S.loaded && (B.mode === "preview" || S.me)) }; },
  go: (tab, sub) => { if (tab === "hr" && !isAdmin()) return; S.tab = tab; if (sub) S.hrSub = sub; if (sub === "temps") S.tempFrom = TODAY; syncHash(); refresh(); window.scrollTo({ top: 0, behavior: "smooth" }); },
  token: async () => (B && B.accessToken ? B.accessToken() : ""),
};

/* ---------- boot ---------- */
const h0 = location.hash.slice(1);
if (TABS.some((t) => t.id === h0)) S.tab = h0;
if (h0 === "temps") { S.tab = "hr"; S.hrSub = "temps"; }   // link used in the HR alert
window.addEventListener("hashchange", () => { const t = location.hash.slice(1); if (t === "temps") { S.tab = "hr"; S.hrSub = "temps"; syncHash(); return render(); } if (TABS.some((x) => x.id === t) && t !== S.tab) { S.tab = t; render(); } });
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
