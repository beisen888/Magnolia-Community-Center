/*
 * Data layer. app.js only talks to the object createBackend() returns, so the app works the same
 * in Preview mode (demo data in this browser) and Live mode (Supabase).
 *
 * load(from, to) → { teams, homes, employees, signups, settings }
 *   teams:     [{ id, key, name, shortName, description, activities[], needsLicense, needs[6], color, sort, active }]
 *   homes:     [{ id, name, cluster, location, residents, sort }]
 *   employees: [{ id, userId, name, email, level, hireDate, weeklyTarget, hasLicense, hasCna, teams[], quizTeam, active, demo }]
 *   signups:   [{ id, employeeId, date, block, teamId }]
 *   settings:  { announcement, lockedMonths[] }
 */
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

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

/* ---------------- shared demo data ---------------- */
function demoTeams() {
  return [
    { id: 1, key: "house", name: "House & Daily Living + Job Coaches", shortName: "House & Daily Living", color: 0, sort: 1, needsLicense: false, needs: [2, 2, 2, 2, 2, 2], active: true,
      description: "Keeps each home running and residents ready for the day, including job prep for Ochsner. Covers nights. No driver's license needed.",
      activities: ["Cooking and meal prep", "Meal assistance (Meals on Wheels)", "Cleaning and housekeeping", "Homeroom", "Daily living skills", "Job prep for Ochsner"] },
    { id: 2, key: "campus", name: "On-Campus Activities", shortName: "On-Campus", color: 1, sort: 2, needsLicense: false, needs: [0, 0, 2, 2, 2, 0], active: true,
      description: "Active days on the 11-acre campus: garden, fitness, sports and crafts. No driver's license needed.",
      activities: ["Music garden", "Campus walks", "Arts and crafts", "Board games", "Fitness center", "Sports and wellness classes"] },
    { id: 3, key: "outings", name: "Community Outings", shortName: "Outings", color: 2, sort: 3, needsLicense: true, needs: [0, 0, 2, 2, 2, 0], active: true,
      description: "Shopping, dining and events around New Orleans. Driver's license required.",
      activities: ["Lakeside Mall", "Library", "Dollar Tree", "Off-campus lunch", "Community events", "Bowling at Colonial Lanes"] },
    { id: 4, key: "learning", name: "Learning & Community", shortName: "Learning", color: 3, sort: 4, needsLicense: false, needs: [0, 0, 2, 2, 2, 0], active: true,
      description: "Calm, on-campus learning: reading, journaling, music and structured classes.",
      activities: ["Storytelling and reading", "Journaling", "Music appreciation", "Structured learning"] },
  ];
}
function demoHomes() {
  return Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Home ${i + 1}`, cluster: "ABCD"[Math.floor(i / 5)], location: i < 5 ? "Campus" : "Community", residents: 6 + ((i + 1) % 3), sort: i + 1 }));
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
function demoSignups(employees, teams, today) {
  const out = []; let id = 1;
  const taken = (d, b, t) => out.filter((s) => s.date === d && s.block === b && s.teamId === t).length;
  employees.forEach((e, idx) => {
    const i = idx + 1;
    for (let k = -14; k <= 20; k++) {
      const d = addDaysD(today, k), dow = d.getDay(), ds = isoDate(d);
      if ((dow === 0 || dow === 6) && i % 3 !== 0) continue;
      const mod = (a, n) => ((a % n) + n) % n;
      if (mod(k + i, 7) === 5 || mod(k + i, 7) === 6) continue;
      const t = e.teams[mod(k + i, e.teams.length)];
      const team = teams.find((x) => x.id === t);
      const b = team.key === "house" && i % 4 === 0 ? 0 : 2 + mod(k + i, 2);
      if (taken(ds, b, t) >= team.needs[b] || taken(ds, b + 1, t) >= team.needs[b + 1]) continue;
      if (out.some((s) => s.employeeId === e.id && s.date === ds && (s.block === b || s.block === b + 1))) continue;
      out.push({ id: id++, employeeId: e.id, date: ds, block: b, teamId: t });
      out.push({ id: id++, employeeId: e.id, date: ds, block: b + 1, teamId: t });
    }
  });
  return out;
}

/* ---------------- Preview: demo data in localStorage ---------------- */
function previewBackend(cfg) {
  const KEY = "magnolia-dsp-preview-v2";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (_) { return null; } };
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (_) {} };
  const seed = () => {
    const teams = demoTeams(), employees = demoEmployees(today);
    return { teams, homes: demoHomes(), employees, signups: demoSignups(employees, teams, today), settings: { announcement: "", lockedMonths: [] }, nextId: 100000, admins: {}, reminders: true };
  };
  let st = read() || seed(); write();
  let notify = () => {};
  const done = () => { write(); notify(); };
  const meEmp = () => st.employees.find((e) => e.userId === "preview-me");
  const checkTake = (date, block, teamId, employeeId) => {
    const team = st.teams.find((t) => t.id === teamId);
    if (!team || !team.needs[block]) throw friendlyError("That team doesn't work this block.");
    if (st.signups.some((s) => s.employeeId === employeeId && s.date === date && s.block === block)) throw friendlyError("Already booked at that time.");
    if (st.signups.filter((s) => s.date === date && s.block === block && s.teamId === teamId).length >= team.needs[block]) throw friendlyError("That shift is already full.");
  };
  return {
    mode: "preview",
    async init(onChange) { notify = onChange; },
    me() { const e = meEmp(); return { userId: "preview-me", email: e ? e.email : "", isAdmin: true, reminders: st.reminders !== false }; },
    async load(from, to) {
      return { teams: st.teams, homes: st.homes, employees: st.employees, settings: st.settings,
        signups: st.signups.filter((s) => s.date >= from && s.date <= to) };
    },
    async take(date, block, teamId, employeeId) {
      const emp = employeeId || meEmp().id;
      checkTake(date, block, teamId, emp);
      st.signups.push({ id: st.nextId++, employeeId: emp, date, block, teamId }); done();
    },
    async drop(id) { st.signups = st.signups.filter((s) => s.id !== id); done(); },
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
    async deleteHome(id) { st.homes = st.homes.filter((h) => h.id !== id); done(); },
    async saveAnnouncement(text) { st.settings.announcement = text; done(); },
    async setLock(month, on) {
      const s = new Set(st.settings.lockedMonths); on ? s.add(month) : s.delete(month);
      st.settings.lockedMonths = [...s]; done();
    },
    async wipeDemo() {
      const ids = new Set(st.employees.filter((e) => e.demo && e.userId !== "preview-me").map((e) => e.id));
      st.employees = st.employees.filter((e) => !ids.has(e.id));
      st.signups = st.signups.filter((s) => !ids.has(s.employeeId)); done(); return ids.size;
    },
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
    if (code === "23505") return friendlyError("You already have a shift at that time.");
    if (code === "42501" || /row-level security/i.test(m)) return friendlyError("Not allowed: you can only take future shifts on your own teams, and not in a month HR has locked.");
    if (/JWT|session/i.test(m)) return friendlyError("Your sign-in expired. Please sign in again.");
    return friendlyError(m || "That didn't save. Check your connection and try again.");
  };
  const toTeam = (t) => ({ id: t.id, key: t.key, name: t.name, shortName: t.short_name || t.name, description: t.description, activities: t.activities || [],
    needsLicense: t.needs_license, needs: t.needs || [0, 0, 0, 0, 0, 0], color: t.color, sort: t.sort, active: t.active });
  const toEmp = (e) => ({ id: e.id, userId: e.user_id, name: e.name, email: e.email, level: e.level, hireDate: e.hire_date, weeklyTarget: e.weekly_target,
    hasLicense: e.has_license, hasCna: e.has_cna, teams: e.teams || [], quizTeam: e.quiz_team, active: e.active, demo: e.demo });

  async function refreshMe(session) {
    if (!session) { me = null; return; }
    const { data } = await sb.from("profiles").select("is_admin,reminders").eq("id", session.user.id).maybeSingle();
    me = { userId: session.user.id, email: session.user.email || "", isAdmin: !!(data && data.is_admin), reminders: !data || data.reminders !== false };
  }
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("dsp");
    for (const table of ["dsp_signups", "employees", "teams", "settings"]) channel.on("postgres_changes", { event: "*", schema: "public", table }, ping);
    channel.subscribe();
  }
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw fail(error); return data; };
  const run = async (q) => { const { error } = await q; if (error) throw fail(error); ping(); };

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
      if (!me) return { teams: [], homes: [], employees: [], signups: [], settings: { announcement: "", lockedMonths: [] } };
      const [t, h, e, s, set] = await Promise.all([
        sb.from("teams").select("*").order("sort"),
        sb.from("homes").select("*").order("sort"),
        sb.from("employees").select("*").order("name"),
        sb.from("dsp_signups").select("id,employee_id,shift_date,block,team_id").gte("shift_date", from).lte("shift_date", to),
        sb.from("settings").select("announcement,locked_months").eq("id", 1).maybeSingle(),
      ]);
      const err = t.error || h.error || e.error || s.error;
      if (err) throw fail(err);
      return {
        teams: t.data.map(toTeam), homes: h.data, employees: e.data.map(toEmp),
        signups: s.data.map((r) => ({ id: r.id, employeeId: r.employee_id, date: r.shift_date, block: r.block, teamId: r.team_id })),
        settings: { announcement: (set.data && set.data.announcement) || "", lockedMonths: (set.data && set.data.locked_months) || [] },
      };
    },
    async take(date, block, teamId, employeeId) {
      let emp = employeeId;
      if (!emp) { const { data } = await sb.rpc("my_employee_id"); emp = data; }
      await run(sb.from("dsp_signups").insert({ employee_id: emp, shift_date: date, block, team_id: teamId }));
    },
    async drop(id) { await run(sb.from("dsp_signups").delete().eq("id", id)); },
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
        needs_license: team.needsLicense, needs: team.needs, color: team.color, active: team.active !== false };
      if (team.id) await run(sb.from("teams").update(row).eq("id", team.id));
      else await run(sb.from("teams").insert({ ...row, key: "team-" + Date.now(), sort: 99 }));
    },
    async saveHome(home) {
      const row = { name: home.name, cluster: home.cluster, location: home.location, residents: home.residents };
      if (home.id) await run(sb.from("homes").update(row).eq("id", home.id));
      else await run(sb.from("homes").insert({ ...row, sort: 99 }));
    },
    async deleteHome(id) { await run(sb.from("homes").delete().eq("id", id)); },
    async saveAnnouncement(text) { await run(sb.from("settings").update({ announcement: text }).eq("id", 1)); },
    async setLock(month, on) { await rpc("hr_set_lock", { p_month: month, p_locked: on }); ping(); },
    async wipeDemo() { const n = await rpc("hr_wipe_demo"); ping(); return n; },
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
