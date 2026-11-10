/*
 * Data layer. The UI (app.js) only talks to the object returned by createBackend(),
 * so the board works the same in Preview mode (browser-only demo) and Live mode (Supabase).
 *
 * Backend shape:
 *   mode            "preview" | "live"
 *   init(onChange)  start up; onChange() is called whenever data or login changes
 *   me()            { id, email, name, isAdmin } or null when signed out
 *   load(from, to)  { rows: [{ date, shiftId, lane, userId, name, at }], groups: [..5] }
 *   take(date, shiftId, lane), drop(date, shiftId, userId?), setName(name), saveGroups(list)
 *   signIn(email), signOut()
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
  } catch (_) { /* no Vercel function (local file or plain server) — fine */ }
  return cfg;
}

async function createBackend() {
  const cfg = await resolveConfig();
  if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
    try { return await supabaseBackend(cfg); }
    catch (e) { console.warn("Supabase unavailable, falling back to preview", e); }
  }
  return previewBackend(cfg);
}

/* ---------------- Preview: demo data in localStorage ---------------- */
function previewBackend(cfg) {
  const KEY = "magnolia-preview-v1";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (_) { return null; } };
  const write = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} };
  let st = read();
  if (!st) { st = seedDemo(cfg); write(st); }
  let notify = () => {};
  const ME = "local-me";
  const fail = (msg) => { const e = new Error(msg); e.friendly = msg; throw e; };

  return {
    mode: "preview",
    async init(onChange) { notify = onChange; },
    me() { return { id: ME, email: "", name: st.myName || "", isAdmin: true }; },
    async load(from, to) {
      const rows = st.rows.filter((r) => r.date >= from && r.date <= to)
        .map((r) => ({ ...r, name: r.userId === ME ? (st.myName || "You") : r.name }));
      return { rows, groups: st.groups };
    },
    async take(date, shiftId, lane) {
      if (st.rows.some((r) => r.date === date && r.shiftId === shiftId && r.lane === lane && r.userId !== ME)) fail("Someone already has that lane. Pick another.");
      const mine = st.rows.find((r) => r.date === date && r.shiftId === shiftId && r.userId === ME);
      if (mine) { mine.lane = lane; mine.at = Date.now(); }
      else st.rows.push({ date, shiftId, lane, userId: ME, name: "", at: Date.now() });
      write(st); notify();
    },
    async drop(date, shiftId, userId = ME) {
      st.rows = st.rows.filter((r) => !(r.date === date && r.shiftId === shiftId && r.userId === userId));
      write(st); notify();
    },
    async setName(name) { st.myName = name; write(st); notify(); },
    async saveGroups(list) { st.groups = list; write(st); notify(); },
    async signIn() {}, async signOut() {},
    async hasAdmin() { return true; },
    async claimAdmin() { return false; },
    async listPeople() {
      const names = [...new Set(st.rows.filter((r) => r.userId !== ME).map((r) => r.name))];
      st.admins ||= {};
      return [{ id: ME, name: st.myName || "You", email: "you@example.com", isAdmin: true },
        ...names.map((n) => ({ id: "demo-" + n, name: n, email: n.toLowerCase() + "@example.com", isAdmin: !!st.admins["demo-" + n] }))];
    },
    async setAdmin(id, on) { st.admins ||= {}; st.admins[id] = on; write(st); },
    resetDemo() { st = seedDemo(cfg); write(st); notify(); },
  };
}

function seedDemo(cfg) {
  const people = ["Ana", "Cara", "Dev", "Eli", "Maya", "Jo", "Sam"];
  const rows = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let seed = 7;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 40; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    if (!cfg.workdays.includes(d.getDay())) continue;
    const date = isoDate(d);
    for (const sh of cfg.shifts) {
      const n = Math.floor(rand() * 5); // 0–4 lanes filled, so there are always gaps to show
      const lanes = [0, 1, 2, 3, 4].sort(() => rand() - 0.5).slice(0, n);
      lanes.forEach((lane, j) => {
        const name = people[(i + j + lane) % people.length];
        if (rows.some((r) => r.date === date && r.shiftId === sh.id && r.name === name)) return;
        rows.push({ date, shiftId: sh.id, lane, userId: "demo-" + name, name, at: 0 });
      });
    }
  }
  return { rows, groups: [...cfg.defaultGroups], myName: "" };
}

