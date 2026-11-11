// Shift alerts: phone push + email backup, about 24 hours and 1 hour before each shift,
// plus "you're off the waitlist" messages. Supabase pings this every 10 minutes (supabase/alerts-cron.sql);
// Vercel's daily cron is a backup. It only ever sends what's due, and logs each alert so nothing goes out twice.
//
//   GET /api/notify            → send what's due (returns counts only)
//   GET /api/notify?dry=1      → list what WOULD send (needs  Authorization: Bearer <CRON_SECRET>)
//   POST /api/notify?test=1    → send a test alert to the signed-in caller's own phone(s)
//
// Vercel env vars: SUPABASE_SECRET_KEY, VAPID_PRIVATE_KEY (from HR → Settings → Phone alerts),
// RESEND_API_KEY (email backup), optional REMINDER_FROM, VAPID_SUBJECT, CRON_SECRET, SITE_URL.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { sendPush, vapidKey } = require("./_webpush");

function loadConfig() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(process.cwd(), "config.js"), "utf8"), sandbox);
  return sandbox.window.MAGNOLIA;
}
const clock = (h, m = 0) => `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h % 24 >= 12 ? "PM" : "AM"}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayLabel = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

function alertText(cfg, a) {
  const b = cfg.blocks[a.block], endBlock = a.next_too && a.block < 5 ? cfg.blocks[a.block + 1] : b;
  const endMin = (endBlock.end * 60) + (a.extra_min || 0);
  const time = `${clock(b.start)}–${clock(Math.floor(endMin / 60), endMin % 60)}`;
  const where = [a.team, a.place].filter(Boolean).join(" · ");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: cfg.timezone || "America/Chicago" });
  const when = a.shift_date === today ? "Today" : "Tomorrow";
  const lead = a.kind === "1h" ? "Your shift starts in about an hour" : `Reminder: you work ${when.toLowerCase()}`;
  const title = a.kind === "1h" ? `Shift at ${clock(b.start)} · ${a.place || a.team}` : `${when}: ${time}`;
  const body = `${dayLabel(a.shift_date)}, ${time} · ${where}${a.extra_min ? " (outing runs about 30 min longer)" : ""}`;
  return { title, body, lead };
}

module.exports = async (req, res) => {
  try {
    const env = process.env, cfg = loadConfig();
    const secret = (env.SUPABASE_SECRET_KEY || "").trim();
    if (!secret) return res.status(500).json({ error: "SUPABASE_SECRET_KEY not set in Vercel" });
    const sbUrl = env.SUPABASE_URL || cfg.supabaseUrl;
    const H = { apikey: secret, "Content-Type": "application/json" };
    if (secret.startsWith("eyJ")) H.Authorization = `Bearer ${secret}`;
    const rpc = async (fn, args = {}) => {
      const r = await fetch(`${sbUrl}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
      if (!r.ok) throw new Error(`${fn}: ${r.status} ${(await r.text()).slice(0, 160)}`);
      const t = await r.text(); return t ? JSON.parse(t) : null;
    };
    const rest = async (q, opt = {}) => { const r = await fetch(`${sbUrl}/rest/v1/${q}`, { headers: H, ...opt }); return r.ok && opt.method !== "DELETE" ? r.json() : r.ok; };
    const site = (env.SITE_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`).replace(/\/$/, "");
    const q = req.query || {};
    const cronOk = env.CRON_SECRET && (req.headers.authorization || "") === `Bearer ${env.CRON_SECRET}`;

    // VAPID keys: public one is saved in the app's settings, private one lives only in Vercel
    let vapid = null;
    const set = await rest("settings?id=eq.1&select=vapid_public");
    const pub = set && set[0] && set[0].vapid_public;
    if (pub && env.VAPID_PRIVATE_KEY) {
      try { vapid = { publicKey: pub, key: vapidKey(pub, env.VAPID_PRIVATE_KEY.trim()), subject: env.VAPID_SUBJECT || "mailto:hr@mcs-nola.org" }; }
      catch (e) { vapid = null; }
    }
    const subsFor = async (userIds) => {
      if (!userIds.length) return [];
      return (await rest(`push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.(${userIds.map(encodeURIComponent).join(",")})`)) || [];
    };
    const pushTo = async (subs, data) => {
      let n = 0;
      for (const s of subs) {
        try {
          const r = await sendPush(s, data, vapid);
          if (r.ok) n++; else if (r.gone) await rest(`push_subscriptions?id=eq.${s.id}`, { method: "DELETE" });
        } catch (_) {}
      }
      return n;
    };
    const email = async (to, subject, text, html) => {
      if (!env.RESEND_API_KEY || !to) return false;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.REMINDER_FROM || "Magnolia Schedule <onboarding@resend.dev>", to: [to], subject, text, html }) });
      return r.ok;
    };
    const mail = (name, lead, line) => ({
      text: `Hi ${(name || "").split(" ")[0] || "there"},\n\n${lead}:\n${line}\n\nCan't make it? Talk to your Lead DSP or HR.\n${site}/#home\n\n— ${cfg.orgName}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1F2A20;max-width:520px"><p style="font-family:Georgia,serif;font-size:24px;color:#29572D;margin:0 0 14px">Magnolia</p>
        <p style="margin:0 0 8px">Hi ${esc((name || "").split(" ")[0] || "there")},</p><p style="margin:0 0 6px">${esc(lead)}:</p>
        <p style="font-size:17px;margin:0 0 16px"><b>${esc(line)}</b></p>
        <p><a href="${site}/#home" style="background:#29572D;color:#fff;padding:10px 16px;border-radius:5px;text-decoration:none;font-weight:bold">Open my schedule</a></p>
        <p style="font-size:13px;color:#4A4E57">Can't make it? Talk to your Lead DSP or HR.</p></div>`,
    });

    // ---- test alert to the caller's own devices ----
    if (q.test) {
      const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const who = await fetch(`${sbUrl}/auth/v1/user`, { headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}` } });
      if (!who.ok) return res.status(401).json({ error: "Please sign in again." });
      const user = await who.json();
      if (!vapid) return res.status(200).json({ pushed: 0, error: pub ? "VAPID_PRIVATE_KEY is missing or doesn't match. Add it in Vercel and redeploy." : "HR hasn't set up phone alerts yet (HR → Settings)." });
      const pushed = await pushTo(await subsFor([user.id]), { title: "Test alert from Magnolia", body: "Phone alerts are working. You'll get one 24 hours and 1 hour before each shift.", url: "/#home" });
      return res.status(200).json({ pushed });
    }

    // ---- scheduled run ----
    const dry = q.dry && cronOk;
    if (q.dry && !cronOk) return res.status(401).json({ error: "dry run needs Authorization: Bearer <CRON_SECRET>" });
    const due = (await rpc("dsp_due_alerts")) || [];
    const msgs = (await rpc("dsp_pending_messages")) || [];
    if (dry) return res.status(200).json({ push: !!vapid, email: !!env.RESEND_API_KEY, due: due.map((a) => ({ to: a.email, kind: a.kind, ...alertText(cfg, a) })), messages: msgs.map((m) => ({ to: m.email, title: m.title })) });

    // mark first so two overlapping runs can't double-send
    if (due.length) await rpc("dsp_mark_alerts", { p_ids: due.map((a) => a.signup_id), p_kinds: due.map((a) => a.kind) });
    if (msgs.length) await rpc("dsp_mark_messages", { p_ids: msgs.map((m) => m.id) });
    const users = [...new Set([...due, ...msgs].map((x) => x.user_id).filter(Boolean))];
    const subs = vapid ? await subsFor(users) : [];
    let pushed = 0, emailed = 0;
    for (const a of due) {
      const t = alertText(cfg, a), mine = subs.filter((s) => s.user_id === a.user_id);
      const p = mine.length ? await pushTo(mine, { title: t.title, body: t.body, url: "/#home", tag: `shift-${a.signup_id}` }) : 0;
      pushed += p;
      // email backup: always for the day-before alert; for the 1-hour alert only if no phone got it
      if (a.reminders && (a.kind === "24h" || !p)) { const m = mail(a.name, t.lead, t.body); if (await email(a.email, t.title, m.text, m.html)) emailed++; }
    }
    for (const m of msgs) {
      const mine = subs.filter((s) => s.user_id === m.user_id);
      pushed += mine.length ? await pushTo(mine, { title: m.title, body: m.body, url: "/#home" }) : 0;
      const e = mail(m.name, m.title, m.body);
      if (await email(m.email, m.title, e.text, e.html)) emailed++;
    }
    res.status(200).json({ alerts: due.length, messages: msgs.length, pushed, emailed, push: !!vapid });
  } catch (e) {
    res.status(500).json({ error: "crash", message: String(e && e.message).slice(0, 200) });
  }
};
module.exports.alertText = alertText;
