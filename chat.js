/* Magnolia Helper: the chat bubble in the bottom right.
 * Answers come from help.js right away. When the site has an Anthropic key (Vercel env var ANTHROPIC_API_KEY),
 * questions the FAQ can't answer go to /api/ask, which asks Claude. Talks to the app only through window.MagnoliaApp. */
(() => {
const KB = window.MAGNOLIA_HELP || { faqs: [], starters: {} };
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
const app = () => window.MagnoliaApp || { me: () => ({}), go: () => {}, token: async () => "" };
const STOP = new Set("a an the i my me to do how can what is are of on in for it at and or be with you your this that where why when does dont don't someone somebody something anyone get got want need please m s t ll ve d im".split(" "));
const words = (s) => s.toLowerCase().replace(/[^a-z0-9: ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
const stem = (w) => w.replace(/(ing|ed|es|s)$/, "");

let open = false, busy = false, aiOk = null;
const log = [];   // {who:"bot"|"me", html}
const history = [];   // {role, content} sent to /api/ask

function role() { const m = app().me(); return m.isAdmin ? "hr" : "dsp"; }
function forMe(f) { return f.role === "all" || f.role === role() || (role() === "hr"); }
function search(q) {
  const qs = words(q).map(stem); if (!qs.length) return [];
  const mine = /\b(i|i'm|im|my|me|mine)\b/i.test(q);   // "I", "my": about their own shifts, not HR work
  return KB.faqs.filter(forMe).map((f) => {
    const keys = new Set(words(f.keys + " " + f.q).map(stem));
    let s = 0; for (const w of qs) if (keys.has(w)) s += w.length > 3 ? 2 : 1;
    if (f.role === role()) s += 0.5;
    if (mine && f.role !== "hr") s += 1.5;
    return { f, s };
  }).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s);
}

function goBtn(f) {
  if (!f.go) return "";
  const label = { home: "My week", schedule: "Schedule", teams: "Teams & clusters", quiz: "Find my team", hr: "HR" }[f.go[0]] || "Open";
  const sub = f.go[1] ? { temps: "Temps needed", coverage: "Coverage", people: "Employees", residents: "Residents & clusters", teams: "Teams & staffing" }[f.go[1]] : "";
  return `<button class="mh-go" data-go="${esc(f.go.join(","))}">Open ${esc(sub || label)} →</button>`;
}
function say(who, html) { log.push({ who, html }); paint(); }
function answerFaq(f) { say("bot", `<b class="mh-q">${esc(f.q)}</b>${fmt(f.a)}${goBtn(f)}`); history.push({ role: "assistant", content: f.a }); }

async function ask(q) {
  q = q.trim(); if (!q || busy) return;
  say("me", esc(q)); history.push({ role: "user", content: q });
  const hits = search(q);
  if (hits.length && (hits[0].s >= 4 || aiOk === false)) {
    answerFaq(hits[0].f);
    if (hits[1] && hits[1].s >= 4) say("bot", `Also related: ${hits.slice(1, 3).map((h) => `<button class="mh-chip sm" data-faq="${h.f.id}">${esc(h.f.q)}</button>`).join(" ")}`);
    return;
  }
  if (aiOk !== false) {
    busy = true; paint(true);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await app().token()}` },
        body: JSON.stringify({ messages: history.slice(-8), role: role(), name: app().me().name || "" }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.answer) {
        busy = false; aiOk = true; history.push({ role: "assistant", content: j.answer });
        const go = j.go && KB.faqs.find((f) => f.go && f.go.join(",") === j.go);
        return say("bot", fmt(j.answer) + (go ? goBtn(go) : ""));
      }
      if (j.off) aiOk = false;
    } catch (_) { aiOk = false; }
    busy = false;
  }
  if (hits.length) return answerFaq(hits[0].f);
  say("bot", `I'm not sure about that one. These might help:<div class="mh-chips">${starters().slice(0, 3).map((f) => `<button class="mh-chip sm" data-faq="${f.id}">${esc(f.q)}</button>`).join("")}</div><span class="mh-small">Still stuck? Ask your Lead DSP or HR.</span>`);
}
const starters = () => (KB.starters[role()] || []).map((id) => KB.faqs.find((f) => f.id === id)).filter(Boolean);

/* ---------- UI ---------- */
const root = document.createElement("div");
root.className = "mh";
root.innerHTML = `
<button class="mh-fab" aria-label="Open Magnolia Helper" aria-expanded="false">
  <span class="mh-ring" aria-hidden="true"></span>
  <svg class="mh-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z" fill="currentColor"/><circle cx="8.5" cy="9.5" r="1.2" fill="#29572D"/><circle cx="12" cy="9.5" r="1.2" fill="#29572D"/><circle cx="15.5" cy="9.5" r="1.2" fill="#29572D"/></svg>
  <svg class="mh-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
  <span class="mh-live" aria-hidden="true"></span>
</button>
<section class="mh-panel" role="dialog" aria-label="Magnolia Helper" hidden>
  <header class="mh-head">
    <span class="mh-av" aria-hidden="true"><svg viewBox="0 0 40 44"><path d="M19 26v14M19 31l-5-4M19 29l5-4" stroke="#F3EDD6" stroke-width="2.6" stroke-linecap="round" fill="none"/><circle cx="19" cy="15" r="13" fill="#F3EDD6"/><circle cx="12" cy="11" r="4.2" fill="#497A39"/><circle cx="25" cy="18" r="4.6" fill="#497A39"/><circle cx="17.5" cy="19" r="2" fill="#DEA710"/></svg></span>
    <div><b>Magnolia Helper</b><span class="mh-status"><i></i>Online · answers in seconds</span></div>
    <button class="mh-close" aria-label="Close helper">×</button>
  </header>
  <div class="mh-log" aria-live="polite"></div>
  <form class="mh-form"><input class="mh-in" maxlength="300" placeholder="Ask how to do something…" aria-label="Your question" autocomplete="off"><button class="mh-send" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6 16-2.5-6.5L4 12Z" fill="currentColor"/></svg></button></form>
</section>`;
document.body.appendChild(root);
const fab = $(".mh-fab", root), panel = $(".mh-panel", root), logEl = $(".mh-log", root), input = $(".mh-in", root);

function welcome() {
  const m = app().me(), first = (m.name || "").split(" ")[0];
  return `<b class="mh-q">Hi${first ? " " + esc(first) : ""}! I'm the Magnolia Helper.</b>Ask me how to do anything in the schedule, or tap a common question:<div class="mh-chips">${starters().map((f) => `<button class="mh-chip" data-faq="${f.id}">${esc(f.q)}</button>`).join("")}</div>`;
}
function paint(typing) {
  logEl.innerHTML = `<div class="mh-msg bot">${welcome()}</div>` + log.map((m) => `<div class="mh-msg ${m.who}">${m.html}</div>`).join("") +
    (typing || busy ? `<div class="mh-msg bot mh-typing" aria-label="Typing"><i></i><i></i><i></i></div>` : "");
  logEl.scrollTop = logEl.scrollHeight;
}
function toggle(on) {
  open = on ?? !open; panel.hidden = !open; root.classList.toggle("is-open", open);
  fab.setAttribute("aria-expanded", String(open)); fab.setAttribute("aria-label", open ? "Close Magnolia Helper" : "Open Magnolia Helper");
  if (open) { paint(); setTimeout(() => input.focus(), 60); try { localStorage.setItem("mh-seen", "1"); } catch (_) {} root.classList.remove("nudge"); }
}
fab.addEventListener("click", () => toggle());
$(".mh-close", root).addEventListener("click", () => { toggle(false); fab.focus(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) { toggle(false); fab.focus(); } });
$(".mh-form", root).addEventListener("submit", (e) => { e.preventDefault(); const q = input.value; input.value = ""; ask(q); });
logEl.addEventListener("click", (e) => {
  const c = e.target.closest("[data-faq]"); if (c) { const f = KB.faqs.find((x) => x.id === c.dataset.faq); if (f) { say("me", esc(f.q)); history.push({ role: "user", content: f.q }); answerFaq(f); } return; }
  const g = e.target.closest("[data-go]"); if (g) { const [tab, sub] = g.dataset.go.split(","); app().go(tab, sub); if (matchMedia("(max-width: 600px)").matches) toggle(false); }
});
// first visit: a little wave so people notice the helper
try { if (!localStorage.getItem("mh-seen")) setTimeout(() => root.classList.add("nudge"), 2500); } catch (_) {}
// hide on the signed-out screen
setInterval(() => { const m = app().me(); root.hidden = !m.signedIn; }, 800);
})();
