/*
 * Data layer. app.js only talks to the object createBackend() returns, so the app works the same
 * in Preview mode (demo data in this browser) and Live mode (Supabase).
 *
 * load(from, to) → { teams, homes, employees, signups, residents, clusters, waitlist, settings }
 *   teams:     [{ id, key, name, shortName, description, activities[], needsLicense, needs[6], staffing, color, sort, active }]
 *              staffing: "fixed" (one pool per block) | "home" (per house) | "cluster" (per monthly outing cluster)
 *   homes:     [{ id, name, cluster, location, residents, sort }]   (home.cluster = area A–D)
 *   employees: [{ id, userId, name, email, level, hireDate, weeklyTarget, hasLicense, hasCna, teams[], quizTeam, active, demo }]
 *   signups:   [{ id, employeeId, date, block, teamId, homeId, clusterNo }]
 *   residents: [{ id, firstName, homeId, ownDsp, active, demo }]
 *   clusters:  [{ month: "YYYY-MM", residentId, clusterNo }]
 *   waitlist:  [{ id, employeeId, date, block, teamId, homeId, clusterNo, createdAt }]
 *   settings:  { announcement, lockedWeeks[], vapidPublic }
 */
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const WAITLIST_MAX = 10, CLUSTER_MAX = 8, DROP_HOURS = 48;

/* ---------------- staffing rules (shared by both backends and the UI) ---------------- */
const DAY0 = Date.UTC(2000, 0, 3);
function dayIndex(ds) { const [y, m, d] = ds.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - DAY0) / 864e5); }
function workBlocks(team) { return (team.needs || []).map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0); }
/* each outing cluster goes out once a day; its block rotates day to day (same formula as the database) */
function clusterBlock(team, ds, c) { const bl = workBlocks(team); return bl.length ? bl[(dayIndex(ds) + c) % bl.length] : -1; }
/* { clusterNo: { no, members: [resident], ones } } for one month */
function clusterMap(clusters, residents, month) {
  const out = {};
  for (const c of clusters) if (c.month === month) {
    const r = residents.find((x) => x.id === c.residentId); if (!r || r.active === false) continue;
    const g = (out[c.clusterNo] ||= { no: c.clusterNo, members: [], ones: 0 });
    g.members.push(r); if (r.ownDsp) g.ones++;
  }
  return out;
}
/* DSPs needed for one slot; -1 = no such slot (wrong house/cluster for this team) */
function slotNeed(team, ds, block, homeId, clusterNo, ctx) {
  if (!team || team.active === false) return 0;
  const base = team.needs[block] || 0; if (!base) return 0;
  if (team.staffing === "home") return clusterNo == null && homeId != null && ctx.homes.some((h) => h.id === homeId) ? base : -1;
  if (team.staffing === "cluster") {
    if (homeId != null) return -1;
    const cm = clusterMap(ctx.clusters, ctx.residents, ds.slice(0, 7));
    if (!Object.keys(cm).length) return clusterNo == null ? base : -1;
    const g = clusterNo != null && cm[clusterNo];
    if (!g || clusterBlock(team, ds, clusterNo) !== block) return -1;
    return base + g.ones;
  }
  return homeId == null && clusterNo == null ? base : -1;
}
const shiftStart = (ds, block) => { const [y, m, d] = ds.split("-").map(Number); return new Date(y, m - 1, d, block * 4); };

