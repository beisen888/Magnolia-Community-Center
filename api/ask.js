// Magnolia Helper: answers "how do I…" questions with Claude when the FAQ in help.js doesn't cover them.
// Off until the Vercel env var ANTHROPIC_API_KEY is set (the chat then sticks to the FAQ).
// Only signed-in staff can use it. The help.js knowledge base is sent as background, so answers stay about this app.
// Optional env vars: ASK_MODEL (default claude-haiku-5-5).
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load(file, key) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(process.cwd(), file), "utf8"), sandbox);
  return sandbox.window[key];
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const env = process.env, key = (env.ANTHROPIC_API_KEY || "").trim();
    if (!key) return res.status(200).json({ off: true });
    const cfg = load("config.js", "MAGNOLIA"), kb = load("help.js", "MAGNOLIA_HELP");

    // signed-in staff only
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const sbUrl = env.SUPABASE_URL || cfg.supabaseUrl, anon = env.SUPABASE_ANON_KEY || cfg.supabaseAnonKey;
    if (!token) return res.status(401).json({ error: "Sign in to ask questions." });
    const who = await fetch(`${sbUrl}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    if (!who.ok) return res.status(401).json({ error: "Please sign in again." });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const msgs = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 1200) }));
    while (msgs.length && msgs[0].role !== "user") msgs.shift();
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") return res.status(400).json({ error: "No question." });
    const isHr = body.role === "hr";

    const facts = kb.faqs.filter((f) => isHr || f.role !== "hr")
      .map((f) => `Q: ${f.q}\nA: ${f.a}${f.go ? `\n[open: ${f.go.join(",")}]` : ""}`).join("\n\n");
    const system = `You are the Magnolia Helper, a friendly assistant inside ${cfg.orgName}'s DSP Schedule app. Staff are Direct Support Professionals (DSPs) who support adults with intellectual and developmental disabilities, and the HR team that schedules them.
The person asking is ${isHr ? "on the HR team" : "a DSP"}${body.name ? ` named ${String(body.name).slice(0, 40)}` : ""}.

Answer only questions about using this app, its scheduling rules, and the job of picking and changing shifts. Use only the facts below; if they don't cover it, say you're not sure and suggest asking their Lead DSP or HR. Never make up features, policies, pay, or dates.
Style: plain, warm, short. 1–3 sentences or up to 4 numbered steps. Bold button names with **double asterisks**. No headings, no emoji.
Never give medical, legal, or HR-policy advice, and never ask for or repeat personal details about residents.
If one part of the app is the place to go, end with a final line exactly like: [open: schedule] (use one value from the [open: …] tags in the facts).

App facts:
Shifts are 4-hour blocks: 12–4 AM, 4–8 AM, 8 AM–12 PM, 12–4 PM, 4–8 PM, 8 PM–12 AM; two in a row make 8 hours. DSPs pick up to 3 weeks ahead on their own teams. Teams: House & Daily Living (one house, 2 DSPs per house per shift, covers nights), On-Campus Activities, Community Outings (driver's license, one cluster), Learning & Community. 15 resident clusters of 8 or fewer, the same each month.

${facts}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.ASK_MODEL || "claude-haiku-5-5", max_tokens: 400, system, messages: msgs }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: "The helper couldn't answer right now.", detail: j.error && j.error.type });
    let answer = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
    let go = null;
    const m = answer.match(/\n?\[open:\s*([a-z,]+)\]\s*$/i);
    if (m) { go = m[1].toLowerCase(); answer = answer.slice(0, m.index).trim(); }
    res.status(200).json({ answer, go });
  } catch (e) {
    res.status(500).json({ error: "The helper couldn't answer right now." });
  }
};
