// Nightly reminder emails. Vercel runs this on the schedule in vercel.json (crons).
// Needs these Vercel environment variables (Project → Settings → Environment Variables):
//   RESEND_API_KEY        from resend.com → API Keys
//   SUPABASE_SECRET_KEY   from Supabase → Project Settings → API Keys → Secret key (sb_secret_…)
//   CRON_SECRET           any long random text; Vercel sends it automatically with cron calls
// Optional: REMINDER_FROM ("Magnolia <shifts@yourdomain.org>", needs a verified domain in Resend),
//           SITE_URL (defaults to the request's host).
// Manual test: GET /api/remind?dry=1 with header  Authorization: Bearer <CRON_SECRET>
//              add &date=2026-11-12 to preview a specific day.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadConfig() {
  const src = fs.readFileSync(path.join(process.cwd(), "config.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  return sandbox.window.MAGNOLIA;
}

function orgDate(offsetDays, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(parts + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const hr = (h) => `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLORS = ["#2E7A58", "#BC3F69", "#2D69AC", "#A0660A", "#6A50B0"];

function buildEmail({ cfg, groups, date, person, site }) {
  const LETTERS = "ABCDE";
  const groupAt = (lane, hour) => (((lane + (hour - cfg.dayStart)) % 5) + 5) % 5;
  const nice = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const blocks = person.shifts.map((s) => {
    const sh = cfg.shifts.find((x) => x.id === s.shift_id);
    if (!sh) return null;
    const rows = [];
    for (let h = sh.start; h < sh.end; h++) {
      const g = groupAt(s.lane, h);
      rows.push({ h, g });
    }
    return { sh, lane: s.lane, rows };
  }).filter(Boolean);
  const first = blocks[0];
  const subject = `Reminder: you're on ${first.sh.label.toLowerCase()} shift tomorrow (${hr(first.sh.start)})`;
  const text = [`Hi ${person.name || "there"},`, "", `You're scheduled ${nice}:`, ""]
    .concat(...blocks.map((b) => [`${b.sh.label}, ${hr(b.sh.start)}–${hr(b.sh.end)} · lane ${b.lane + 1}`, ...b.rows.map((r) => `  ${hr(r.h)}: ${LETTERS[r.g]} · ${groups[r.g]}`), ""]))
    .concat([`Can't make it? Drop your shift so someone on the waitlist gets it: ${site}/#day-${date}`, "", `— ${cfg.orgName} ${cfg.boardName}`]).join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#13201B;max-width:480px">
  <p style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#55665E;margin:0">${esc(cfg.orgName)} ${esc(cfg.boardName)}</p>
  <h2 style="margin:4px 0 12px">See you tomorrow, ${esc(person.name || "volunteer")}</h2>
  <p style="margin:0 0 16px;color:#55665E">${esc(nice)}</p>
  ${blocks.map((b) => `<div style="border:1px solid #D5DFD9;border-radius:10px;padding:12px 14px;margin-bottom:12px">
    <b>${esc(b.sh.label)}</b> · ${hr(b.sh.start)}–${hr(b.sh.end)} · lane ${b.lane + 1}
    <table style="margin-top:8px;border-collapse:collapse">${b.rows.map((r) => `<tr><td style="padding:2px 10px 2px 0;font-family:monospace;color:#55665E">${hr(r.h)}</td><td><span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:5px;color:#fff;font:12px monospace;background:${COLORS[r.g]}">${LETTERS[r.g]}</span> ${esc(groups[r.g])}</td></tr>`).join("")}</table></div>`).join("")}
  <p style="margin:16px 0"><a href="${site}/#day-${date}" style="background:#1F4D3D;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none;font-weight:600">Open the board</a></p>
  <p style="font-size:13px;color:#55665E">Can't make it? Drop your shift on the board so the next person on the waitlist gets it. You can turn these emails off on the My schedule tab.</p></div>`;
  return { subject, text, html };
}

module.exports = async (req, res) => {
  const env = process.env;
  const auth = req.headers.authorization || "";
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) return res.status(401).json({ error: "unauthorized" });
  if (!env.SUPABASE_SECRET_KEY) return res.status(500).json({ error: "SUPABASE_SECRET_KEY not set" });
  const dry = req.query && (req.query.dry === "1" || req.query.dry === "true");
  if (!dry && !env.RESEND_API_KEY) return res.status(500).json({ error: "RESEND_API_KEY not set" });

  const cfg = loadConfig();
  const sbUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || cfg.supabaseUrl;
  const tz = cfg.timezone || "America/Chicago";
  const date = (req.query && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") && req.query.date) || orgDate(1, tz);
  const site = (env.SITE_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`).replace(/\/$/, "");
  const key = env.SUPABASE_SECRET_KEY.trim();
  // New-style sb_secret_ keys go only in the apikey header; legacy JWT service_role keys also need Authorization.
  const sbHeaders = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) sbHeaders.Authorization = `Bearer ${key}`;

  const [listRes, setRes] = await Promise.all([
    fetch(`${sbUrl}/rest/v1/rpc/reminder_list`, { method: "POST", headers: sbHeaders, body: JSON.stringify({ day: date }) }),
    fetch(`${sbUrl}/rest/v1/settings?id=eq.1&select=groups`, { headers: sbHeaders }),
  ]);
  if (!listRes.ok) {
    // Safe diagnostics: the key's type and length only, never the key itself.
    const shape = { type: key.startsWith("sb_secret_") ? "sb_secret" : key.startsWith("sb_publishable_") ? "publishable (wrong key)" : key.startsWith("eyJ") ? "legacy JWT" : "unknown",
      length: key.length, hasDots: /[•·]/.test(key), hasSpaces: /\s/.test(key) };
    return res.status(502).json({ error: "supabase", detail: await listRes.text(), keyShape: shape });
  }
  const list = await listRes.json();
  const settings = setRes.ok ? await setRes.json() : [];
  const groups = (settings[0] && settings[0].groups) || cfg.defaultGroups;

  const people = {};
  for (const r of list) (people[r.email] ||= { email: r.email, name: r.name, shifts: [] }).shifts.push(r);

  const results = [];
  for (const person of Object.values(people)) {
    const mail = buildEmail({ cfg, groups, date, person, site });
    if (dry) { results.push({ to: person.email, subject: mail.subject, preview: mail.text }); continue; }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.REMINDER_FROM || `${cfg.orgName} Shifts <onboarding@resend.dev>`, to: [person.email], subject: mail.subject, text: mail.text, html: mail.html }),
    });
    results.push({ to: person.email, ok: r.ok, status: r.status, error: r.ok ? undefined : (await r.text()).slice(0, 200) });
  }
  res.status(200).json({ date, dry, count: results.length, results });
};

module.exports.buildEmail = buildEmail;
module.exports.orgDate = orgDate;