/* ---------------- Live: Supabase ---------------- */
async function supabaseBackend(cfg) {
  const { createClient } = await import(SUPABASE_CDN);
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  let me = null, notify = () => {}, timer = null, channel = null;
  const ping = () => { clearTimeout(timer); timer = setTimeout(() => notify(), 120); };

  const friendly = (error) => {
    const code = error && error.code;
    let msg = "That didn't save. Check your connection and try again.";
    if (code === "23505") msg = "Someone grabbed that lane a moment ago. Pick another.";
    else if (code === "42501") msg = "You don't have permission for that (past dates can't be changed).";
    else if (error && /JWT|session/i.test(error.message || "")) msg = "Your sign-in expired. Please sign in again.";
    const e = new Error(msg); e.friendly = msg; e.cause = error; return e;
  };

  async function refreshMe(session) {
    if (!session) { me = null; return; }
    const u = session.user;
    const { data } = await sb.from("profiles").select("name,is_admin").eq("id", u.id).maybeSingle();
    me = { id: u.id, email: u.email || "", name: (data && data.name) || "", isAdmin: !!(data && data.is_admin) };
  }

  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("board")
      .on("postgres_changes", { event: "*", schema: "public", table: "signups" }, ping)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, ping)
      .subscribe();
  }

  return {
    mode: "live",
    async init(onChange) {
      notify = onChange;
      const { data } = await sb.auth.getSession();
      await refreshMe(data.session);
      sb.auth.onAuthStateChange((_evt, session) => {
        // Supabase recommends not awaiting inside this callback.
        setTimeout(async () => { await refreshMe(session); subscribe(); notify(); }, 0);
      });
      subscribe();
    },
    me() { return me; },
    async load(from, to) {
      const settings = await sb.from("settings").select("groups").eq("id", 1).maybeSingle();
      const groups = (settings.data && settings.data.groups) || cfg.defaultGroups;
      if (me) {
        const { data, error } = await sb.from("signups")
          .select("shift_date,shift_id,lane,user_id,created_at,profiles(name)")
          .gte("shift_date", from).lte("shift_date", to);
        if (error) throw friendly(error);
        return { groups, rows: data.map((r) => ({
          date: r.shift_date, shiftId: r.shift_id, lane: r.lane, userId: r.user_id,
          name: (r.profiles && r.profiles.name) || "Volunteer", at: Date.parse(r.created_at) || 0,
        })) };
      }
      const { data, error } = await sb.from("lane_status").select("shift_date,shift_id,lane")
        .gte("shift_date", from).lte("shift_date", to);
      if (error) throw friendly(error);
      return { groups, rows: data.map((r, i) => ({
        date: r.shift_date, shiftId: r.shift_id, lane: r.lane, userId: "anon-" + i, name: "Volunteer", at: 0,
      })) };
    },
    async take(date, shiftId, lane) {
      if (!me) throw friendly({ message: "session" });
      const { data: existing } = await sb.from("signups").select("id")
        .eq("user_id", me.id).eq("shift_date", date).eq("shift_id", shiftId).maybeSingle();
      const q = existing
        ? sb.from("signups").update({ lane, created_at: new Date().toISOString() }).eq("id", existing.id)
        : sb.from("signups").insert({ shift_date: date, shift_id: shiftId, lane });
      const { error } = await q;
      if (error) throw friendly(error);
      ping();
    },
    async drop(date, shiftId, userId) {
      const { error } = await sb.from("signups").delete()
        .eq("user_id", userId || me.id).eq("shift_date", date).eq("shift_id", shiftId);
      if (error) throw friendly(error);
      ping();
    },
    async setName(name) {
      const { error } = await sb.from("profiles").update({ name }).eq("id", me.id);
      if (error) throw friendly(error);
      me = { ...me, name }; ping();
    },
    async saveGroups(list) {
      const { error } = await sb.from("settings").update({ groups: list }).eq("id", 1);
      if (error) throw friendly(error);
      ping();
    },
    async signIn(email) {
      const { error } = await sb.auth.signInWithOtp({
        email, options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) { const e = new Error(error.message); e.friendly = error.message; throw e; }
    },
    async signOut() { await sb.auth.signOut(); me = null; notify(); },
    async hasAdmin() { const { data } = await sb.rpc("has_admin"); return !!data; },
    async claimAdmin() {
      const { data, error } = await sb.rpc("claim_first_admin");
      if (error) throw friendly(error);
      const { data: sess } = await sb.auth.getSession(); await refreshMe(sess.session); notify();
      return !!data;
    },
    async listPeople() {
      const { data, error } = await sb.rpc("admin_people");
      if (error) throw friendly(error);
      return data.map((p) => ({ id: p.id, name: p.name || "", email: p.email || "", isAdmin: p.is_admin, joined: p.created_at }));
    },
    async setAdmin(id, on) {
      const { error } = await sb.rpc("set_admin", { target: id, make_admin: on });
      if (error) { const e = new Error(error.message); e.friendly = error.message; throw e; }
    },
  };
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