/* deal residents into clusters of at most 8 (people who need their own DSP spread out first) */
function dealClusters(month, residents, existing, rnd) {
  const act = residents.filter((r) => r.active !== false);
  const mine = existing.filter((c) => c.month === month && act.some((r) => r.id === c.residentId));
  if (!act.length) return mine;
  let k = Math.max(Math.ceil(act.length / CLUSTER_MAX), ...mine.map((c) => c.clusterNo), 0);
  const sizes = Array(k + 1).fill(0), ones = Array(k + 1).fill(0);
  for (const c of mine) { sizes[c.clusterNo]++; if (act.find((r) => r.id === c.residentId).ownDsp) ones[c.clusterNo]++; }
  const todo = act.filter((r) => !mine.some((c) => c.residentId === r.id)).map((r) => ({ r, k: rnd() })).sort((a, b) => (b.r.ownDsp - a.r.ownDsp) || a.k - b.k);
  const out = [...mine];
  for (const { r } of todo) {
    let best = 0;
    for (let i = 1; i <= k; i++) if (sizes[i] < CLUSTER_MAX && (!best || sizes[i] < sizes[best] || (sizes[i] === sizes[best] && r.ownDsp && ones[i] < ones[best]))) best = i;
    if (!best) { k++; sizes.push(0); ones.push(0); best = k; }
    out.push({ month, residentId: r.id, clusterNo: best }); sizes[best]++; if (r.ownDsp) ones[best]++;
  }
  return out;
}
function seeded(str) { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const monthsBetween = (from, to) => { const out = []; let [y, m] = from.slice(0, 7).split("-").map(Number); const end = to.slice(0, 7); for (;;) { const k = `${y}-${String(m).padStart(2, "0")}`; out.push(k); if (k >= end) break; m++; if (m > 12) { m = 1; y++; } } return out; };

async function resolveConfig() {
  const cfg = { ...window.MAGNOLIA };
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) {
      const j = await r.json();
      if (j.supabaseUrl && j.supabaseAnonKey) Object.assign(cfg, j);
    }
  } catch (_) {}
  return cfg;
}

async function createBackend() {
  const cfg = await resolveConfig();
  if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
    try { return await supabaseBackend(cfg); } catch (e) { console.warn("Supabase unavailable, using preview", e); }
  }
  return previewBackend(cfg);
}

const friendlyError = (msg) => { const e = new Error(msg); e.friendly = msg; return e; };
const sameSlot = (a, b) => a.date === b.date && a.block === b.block && a.teamId === b.teamId && (a.homeId ?? null) === (b.homeId ?? null) && (a.clusterNo ?? null) === (b.clusterNo ?? null);

