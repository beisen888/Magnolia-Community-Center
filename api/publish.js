// "Publish & email": HR locks a week in the app, then this emails every DSP their final schedule for it.
// Called from the HR tab with the signed-in user's access token; only HR admins are allowed.
// Needs Vercel env vars: SUPABASE_SECRET_KEY, RESEND_API_KEY (optional: REMINDER_FROM).
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadConfig() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(process.cwd(), "config.js"), "utf8"), sandbox);
  return sandbox.window.MAGNOLIA;
}
const hr = (h) => `${h % 12 || 12} ${h % 24 >= 12 ? "PM" : "AM"}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const day = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

function buildEmail(cfg, week, person, site) {
  // merge back-to-back blocks on the same team and day into one line
  const runs = [];
  for (const s of person.shifts) {
    const last = runs[runs.length - 1];
    if (last && last.date === s.shift_date && last.team === s.team && last.end === s.block) last.end = s.block + 1;
    else runs.push({ date: s.shift_date, team: s.team, start: s.block, end: s.block + 1 });
  }
  const hours = person.shifts.length * 4;
  const time = (r) => `${hr(cfg.blocks[r.start].start)}–${hr(cfg.blocks[r.end - 1].end)}`;
  const weekLabel = new Date(week + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  const subject = `Your schedule for the week of ${weekLabel} (${hours} hrs)`;
  const text = [`Hi ${(person.name || "").split(" ")[0] || "there"},`, "", `Here is your final schedule for the week of ${weekLabel}:`, "",
    ...runs.map((r) => `${day(r.date)}: ${time(r)} · ${r.team}`), "", `Total: ${hours} hours`, "",
    `Questions or a conflict? Talk to your Lead DSP or HR.`, `View it anytime: ${site}/#home`, "", `— ${cfg.orgName}`].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1F2A20;max-width:520px">
  <p style="font-family:Georgia,serif;font-size:26px;color:#29572D;margin:0">Magnolia</p>
  <p style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6B4A2E;margin:2px 0 18px">Community Services · DSP Schedule</p>
  <p style="margin:0 0 6px">Hi ${esc((person.name || "").split(" ")[0] || "there")},</p>
  <p style="margin:0 0 16px">Here is your <b>final schedule</b> for the week of ${esc(weekLabel)}.</p>
  <table style="border-collapse:collapse;width:100%;font-size:15px">${runs.map((r) => `<tr><td style="padding:9px 10px;border-bottom:1px solid #E3DCC4;font-weight:bold;white-space:nowrap">${esc(day(r.date))}</td><td style="padding:9px 10px;border-bottom:1px solid #E3DCC4;white-space:nowrap">${time(r)}</td><td style="padding:9px 10px;border-bottom:1px solid #E3DCC4;color:#4A4E57">${esc(r.team)}</td></tr>`).join("")}</table>
  <p style="margin:14px 0;font-size:15px"><b>Total: ${hours} hours</b></p>
  <p style="margin:18px 0"><a href="${site}/#home" style="background:#29572D;color:#fff;padding:10px 16px;border-radius:5px;text-decoration:none;font-weight:bold">Open my schedule</a></p>
  <p style="font-size:13px;color:#4A4E57">Questions or a conflict? Talk to your Lead DSP or HR.</p></div>`;
  return { subject, text, html };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const env = process.env, cfg = loadConfig();
    const secret = (env.SUPABASE_SECRET_KEY || "").trim();
    if (!secret) return res.status(500).json({ error: "SUPABASE_SECRET_KEY not set in Vercel" });
    if (!env.RESEND_API_KEY) return res.status(500).json({ error: "RESEND_API_KEY not set in Vercel" });
    const sbUrl = env.SUPABASE_URL || cfg.supabaseUrl;
    const sbHeaders = { apikey: secret, "Content-Type": "application/json" };
    if (secret.startsWith("eyJ")) sbHeaders.Authorization = `Bearer ${secret}`;

    // who is calling? must be a signed-in HR admin
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const who = await fetch(`${sbUrl}/auth/v1/user`, { headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}` } });
    if (!who.ok) return res.status(401).json({ error: "Please sign in again." });
    const user = await who.json();
    const prof = await fetch(`${sbUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_admin`, { headers: sbHeaders });
    const rows = prof.ok ? await prof.json() : [];
    if (!rows[0] || !rows[0].is_admin) return res.status(403).json({ error: "HR only." });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const week = String(body.week || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return res.status(400).json({ error: "Bad week." });

    const list = await fetch(`${sbUrl}/rest/v1/rpc/dsp_week_schedule`, { method: "POST", headers: sbHeaders, body: JSON.stringify({ ws: week }) });
    if (!list.ok) return res.status(502).json({ error: "Couldn't read the schedule.", detail: (await list.text()).slice(0, 200) });
    const people = {};
    for (const r of await list.json()) (people[r.email] ||= { email: r.email, name: r.name, shifts: [] }).shifts.push(r);

    const site = (env.SITE_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`).replace(/\/$/, "");
    let sent = 0; const failed = [];
    for (const p of Object.values(people)) {
      const m = buildEmail(cfg, week, p, site);
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.REMINDER_FROM || "Magnolia Schedule <onboarding@resend.dev>", to: [p.email], subject: m.subject, text: m.text, html: m.html }),
      });
      if (r.ok) sent++; else failed.push({ to: p.email, status: r.status, error: (await r.text()).slice(0, 160) });
    }
    res.status(200).json({ week, people: Object.keys(people).length, sent, failed });
  } catch (e) {
    res.status(500).json({ error: "crash", message: String(e && e.message).slice(0, 200) });
  }
};
module.exports.buildEmail = buildEmail;