/* ---------------- shared demo data ---------------- */
function demoTeams() {
  return [
    { id: 1, key: "house", name: "House & Daily Living + Job Coaches", shortName: "House & Daily Living", color: 0, sort: 1, needsLicense: false, needs: [2, 2, 2, 2, 2, 2], staffing: "home", active: true,
      description: "Keeps each home running and residents ready for the day, including job prep for Ochsner. You work one house. Covers nights. No driver's license needed.",
      activities: ["Cooking and meal prep", "Meal assistance (Meals on Wheels)", "Cleaning and housekeeping", "Homeroom", "Daily living skills", "Job prep for Ochsner"] },
    { id: 2, key: "campus", name: "On-Campus Activities", shortName: "On-Campus", color: 1, sort: 2, needsLicense: false, needs: [0, 0, 2, 2, 2, 0], staffing: "fixed", active: true,
      description: "Active days on the 11-acre campus: garden, fitness, sports and crafts. No driver's license needed.",
      activities: ["Music garden", "Campus walks", "Arts and crafts", "Board games", "Fitness center", "Sports and wellness classes"] },
    { id: 3, key: "outings", name: "Community Outings", shortName: "Outings", color: 2, sort: 3, needsLicense: true, needs: [0, 0, 2, 2, 2, 0], staffing: "cluster", active: true,
      description: "Shopping, dining and events around New Orleans with one resident cluster (8 or fewer). Driver's license required.",
      activities: ["Lakeside Mall", "Library", "Dollar Tree", "Off-campus lunch", "Community events", "Bowling at Colonial Lanes"] },
    { id: 4, key: "learning", name: "Learning & Community", shortName: "Learning", color: 3, sort: 4, needsLicense: false, needs: [0, 0, 2, 2, 2, 0], staffing: "fixed", active: true,
      description: "Calm, on-campus learning: reading, journaling, music and structured classes.",
      activities: ["Storytelling and reading", "Journaling", "Music appreciation", "Structured learning"] },
  ];
}
function demoHomes() {
  return Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Home ${i + 1}`, cluster: "ABCD"[Math.floor(i / 5)], location: i < 5 ? "Campus" : "Community", residents: 6 + ((i + 1) % 3), sort: i + 1 }));
}
const DEMO_NAMES = ["James", "Mary", "Darnell", "Linda", "Kevin", "Angela", "Tyrone", "Denise", "Brandon", "Monique", "Eric", "Shanice", "Joseph", "Patricia", "Marcus", "Yolanda", "Henry", "Carla",
  "Isaiah", "Renee", "Louis", "Bernadette", "Calvin", "Tasha", "Victor", "Jasmine", "Wendell", "Lorraine", "Oscar", "Keyana", "Raymond", "Felicia", "Terrence", "Gwen", "Alvin", "Dana"];
function demoResidents(homes) {
  const out = []; let id = 1;
  for (const h of homes) for (let g = 1; g <= h.residents; g++) out.push({ id: id++, firstName: DEMO_NAMES[(h.sort * 5 + g * 11) % 36], homeId: h.id, ownDsp: (h.sort * 7 + g) % 9 === 4, active: true, demo: true });
  return out;
}
function demoEmployees(today) {
  const rows = [
    ["Sally Thompson", "DSP I", 40, 40, true, false, ["outings", "house", "learning"]],
    ["Marcus Johnson", "Lead DSP", 900, 40, true, true, ["outings"]],
    ["Keisha Brown", "DSP II", 300, 40, true, false, ["outings", "campus"]],
    ["Andre Williams", "DSP I", 60, 40, true, false, ["outings"]],
    ["Tanya Davis", "Lead DSP", 1400, 40, false, true, ["house"]],
    ["Robert Lee", "DSP II", 420, 40, false, false, ["house"]],
    ["Gloria Martin", "DSP II", 250, 32, false, false, ["house", "learning"]],
    ["Devon Harris", "DSP I", 20, 40, false, false, ["house"]],
    ["Linda Nguyen", "DSP I", 90, 40, false, false, ["house"]],
    ["Chris Jackson", "Lead DSP", 700, 40, true, false, ["campus"]],
    ["Maria Lopez", "DSP II", 365, 40, false, false, ["campus"]],
    ["Jamal Carter", "DSP I", 45, 40, false, false, ["campus", "learning"]],
    ["Brianna White", "Lead DSP", 1100, 40, false, true, ["learning"]],
    ["Ethan Clark", "DSP II", 200, 40, true, false, ["learning", "outings"]],
    ["Nia Robinson", "DSP I", 30, 24, false, false, ["learning"]],
    ["Paul Walker", "DSP II", 500, 40, false, false, ["house", "campus"]],
  ];
  const keyToId = { house: 1, campus: 2, outings: 3, learning: 4 };
  return rows.map(([name, level, days, target, lic, cna, keys], i) => ({
    id: "demo-" + i, userId: i === 0 ? "preview-me" : null, name, email: i === 0 ? "sally@example.com" : "", level,
    hireDate: isoDate(addDaysD(today, -days)), weeklyTarget: target, hasLicense: lic, hasCna: cna,
    teams: keys.map((k) => keyToId[k]), quizTeam: null, active: true, demo: true,
  }));
}
function demoSignups(employees, teams, ctx, today) {
  const out = []; let id = 1;
  const mod = (a, n) => ((a % n) + n) % n;
  const cnt = (sl) => out.filter((s) => sameSlot(s, sl)).length;
  const fits = (sl) => { const n = slotNeed(teams.find((t) => t.id === sl.teamId), sl.date, sl.block, sl.homeId, sl.clusterNo, ctx); return n > 0 && cnt(sl) < n; };
  const clusterAt = (team, ds, b, i) => {
    const cm = clusterMap(ctx.clusters, ctx.residents, ds.slice(0, 7)), nos = Object.keys(cm).map(Number);
    if (!nos.length) return null;
    const ok = nos.filter((c) => clusterBlock(team, ds, c) === b).sort((x, y) => mod(x + i, 7) - mod(y + i, 7));
    return ok.length ? ok[0] : undefined;
  };
  employees.forEach((e, idx) => {
    const i = idx + 1;
    for (let k = -14; k <= 20; k++) {
      const d = addDaysD(today, k), dow = d.getDay(), ds = isoDate(d);
      if ((dow === 0 || dow === 6) && i % 3 !== 0) continue;
      if (mod(k + i, 7) === 5 || mod(k + i, 7) === 6) continue;
      const t = e.teams[mod(k + i, e.teams.length)], team = teams.find((x) => x.id === t);
      const b = team.key === "house" && i % 4 === 0 ? 0 : 2 + mod(k + i, 2);
      if (out.some((s) => s.employeeId === e.id && s.date === ds && (s.block === b || s.block === b + 1))) continue;
      const homeId = team.staffing === "home" ? ctx.homes[(i * 3) % ctx.homes.length].id : null;
      const c1 = team.staffing === "cluster" ? clusterAt(team, ds, b, i) : null, c2 = team.staffing === "cluster" ? clusterAt(team, ds, b + 1, i) : null;
      if (c1 === undefined || c2 === undefined) continue;
      const a = { employeeId: e.id, date: ds, block: b, teamId: t, homeId, clusterNo: c1 }, z = { employeeId: e.id, date: ds, block: b + 1, teamId: t, homeId, clusterNo: c2 };
      if (!fits(a) || !fits(z)) continue;
      out.push({ id: id++, ...a }, { id: id++, ...z });
    }
  });
  return out;
}

/* ---------------- Preview: demo data in localStorage ---------------- */
function previewBackend(cfg) {
  const KEY = "magnolia-dsp-preview-v3";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (_) { return null; } };
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (_) {} };
  const ensure = (month, reshuffle) => {
    if (reshuffle) st.clusters = st.clusters.filter((c) => c.month !== month);
    st.clusters = st.clusters.filter((c) => c.month !== month).concat(dealClusters(month, st.residents, st.clusters, seeded(month + ":" + (st.shuffles[month] || 0))));
  };
  const seed = () => {
    const teams = demoTeams(), homes = demoHomes(), employees = demoEmployees(today), residents = demoResidents(homes);
    const s0 = { teams, homes, employees, residents, clusters: [], shuffles: {}, waitlist: [], signups: [], settings: { announcement: "", lockedWeeks: [], vapidPublic: "" }, nextId: 100000, admins: {}, reminders: true };
    st = s0;
    for (const m of monthsBetween(isoDate(addDaysD(today, -20)), isoDate(addDaysD(today, 40)))) ensure(m);
    s0.signups = demoSignups(employees, teams, { homes, residents, clusters: s0.clusters }, today);
    return s0;
  };
  let st = read(); if (!st) st = seed(); write();
  let notify = () => {};
  const done = () => { write(); notify(); };
  const ctx = () => ({ homes: st.homes, residents: st.residents, clusters: st.clusters });
  const meEmp = () => st.employees.find((e) => e.userId === "preview-me");
  const teamOf = (id) => st.teams.find((t) => t.id === id);
  const needOf = (sl) => slotNeed(teamOf(sl.teamId), sl.date, sl.block, sl.homeId ?? null, sl.clusterNo ?? null, ctx());
  const checkTake = (sl) => {
    const t = teamOf(sl.teamId), n = needOf(sl);
    if (n === 0) throw friendlyError("That team doesn't work this block.");
    if (n < 0) throw friendlyError(t.staffing === "home" ? "Pick which house you're working." : t.staffing === "cluster" ? "Pick which outing cluster you're working." : "That slot doesn't exist.");
    if (st.signups.some((s) => s.employeeId === sl.employeeId && s.date === sl.date && s.block === sl.block)) throw friendlyError("You already have a shift at that time.");
    if (st.signups.filter((s) => sameSlot(s, sl)).length >= n) throw friendlyError("That shift is already full. Join the waitlist instead.");
  };
  const fillFrom = (gone) => {
    if (shiftStart(gone.date, gone.block) <= new Date()) return;
    for (const w of st.waitlist.filter((x) => sameSlot(x, gone)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) {
      st.waitlist = st.waitlist.filter((x) => x.id !== w.id);
      if (st.signups.some((s) => s.employeeId === w.employeeId && s.date === w.date && s.block === w.block)) continue;
      st.signups.push({ id: st.nextId++, employeeId: w.employeeId, date: w.date, block: w.block, teamId: w.teamId, homeId: w.homeId ?? null, clusterNo: w.clusterNo ?? null });
      return w;
    }
  };
  return {
    mode: "preview",
    async init(onChange) { notify = onChange; },
    me() { const e = meEmp(); return { userId: "preview-me", email: e ? e.email : "", isAdmin: true, reminders: st.reminders !== false }; },
    async load(from, to) {
      st.settings.lockedWeeks ||= [];
      let changed = false;
      for (const m of monthsBetween(from, to)) if (st.residents.some((r) => r.active !== false) && !st.clusters.some((c) => c.month === m)) { ensure(m); changed = true; }
      if (changed) write();
      return { teams: st.teams, homes: st.homes, employees: st.employees, settings: st.settings, residents: st.residents,
        clusters: st.clusters.filter((c) => c.month >= from.slice(0, 7) && c.month <= to.slice(0, 7)),
        waitlist: st.waitlist, signups: st.signups.filter((s) => s.date >= from && s.date <= to) };
    },
    async take(slot, employeeId) {
      const sl = { homeId: null, clusterNo: null, ...slot, employeeId: employeeId || meEmp().id };
      checkTake(sl);
      st.signups.push({ id: st.nextId++, employeeId: sl.employeeId, date: sl.date, block: sl.block, teamId: sl.teamId, homeId: sl.homeId, clusterNo: sl.clusterNo });
      st.waitlist = st.waitlist.filter((w) => !(w.employeeId === sl.employeeId && w.date === sl.date && w.block === sl.block));
      done();
    },
    async drop(id, asHr) {
      const s = st.signups.find((x) => x.id === id); if (!s) return {};
      if (!asHr && shiftStart(s.date, s.block) - Date.now() < DROP_HOURS * 36e5) throw friendlyError("Shifts can't be dropped within 48 hours of the start. Talk to your Lead DSP or HR.");
      st.signups = st.signups.filter((x) => x.id !== id);
      const w = fillFrom(s); done();
      return { filledBy: w ? w.employeeId : null };
    },
    async joinWait(slot) {
      const sl = { homeId: null, clusterNo: null, ...slot, employeeId: meEmp().id }, n = needOf(sl);
      if (n <= 0) throw friendlyError("That slot doesn't exist.");
      if (st.signups.filter((s) => sameSlot(s, sl)).length < n) throw friendlyError("There's an open spot. Take the shift instead.");
      if (st.signups.some((s) => s.employeeId === sl.employeeId && s.date === sl.date && s.block === sl.block)) throw friendlyError("You already work at that time.");
      if (st.waitlist.some((w) => w.employeeId === sl.employeeId && sameSlot(w, sl))) throw friendlyError("You're already on that waitlist.");
      if (st.waitlist.filter((w) => sameSlot(w, sl)).length >= WAITLIST_MAX) throw friendlyError("That waitlist is full (10 people).");
      st.waitlist.push({ id: st.nextId++, ...sl, createdAt: new Date().toISOString() }); done();
    },
    async leaveWait(id) { st.waitlist = st.waitlist.filter((w) => w.id !== id); done(); },
    async updateMe(patch) { Object.assign(meEmp(), patch); done(); },
    async setReminders(on) { st.reminders = on; done(); },
    async hrSaveEmployee(emp) {
      if (emp.id) Object.assign(st.employees.find((e) => e.id === emp.id), emp);
      else st.employees.push({ ...emp, id: "emp-" + st.nextId++, userId: null, email: "", demo: false, quizTeam: null });
      done();
    },
    async listAdmins() { return Object.keys(st.admins).filter((k) => st.admins[k]); },
    async setAdmin(userId, on) { st.admins[userId] = on; done(); },
    async saveTeam(team) {
      if (team.id) Object.assign(st.teams.find((t) => t.id === team.id), team);
      else st.teams.push({ ...team, id: st.nextId++, key: "team" + st.nextId, active: true, sort: st.teams.length + 1 });
      done();
    },
    async saveHome(home) {
      if (home.id) Object.assign(st.homes.find((h) => h.id === home.id), home);
      else st.homes.push({ ...home, id: st.nextId++, sort: st.homes.length + 1 });
      done();
    },
    async deleteHome(id) { st.homes = st.homes.filter((h) => h.id !== id); st.signups = st.signups.filter((s) => s.homeId !== id); st.residents.forEach((r) => { if (r.homeId === id) r.homeId = null; }); done(); },
    async saveResident(r) {
      if (r.id) Object.assign(st.residents.find((x) => x.id === r.id), r);
      else st.residents.push({ ...r, id: st.nextId++, active: true, demo: false });
      done();
    },
    async deleteResident(id) { st.residents = st.residents.filter((r) => r.id !== id); st.clusters = st.clusters.filter((c) => c.residentId !== id); done(); },
    async ensureClusters(month, reshuffle) { if (reshuffle) st.shuffles[month] = (st.shuffles[month] || 0) + 1; ensure(month, reshuffle); done(); },
    async saveAnnouncement(text) { st.settings.announcement = text; done(); },
    async saveVapidPublic(key) { st.settings.vapidPublic = key; done(); },
    async setWeekLock(week, on) {
      const s = new Set(st.settings.lockedWeeks || []); on ? s.add(week) : s.delete(week);
      st.settings.lockedWeeks = [...s]; done();
    },
    async publishWeek(week) { await this.setWeekLock(week, true); return { preview: true, sent: 0, people: 0 }; },
    async wipeDemo() {
      const ids = new Set(st.employees.filter((e) => e.demo && e.userId !== "preview-me").map((e) => e.id));
      st.employees = st.employees.filter((e) => !ids.has(e.id));
      st.signups = st.signups.filter((s) => !ids.has(s.employeeId)); st.waitlist = st.waitlist.filter((w) => !ids.has(w.employeeId));
      const rids = new Set(st.residents.filter((r) => r.demo).map((r) => r.id));
      st.residents = st.residents.filter((r) => !rids.has(r.id)); st.clusters = st.clusters.filter((c) => !rids.has(c.residentId));
      done(); return ids.size;
    },
    /* phone alerts: in preview there's no server, so "on" just shows a sample notification on this device */
    async pushStatus() { return { count: st.pushOn ? 1 : 0 }; },
    async savePush() { st.pushOn = true; done(); },
    async removePush() { st.pushOn = false; done(); },
    async testPush() { return { preview: true }; },
    async hasAdmin() { return true; }, async claimAdmin() { return false; },
    async signIn() {}, async signOut() {},
    resetDemo() { st = seed(); done(); },
  };
}

/* ---------------- Live: Supabase ---------------- */
async function supabaseBackend(cfg) {
  const { createClient } = await import(SUPABASE_CDN);
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  let me = null, notify = () => {}, timer = null, channel = null;
  const ping = () => { clearTimeout(timer); timer = setTimeout(() => notify(), 150); };
  const fail = (error) => {
    const code = error && error.code, m = (error && error.message) || "";
    if (code === "P0001") return friendlyError(m.endsWith(".") ? m : m + ".");
    if (code === "23505") return friendlyError("You already have a shift (or a waitlist spot) at that time.");
    if (code === "42501" || /row-level security/i.test(m)) return friendlyError("Not allowed: you can only take future shifts on your own teams, and not in a week HR has published.");
    if (/JWT|session/i.test(m)) return friendlyError("Your sign-in expired. Please sign in again.");
    return friendlyError(m || "That didn't save. Check your connection and try again.");
  };
  const toTeam = (t) => ({ id: t.id, key: t.key, name: t.name, shortName: t.short_name || t.name, description: t.description, activities: t.activities || [],
    needsLicense: t.needs_license, needs: t.needs || [0, 0, 0, 0, 0, 0], staffing: t.staffing || "fixed", color: t.color, sort: t.sort, active: t.active });
  const toEmp = (e) => ({ id: e.id, userId: e.user_id, name: e.name, email: e.email, level: e.level, hireDate: e.hire_date, weeklyTarget: e.weekly_target,
    hasLicense: e.has_license, hasCna: e.has_cna, teams: e.teams || [], quizTeam: e.quiz_team, active: e.active, demo: e.demo });
  const toSlot = (r) => ({ id: r.id, employeeId: r.employee_id, date: r.shift_date, block: r.block, teamId: r.team_id, homeId: r.home_id ?? null, clusterNo: r.cluster_no ?? null });
  const slotRow = (s) => ({ shift_date: s.date, block: s.block, team_id: s.teamId, home_id: s.homeId ?? null, cluster_no: s.clusterNo ?? null });

  async function refreshMe(session) {
    if (!session) { me = null; return; }
    const { data } = await sb.from("profiles").select("is_admin,reminders").eq("id", session.user.id).maybeSingle();
    me = { userId: session.user.id, email: session.user.email || "", isAdmin: !!(data && data.is_admin), reminders: !data || data.reminders !== false };
  }
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("dsp");
    for (const table of ["dsp_signups", "dsp_waitlist", "employees", "teams", "settings", "residents", "resident_clusters"]) channel.on("postgres_changes", { event: "*", schema: "public", table }, ping);
    channel.subscribe();
  }
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw fail(error); return data; };
  const run = async (q) => { const { data, error } = await q; if (error) throw fail(error); ping(); return data; };

  return {
    mode: "live",
    async init(onChange) {
      notify = onChange;
      const { data } = await sb.auth.getSession();
      await refreshMe(data.session);
      sb.auth.onAuthStateChange((_e, session) => { setTimeout(async () => { await refreshMe(session); subscribe(); notify(); }, 0); });
      subscribe();
    },
    me() { return me; },
    async load(from, to) {
      if (!me) return { teams: [], homes: [], employees: [], signups: [], residents: [], clusters: [], waitlist: [], settings: { announcement: "", lockedWeeks: [], vapidPublic: "" } };
      const m0 = from.slice(0, 7), m1 = to.slice(0, 7);
      const getClusters = () => sb.from("resident_clusters").select("month,resident_id,cluster_no").gte("month", m0).lte("month", m1);
      const [t, h, e, s, set, r, c, w] = await Promise.all([
        sb.from("teams").select("*").order("sort"),
        sb.from("homes").select("*").order("sort"),
        sb.from("employees").select("*").order("name"),
        sb.from("dsp_signups").select("id,employee_id,shift_date,block,team_id,home_id,cluster_no").gte("shift_date", from).lte("shift_date", to),
        sb.from("settings").select("announcement,locked_weeks,vapid_public").eq("id", 1).maybeSingle(),
        sb.from("residents").select("*").order("id"),
        getClusters(),
        sb.from("dsp_waitlist").select("*").gte("shift_date", from).lte("shift_date", to).order("created_at"),
      ]);
      const err = t.error || h.error || e.error || s.error || r.error || c.error || w.error;
      if (err) throw fail(err);
      let clusters = c.data;
      // new month and nobody has opened it yet: deal this month's clusters now
      const missing = monthsBetween(from, to).filter((m) => !clusters.some((x) => x.month === m));
      if (missing.length && r.data.some((x) => x.active)) {
        for (const m of missing) await sb.rpc("generate_clusters", { p_month: m, p_reshuffle: false });
        const again = await getClusters(); if (!again.error) clusters = again.data;
      }
      return {
        teams: t.data.map(toTeam), homes: h.data, employees: e.data.map(toEmp), signups: s.data.map(toSlot),
        residents: r.data.map((x) => ({ id: x.id, firstName: x.first_name, homeId: x.home_id, ownDsp: x.own_dsp, active: x.active, demo: x.demo })),
        clusters: clusters.map((x) => ({ month: x.month, residentId: x.resident_id, clusterNo: x.cluster_no })),
        waitlist: w.data.map((x) => ({ ...toSlot(x), createdAt: x.created_at })),
        settings: { announcement: (set.data && set.data.announcement) || "", lockedWeeks: (set.data && set.data.locked_weeks) || [], vapidPublic: (set.data && set.data.vapid_public) || "" },
      };
    },
    async myEmployeeId() { const { data } = await sb.rpc("my_employee_id"); return data; },
    async take(slot, employeeId) {
      const emp = employeeId || (await this.myEmployeeId());
      await run(sb.from("dsp_signups").insert({ employee_id: emp, ...slotRow(slot) }));
    },
    async drop(id) {
      const rows = await run(sb.from("dsp_signups").delete().eq("id", id).select("id"));
      if (!rows || !rows.length) throw friendlyError("Shifts can't be dropped within 48 hours of the start. Talk to your Lead DSP or HR.");
      return {};
    },
    async joinWait(slot) { await run(sb.from("dsp_waitlist").insert({ employee_id: await this.myEmployeeId(), ...slotRow(slot) })); },
    async leaveWait(id) { await run(sb.from("dsp_waitlist").delete().eq("id", id)); },
    async updateMe(patch) {
      const row = {};
      if ("name" in patch) row.name = patch.name;
      if ("teams" in patch) row.teams = patch.teams;
      if ("hasLicense" in patch) row.has_license = patch.hasLicense;
      if ("hasCna" in patch) row.has_cna = patch.hasCna;
      if ("quizTeam" in patch) row.quiz_team = patch.quizTeam;
      await run(sb.from("employees").update(row).eq("user_id", me.userId));
      if ("name" in patch) await sb.from("profiles").update({ name: patch.name }).eq("id", me.userId);
    },
    async setReminders(on) { await run(sb.from("profiles").update({ reminders: on }).eq("id", me.userId)); me = { ...me, reminders: on }; },
    async hrSaveEmployee(emp) {
      await rpc("hr_save_employee", { p_id: emp.id || null, p_name: emp.name, p_level: emp.level, p_target: emp.weeklyTarget, p_teams: emp.teams,
        p_license: emp.hasLicense, p_cna: emp.hasCna, p_active: emp.active !== false, p_hire: emp.hireDate || null });
      ping();
    },
    async listAdmins() { const data = await rpc("admin_people"); return data.filter((p) => p.is_admin).map((p) => p.id); },
    async setAdmin(userId, on) { await rpc("set_admin", { target: userId, make_admin: on }); ping(); },
    async saveTeam(team) {
      const row = { name: team.name, short_name: team.shortName, description: team.description, activities: team.activities,
        needs_license: team.needsLicense, needs: team.needs, staffing: team.staffing || "fixed", color: team.color, active: team.active !== false };
      if (team.id) await run(sb.from("teams").update(row).eq("id", team.id));
      else await run(sb.from("teams").insert({ ...row, key: "team-" + Date.now(), sort: 99 }));
    },
    async saveHome(home) {
      const row = { name: home.name, cluster: home.cluster, location: home.location, residents: home.residents };
      if (home.id) await run(sb.from("homes").update(row).eq("id", home.id));
      else await run(sb.from("homes").insert({ ...row, sort: 99 }));
    },
    async deleteHome(id) { await run(sb.from("homes").delete().eq("id", id)); },
    async saveResident(r) {
      const row = { first_name: r.firstName, home_id: r.homeId || null, own_dsp: !!r.ownDsp, active: r.active !== false };
      if (r.id) await run(sb.from("residents").update(row).eq("id", r.id));
      else await run(sb.from("residents").insert(row));
    },
    async deleteResident(id) { await run(sb.from("residents").delete().eq("id", id)); },
    async ensureClusters(month, reshuffle) { await rpc("generate_clusters", { p_month: month, p_reshuffle: !!reshuffle }); ping(); },
    async saveAnnouncement(text) { await run(sb.from("settings").update({ announcement: text }).eq("id", 1)); },
    async saveVapidPublic(key) { await run(sb.from("settings").update({ vapid_public: key }).eq("id", 1)); },
    async setWeekLock(week, on) { await rpc("hr_set_week_lock", { p_week: week, p_locked: on }); ping(); },
    async publishWeek(week) {
      await rpc("hr_set_week_lock", { p_week: week, p_locked: true }); ping();
      const { data } = await sb.auth.getSession();
      const r = await fetch("/api/publish", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session ? data.session.access_token : ""}` }, body: JSON.stringify({ week }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw friendlyError(`Week locked, but emails didn't send: ${j.error || r.status}`);
      return j;
    },
    async wipeDemo() { const n = await rpc("hr_wipe_demo"); await sb.from("residents").delete().eq("demo", true); ping(); return n; },
    async pushStatus() { return { count: (await rpc("my_push_count")) || 0 }; },
    async savePush(sub) { const j = sub.toJSON(); await rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }); },
    async removePush(endpoint) { await rpc("remove_push_subscription", { p_endpoint: endpoint }); },
    async testPush() {
      const { data } = await sb.auth.getSession();
      const r = await fetch("/api/notify?test=1", { method: "POST", headers: { Authorization: `Bearer ${data.session ? data.session.access_token : ""}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw friendlyError(j.error || "Couldn't send a test alert.");
      return j;
    },
    async signIn(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw friendlyError(error.message);
    },
    async signOut() { await sb.auth.signOut(); me = null; notify(); },
    async hasAdmin() { const { data } = await sb.rpc("has_admin"); return !!data; },
    async claimAdmin() {
      const ok = await rpc("claim_first_admin");
      const { data } = await sb.auth.getSession(); await refreshMe(data.session); notify(); return !!ok;
    },
  };
}

function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDaysD(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
