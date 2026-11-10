/* Magnolia Shift Board — UI. Data comes from data.js; settings from config.js. */
(() => {
const CFG = window.MAGNOLIA;
const SHIFTS = CFG.shifts, DAY_START = CFG.dayStart, DAY_END = CFG.dayEnd, WORKDAYS = CFG.workdays;
const LANES = 5, LETTERS = "ABCDE", TABS = ["month", "open", "mine", "how", "admin"];
/* Lane k is in group k at the first hour of the day and moves to the next group every hour. */
const groupAt = (lane, hour) => (((lane + (hour - DAY_START)) % LANES) + LANES) % LANES;

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d.getFullYear(), d.getMonth(), d.getDate()); };
const hr = (h) => `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`;
const hs = (h) => `${h % 12 || 12}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isWork = (s) => WORKDAYS.includes(parse(s).getDay());
const now = new Date();
const TODAY = iso(now.getFullYear(), now.getMonth(), now.getDate());
const isPast = (s) => s < TODAY;
const longDate = (s) => parse(s).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const shortDate = (s) => parse(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const monthStart = () => iso(S.y, S.m, 1);
const monthEnd = () => iso(S.y, S.m, new Date(S.y, S.m + 1, 0).getDate());
const shiftKey = (date, id) => date + "_" + id;
function firstWorkdayFrom(s) {
  const m = parse(s).getMonth();
  for (let d = s; parse(d).getMonth() === m; d = addDays(d, 1)) if (isWork(d)) return d;
  return s;
}

/* ---------- state ---------- */
const S = {
  y: now.getFullYear(), m: now.getMonth(), sel: TODAY, tab: "month",
  groups: [...CFG.defaultGroups], editing: false,
  rows: [], waitlist: [], announcement: "", me: null, mode: "connecting", notice: "", loaded: false,
};
S.sel = firstWorkdayFrom(TODAY);
let B = null;

/* ---------- derived ---------- */
function buildIndex() {
  const lanes = {}, mine = {};
  for (const r of S.rows) {
    const k = shiftKey(r.date, r.shiftId);
    (lanes[k] ||= Array(LANES).fill(null))[r.lane] = r;
    if (S.me && r.userId === S.me.id) mine[k] = r;
  }
  const lanesFor = (k) => lanes[k] || Array(LANES).fill(null);
  return { lanesFor, mine };
}
const canAct = () => B && (B.mode === "preview" || !!S.me);
const isAdmin = () => !!(S.me && S.me.isAdmin);
const displayName = (r) => (S.me && r.userId === S.me.id ? "You" : r.name || "Volunteer");
const waitFor = (date, shiftId) => S.waitlist.filter((w) => w.date === date && w.shiftId === shiftId).sort((a, b) => a.at - b.at);
const myWaitPos = (date, shiftId) => { const i = waitFor(date, shiftId).findIndex((w) => S.me && w.userId === S.me.id); return i < 0 ? 0 : i + 1; };

/* ---------- data ---------- */
let loadSeq = 0;
async function refresh() {
  if (!B) return;
  const seq = ++loadSeq;
  S.me = B.me();
  const from = monthStart() < TODAY ? monthStart() : TODAY;
  const horizon = addDays(TODAY, CFG.openSpotsDays || 21);
  const to = monthEnd() > horizon ? monthEnd() : horizon;
  try {
    const { rows, groups, waitlist, announcement } = await B.load(from, to);
    if (seq !== loadSeq) return;
    S.rows = rows; S.waitlist = waitlist || []; S.announcement = announcement || "";
    if (Array.isArray(groups) && groups.length === LANES && !S.editing) S.groups = groups.map((g, i) => String(g || CFG.defaultGroups[i]).slice(0, 24));
    S.mode = B.mode; S.loaded = true;
    if (B.mode === "live" && S.me && !S.me.isAdmin && S.noAdmin === undefined) B.hasAdmin().then((h) => { S.noAdmin = !h; render(); });
  } catch (e) {
    S.notice = (e && e.friendly) || "Couldn't load the schedule. Check your connection and refresh.";
  }
  render();
}

async function act(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); }
  catch (e) { toast((e && e.friendly) || "Something went wrong. Try again."); }
  await refresh();
}

function needsSignIn() {
  if (canAct()) {
    if (B.mode === "live" && !(S.me.name || "").trim()) {
      toast("Add your name at the top first so teammates know who's coming.");
      const i = $("myname"); if (i) i.focus();
      return true;
    }
    return false;
  }
  openSignIn(); return true;
}
function takeLane(date, shiftId, lane) {
  if (needsSignIn()) return;
  act(() => B.take(date, shiftId, lane), `You're on lane ${lane + 1}, ${shortDate(date)}.`);
}
function dropLane(date, shiftId) { act(() => B.drop(date, shiftId), "Shift dropped."); }
function removeOther(userId, date, shiftId, name) {
  if (!confirm(`Remove ${name} from this shift?`)) return;
  act(() => B.drop(date, shiftId, userId), `Removed ${name}.`);
}

/* ---------- toast + sign-in ---------- */
let toastTimer = null;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
}
function openSignIn() { const d = $("signin"); if (d.showModal) d.showModal(); else d.setAttribute("open", ""); setTimeout(() => $("email").focus(), 30); }
$("signin-cancel").onclick = () => $("signin").close();
$("signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim(); if (!email) return;
  $("signin-send").disabled = true;
  try { await B.signIn(email); $("signin").close(); toast(`Check ${email} for your sign-in link.`); }
  catch (err) { toast((err && err.friendly) || "Couldn't send the link. Try again."); }
  $("signin-send").disabled = false;
});

/* ---------- theme ---------- */
function applyTheme(t) { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
try { applyTheme(localStorage.getItem("magnolia-theme")); } catch (_) {}
$("theme").onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  applyTheme(next); try { localStorage.setItem("magnolia-theme", next); } catch (_) {}
};

/* ---------- render ---------- */
function render() {
  const idx = buildIndex();
  renderTop(); renderGroups(); renderNotice(); renderTabs(idx);
  if (S.tab === "month") { renderCal(idx); renderDay(idx); }
  if (S.tab === "open") renderOpen(idx);
  if (S.tab === "mine") renderMine(idx);
  if (S.tab === "how") renderHow();
  if (S.tab === "admin" && B && S.loaded) renderAdmin(idx);
  renderFooter();
}

function renderTop() {
  $("org").textContent = CFG.orgName; $("board").textContent = CFG.boardName;
  document.title = `${CFG.orgName} ${CFG.boardName}`;
  $("mlabel").textContent = new Date(S.y, S.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (document.activeElement && document.activeElement.id === "myname") return;
  const pill = S.mode === "preview" ? `<span class="pill" title="Demo data saved only in this browser"><i></i>Preview · demo data</span>`
    : S.mode === "live" ? `<span class="pill live"><i></i>Live · shared</span>`
    : `<span class="pill"><i></i>Connecting…</span>`;
  let me = "";
  if (B && B.mode === "live" && !S.me) me = `<button class="btn lg" id="signin-open">Sign in</button>`;
  else if (S.me) {
    const nm = (S.me.name || "").trim();
    me = nm && !S.renaming
      ? `<span class="me-chip" title="${esc(S.me.email)}">${esc(nm)}</span><button class="linkbtn" id="rename">Edit name</button>`
      : `<span class="name-in"><label for="myname" class="eyebrow">Your name</label><input id="myname" maxlength="40" placeholder="Shown on the board" value="${esc(nm)}"></span>`;
    if (B.mode === "live") me += `<button class="linkbtn" id="signout">Sign out</button>`;
  }
  $("who").innerHTML = pill + me;
  const so = $("signout"); if (so) so.onclick = () => act(() => B.signOut(), "Signed out.");
  const si = $("signin-open"); if (si) si.onclick = openSignIn;
  const rn = $("rename"); if (rn) rn.onclick = () => { S.renaming = true; renderTop(); $("myname").focus(); };
  const inp = $("myname");
  if (inp) {
    const commit = () => {
      const v = inp.value.trim().slice(0, 40); S.renaming = false;
      if (v && v !== (S.me.name || "")) act(() => B.setName(v), "Name saved."); else renderTop();
    };
    inp.addEventListener("change", commit);
    inp.addEventListener("blur", () => { if (S.renaming) { S.renaming = false; renderTop(); } });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
  }
}

function renderGroups() {
  const el = $("groups");
  if (S.editing) {
    el.innerHTML = S.groups.map((g, i) => `<span class="gchip"><span class="blk g${i}">${LETTERS[i]}</span><input id="gname${i}" maxlength="24" value="${esc(g)}" aria-label="Name for group ${LETTERS[i]}"></span>`).join("")
      + `<button class="btn" id="gsave">Save names</button><button class="linkbtn" id="gcancel">Cancel</button>`;
    $("gsave").onclick = () => {
      const list = S.groups.map((g, i) => ($("gname" + i).value.trim() || CFG.defaultGroups[i]).slice(0, 24));
      S.editing = false; S.groups = list; act(() => B.saveGroups(list), "Group names saved.");
    };
    $("gcancel").onclick = () => { S.editing = false; render(); };
    return;
  }
  el.innerHTML = S.groups.map((g, i) => `<span class="gchip"><span class="blk g${i}">${LETTERS[i]}</span>${esc(g)}</span>`).join("")
    + (isAdmin() ? `<button class="linkbtn" id="gedit">Rename groups</button>` : "");
  const b = $("gedit"); if (b) b.onclick = () => { S.editing = true; render(); };
}

function renderNotice() {
  let h = S.announcement ? `<div class="announce" role="note"><span class="eyebrow">Announcement</span><p>${esc(S.announcement)}</p></div>` : "";
  h += S.notice ? `<p class="notice" role="status">${esc(S.notice)}</p>` : "";
  if (B && B.mode === "live" && !S.me && S.loaded) h += welcomeHero();
  if (S.noAdmin && S.me && !S.me.isAdmin)
    h += `<p class="notice info">This board doesn't have an admin yet. If you're the organizer, <button class="btn" id="claim-admin">Claim admin</button></p>`;
  $("notice").innerHTML = h;
  const ca = $("claim-admin"); if (ca) ca.onclick = () => act(async () => {
    const ok = await B.claimAdmin(); S.noAdmin = false;
    if (!ok) throw Object.assign(new Error(), { friendly: "Someone else already claimed admin." });
  }, "You're the admin now. Check the Admin tab.");
  const b = $("notice-signin"); if (b) b.onclick = openSignIn;
  const so = $("hero-open"); if (so) so.onclick = () => setTab("open");
}

function welcomeHero() {
  const total = SHIFTS.reduce((a, sh) => a + (sh.end - sh.start), 0);
  return `<section class="hero"><div><span class="eyebrow">Volunteer with ${esc(CFG.orgName)}</span>
    <h2>Pick a shift. Show up. Every group stays covered.</h2>
    <p>Shifts are ${SHIFTS.map((sh) => `${sh.label.toLowerCase()} (${hr(sh.start)}–${hr(sh.end)})`).join(" and ")}. You'll rotate through all five groups, one hour each, so nobody is stuck in one spot.</p>
    <div class="hero-cta"><button class="btn lg" id="notice-signin">Sign in to sign up</button><button class="btn ghost lg" id="hero-open">See open spots</button></div></div>
    <ol class="steps"><li><b>Sign in with your email.</b> No password. We email you a one-tap link.</li><li><b>Take an open lane.</b> Full shift? Join the waitlist and you'll get the next spot that opens.</li><li><b>Add it to your calendar.</b> One tap from My schedule, with a reminder.</li></ol></section>`;
}

function renderTabs(idx) {
  const prefix = `${S.y}-${pad(S.m + 1)}`;
  const n = Object.keys(idx.mine).filter((k) => k.startsWith(prefix)).length;
  $("t-mine").innerHTML = `My schedule${n ? `<span class="count">${n}</span>` : ""}`;
  const open = openSpots(idx).reduce((a, d) => a + d.shifts.reduce((b, s) => b + s.open, 0), 0);
  $("t-open").innerHTML = `Open spots${open ? `<span class="count">${open}</span>` : ""}`;
  $("t-admin").hidden = !isAdmin();
  if (S.tab === "admin" && S.loaded && !isAdmin()) S.tab = "month";
  for (const t of TABS) {
    $("t-" + t).setAttribute("aria-selected", S.tab === t ? "true" : "false");
    $("v-" + t).hidden = S.tab !== t;
  }
  $("prev").parentElement.style.visibility = S.tab === "open" || S.tab === "how" ? "hidden" : "";
}

function miniBar(L, sh) {
  return `<span class="mini"><b>${sh.id.toUpperCase()}</b>` + L.map((r, k) => {
    const g = groupAt(k, sh.start);
    return `<i class="${r ? "on g" + g : ""}${r && S.me && r.userId === S.me.id ? " mine" : ""}"></i>`;
  }).join("") + `</span>`;
}

function renderCal(idx) {
  const first = new Date(S.y, S.m, 1).getDay();
  const days = new Date(S.y, S.m + 1, 0).getDate();
  let h = "";
  for (let i = 0; i < first; i++) h += `<div class="cell pad" aria-hidden="true"></div>`;
  for (let d = 1; d <= days; d++) {
    const s = iso(S.y, S.m, d);
    if (!isWork(s)) { h += `<div class="cell off"><span class="num">${d}</span><span class="closed">Closed</span></div>`; continue; }
    const hasMine = SHIFTS.some((sh) => idx.mine[shiftKey(s, sh.id)]);
    const rows = SHIFTS.map((sh) => miniBar(idx.lanesFor(shiftKey(s, sh.id)), sh)).join("");
    const open = SHIFTS.reduce((a, sh) => a + idx.lanesFor(shiftKey(s, sh.id)).filter((x) => !x).length, 0);
    h += `<button class="cell${isPast(s) ? " past" : ""}" data-date="${s}" aria-pressed="${s === S.sel}" aria-label="${longDate(s)}, ${open} open lanes${hasMine ? ", you're scheduled" : ""}"><span class="num">${d}${hasMine ? `<span class="you">You</span>` : ""}</span>${rows}</button>`;
  }
  $("cal").innerHTML = h;
  $("cal").querySelectorAll("button.cell").forEach((b) => b.onclick = () => {
    S.sel = b.dataset.date; render();
    if (matchMedia("(max-width: 880px)").matches) $("day").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function renderDay(idx) {
  const s = S.sel, el = $("day"), dt = parse(s);
  if (dt.getMonth() !== S.m || dt.getFullYear() !== S.y || !isWork(s)) { el.innerHTML = `<div class="empty"><h3>Pick a weekday</h3>Choose any open day on the calendar to see its shifts.</div>`; return; }
  const past = isPast(s);
  let h = `<h2>${longDate(s)}</h2><p class="sub">${past ? "Past day · view only" : `${SHIFTS.length} shifts · ${LANES} lanes each · groups change on the hour`}</p>`;
  for (const sh of SHIFTS) {
    const key = shiftKey(s, sh.id), L = idx.lanesFor(key), mineHere = idx.mine[key];
    const taken = L.filter(Boolean).length;
    const hours = []; for (let x = sh.start; x < sh.end; x++) hours.push(x);
    h += `<div class="shift"><div class="shead"><h3>${sh.label}</h3><span class="t">${hr(sh.start)} – ${hr(sh.end)}</span><span class="f">${taken} of ${LANES} lanes taken</span></div>`;
    h += `<div class="tw"><table class="lanes"><thead><tr><th>Lane</th><th>Person</th>${hours.map((x) => `<th>${hs(x)}</th>`).join("")}<th></th></tr></thead><tbody>`;
    L.forEach((r, k) => {
      const isMe = r && S.me && r.userId === S.me.id;
      let action = "";
      if (past) action = "";
      else if (isMe) action = `<button class="btn ghost" data-drop="${sh.id}">Drop</button>`;
      else if (r) action = isAdmin() && B.mode === "live" ? `<button class="btn quiet" data-rm="${esc(r.userId)}" data-sh="${sh.id}" data-name="${esc(r.name)}">Remove</button>` : "";
      else action = `<button class="btn" data-take="${sh.id}" data-lane="${k}">${mineHere ? "Switch here" : "Take lane"}</button>`;
      h += `<tr class="${r ? "" : "open"}${isMe ? " mine" : ""}"><td class="l">${k + 1}</td><td class="p">${r ? esc(displayName(r)) : "Open"}</td>`
        + hours.map((x) => { const g = groupAt(k, x); return `<td class="h"><span class="blk g${g}" title="${esc(S.groups[g])}">${LETTERS[g]}</span></td>`; }).join("")
        + `<td class="a">${action}</td></tr>`;
    });
    h += `</tbody><tfoot><tr class="cov"><th colspan="2">Groups covered</th>` + hours.map((x) => {
      const covered = new Set(L.map((r, k) => (r ? groupAt(k, x) : null)).filter((v) => v !== null));
      return `<td title="${covered.size} of ${LANES} groups staffed at ${hr(x)}"><span class="dots">${[0, 1, 2, 3, 4].map((g) => `<i class="${covered.has(g) ? "on" : ""}"></i>`).join("")}</span></td>`;
    }).join("") + `<td></td></tr></tfoot></table></div>`;
    const wl = waitFor(s, sh.id), pos = myWaitPos(s, sh.id);
    if (!past && (taken === LANES || wl.length) && !mineHere) {
      h += `<div class="wl"><span><b>${taken === LANES ? "Full" : "Waitlist"}</b> · ${wl.length ? `${wl.length} waiting` : "no one waiting yet"}${S.me && wl.length ? `: ${wl.map((w) => esc(displayName(w))).join(", ")}` : ""}</span>`
        + (pos ? `<span class="wlpos">You're #${pos}</span><button class="btn quiet" data-unwait="${sh.id}">Leave waitlist</button>`
               : `<button class="btn ghost" data-wait="${sh.id}">Join waitlist</button>`) + `</div>`;
    }
    h += `</div>`;
  }
  if (!past) h += `<p class="hint"><button class="linkbtn" id="share-day">Copy link to this day</button> Send it to people when you need help.</p>`;
  h += `<p class="hint">Lane 1 starts in ${esc(S.groups[0])} at ${hr(DAY_START)}, lane 2 in ${esc(S.groups[1])}, and so on. Taking the same lane number in both shifts keeps one continuous rotation all day.</p>`;
  el.innerHTML = h;
  el.querySelectorAll("[data-take]").forEach((b) => b.onclick = () => takeLane(s, b.dataset.take, +b.dataset.lane));
  el.querySelectorAll("[data-drop]").forEach((b) => b.onclick = () => dropLane(s, b.dataset.drop));
  el.querySelectorAll("[data-wait]").forEach((b) => b.onclick = () => { if (needsSignIn()) return; act(() => B.joinWaitlist(s, b.dataset.wait), "You're on the waitlist. If a lane opens, it's yours automatically."); });
  el.querySelectorAll("[data-unwait]").forEach((b) => b.onclick = () => act(() => B.leaveWaitlist(s, b.dataset.unwait), "Left the waitlist."));
  el.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => removeOther(b.dataset.rm, s, b.dataset.sh, b.dataset.name));
  const sd = $("share-day");
  if (sd) sd.onclick = async () => {
    const url = location.origin + location.pathname + "#day-" + s;
    try { await navigator.clipboard.writeText(url); toast("Link copied. Paste it in a text or group chat."); }
    catch (_) { prompt("Copy this link:", url); }
  };
}

/* ---------- open spots ---------- */
function openSpots(idx) {
  const out = [];
  for (let i = 0; i < (CFG.openSpotsDays || 21); i++) {
    const d = addDays(TODAY, i);
    if (!isWork(d)) continue;
    const shifts = SHIFTS.map((sh) => {
      const L = idx.lanesFor(shiftKey(d, sh.id));
      return { sh, L, open: L.filter((x) => !x).length, mine: idx.mine[shiftKey(d, sh.id)] };
    });
    out.push({ date: d, shifts });
  }
  return out;
}
function suggestLane(idx, date, item) {
  // Prefer the lane you already hold in another shift that day, so your rotation stays continuous.
  for (const sh of SHIFTS) { const m = idx.mine[shiftKey(date, sh.id)]; if (m && !item.L[m.lane]) return m.lane; }
  return item.L.findIndex((x) => !x);
}
function renderOpen(idx) {
  const f = S.openFilter || "all";
  const days = openSpots(idx).map((d) => ({ ...d, shifts: d.shifts.filter((s) => f === "all" || s.sh.id === f) }));
  const total = days.reduce((a, d) => a + d.shifts.reduce((b, s) => b + s.open, 0), 0);
  const needy = days.filter((d) => d.shifts.some((s) => s.open > 0));
  const chips = [{ id: "all", label: "All shifts" }, ...SHIFTS.map((s) => ({ id: s.id, label: s.label }))]
    .map((c) => `<button class="chip" aria-pressed="${f === c.id}" data-f="${c.id}">${esc(c.label)}</button>`).join("");
  let h = `<div class="toolbar"><p><b>${total}</b> open lane${total === 1 ? "" : "s"} in the next ${CFG.openSpotsDays || 21} days. Tap to grab one. We'll pick the lane that keeps your day continuous.</p><div class="chips" role="group" aria-label="Filter shifts">${chips}</div></div>`;
  setTimeout(() => $("v-open").querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { S.openFilter = b.dataset.f; render(); }));
  if (!needy.length) { $("v-open").innerHTML = h + `<div class="empty"><h3>Every shift is covered</h3>Nice work, team. Check back later or look ahead on the Month tab.</div>`; return; }
  h += `<div class="spots">`;
  for (const d of needy) {
    h += `<div class="spot"><div class="d">${shortDate(d.date)}<small>${d.date === TODAY ? "Today" : d.date === addDays(TODAY, 1) ? "Tomorrow" : ""}</small></div><div>`;
    for (const it of d.shifts) {
      const lane = suggestLane(idx, d.date, it);
      let right;
      if (it.mine) right = `<span class="full">You're on lane ${it.mine.lane + 1}</span>`;
      else if (it.open === 0) { const pos = myWaitPos(d.date, it.sh.id); right = pos ? `<span class="full">Waitlist #${pos}</span>` : `<span class="full">Full</span><button class="btn ghost" data-wq="${d.date}|${it.sh.id}">Join waitlist</button>`; }
      else right = `<span class="need">${it.open} open</span><button class="btn" data-q="${d.date}|${it.sh.id}|${lane}">Take lane ${lane + 1}</button>`;
      h += `<div class="sh"><span class="lbl">${it.sh.label}<small>${hs(it.sh.start)}–${hs(it.sh.end)}</small></span>${miniBar(it.L, it.sh)}${right}<button class="linkbtn" data-view="${d.date}">View day</button></div>`;
    }
    h += `</div></div>`;
  }
  $("v-open").innerHTML = h + `</div>`;
  $("v-open").querySelectorAll("[data-q]").forEach((b) => b.onclick = () => { const [d, sh, l] = b.dataset.q.split("|"); takeLane(d, sh, +l); });
  $("v-open").querySelectorAll("[data-wq]").forEach((b) => b.onclick = () => { if (needsSignIn()) return; const [d, sh] = b.dataset.wq.split("|"); act(() => B.joinWaitlist(d, sh), "You're on the waitlist."); });
  $("v-open").querySelectorAll("[data-view]").forEach((b) => b.onclick = () => {
    const d = parse(b.dataset.view); S.y = d.getFullYear(); S.m = d.getMonth(); S.sel = b.dataset.view; setTab("month"); refresh();
  });
}

/* ---------- my schedule ---------- */
function renderMine(idx) {
  const el = $("v-mine"), mine = idx.mine, prefix = `${S.y}-${pad(S.m + 1)}`;
  const monthName = new Date(S.y, S.m, 1).toLocaleDateString("en-US", { month: "long" });
  if (B && B.mode === "live" && !S.me) { el.innerHTML = `<div class="empty"><h3>Sign in to see your schedule</h3><p><button class="btn lg" id="mine-signin">Sign in</button></p></div>`; $("mine-signin").onclick = openSignIn; return; }
  const dates = [...new Set(Object.keys(mine).filter((k) => k.startsWith(prefix)).map((k) => k.split("_")[0]))].sort();
  const myWaits = S.waitlist.filter((w) => S.me && w.userId === S.me.id && w.date >= TODAY).sort((a, b) => (a.date + a.shiftId < b.date + b.shiftId ? -1 : 1));
  const waitHtml = myWaits.length ? `<div class="wlbox"><span class="eyebrow">Waitlists you're on</span>${myWaits.map((w) => { const sh = SHIFTS.find((x) => x.id === w.shiftId); return `<div>${shortDate(w.date)} · ${sh ? sh.label : w.shiftId}: <b>#${myWaitPos(w.date, w.shiftId)}</b> in line <button class="linkbtn" data-unwait2="${w.date}|${w.shiftId}">Leave</button></div>`; }).join("")}<p class="hint" style="margin:6px 0 0">If a lane opens, it's assigned to you automatically and shows up here.</p></div>` : "";
  const calBtn = `<span class="mine-actions"><label class="remind"><input type="checkbox" id="remind" ${S.me && S.me.reminders !== false ? "checked" : ""}> Email me the night before</label><button class="btn ghost lg" id="ics">Add upcoming shifts to my calendar</button></span>`;
  if (!dates.length) {
    el.innerHTML = waitHtml + `<div class="empty"><h3>No shifts in ${monthName} yet</h3>Check <b>Open spots</b> or pick a day on the Month tab and take an open lane.<p style="margin-top:14px">${calBtn}</p></div>`;
    $("ics").onclick = exportIcs; wireUnwait(el); return;
  }
  const perGroup = [0, 0, 0, 0, 0]; let hours = 0, shifts = 0;
  for (const k of Object.keys(mine)) {
    if (!k.startsWith(prefix)) continue;
    const sh = SHIFTS.find((x) => x.id === k.split("_")[1]); if (!sh) continue;
    shifts++;
    for (let x = sh.start; x < sh.end; x++) { perGroup[groupAt(mine[k].lane, x)]++; hours++; }
  }
  const allHours = []; for (let x = DAY_START; x < DAY_END; x++) allHours.push(x);
  let h = `<div class="toolbar">${nextUpCard(mine)}${calBtn}</div>`;
  h += `<div class="summary"><div class="stat"><div class="v">${shifts}</div><div class="k">shifts in ${monthName}</div></div><div class="stat"><div class="v">${hours}</div><div class="k">hours</div></div>`
    + `<div class="mix"><div class="k" style="font-size:12px;color:var(--muted);font-weight:500;margin-bottom:6px">Hours by group</div><div class="mixbar">${perGroup.map((n, g) => n ? `<span class="g${g}" style="width:${(n / Math.max(hours, 1)) * 100}%" title="${esc(S.groups[g])}: ${n}h"></span>` : "").join("")}</div>`
    + `<div class="mixkey">${perGroup.map((n, g) => `<span><i class="g${g}"></i>${esc(S.groups[g])} ${n}h</span>`).join("")}</div></div></div>`;
  h += `<div class="axis-row"><div></div><div class="tl-axis" style="grid-template-columns:repeat(${allHours.length},minmax(0,1fr))">${allHours.map((x) => `<span>${hr(x).replace(" ", "")}</span>`).join("")}</div></div><div class="dlist">`;
  for (const d of dates) {
    const cells = allHours.map((x) => {
      const sh = SHIFTS.find((s) => x >= s.start && x < s.end);
      const e = sh && mine[shiftKey(d, sh.id)];
      if (!e) return `<span class="c" aria-label="${hr(x)} off">·</span>`;
      const g = groupAt(e.lane, x);
      return `<span class="c g${g}" title="${hr(x)}: ${esc(S.groups[g])}">${LETTERS[g]}</span>`;
    }).join("");
    const which = SHIFTS.filter((s) => mine[shiftKey(d, s.id)]).map((s) => `${s.label} · lane ${mine[shiftKey(d, s.id)].lane + 1}`).join("<br>");
    h += `<div class="drow"><div class="d">${shortDate(d)}<small>${which}</small></div><div class="tl" style="grid-template-columns:repeat(${allHours.length},minmax(0,1fr))">${cells}</div></div>`;
  }
  el.innerHTML = waitHtml + h + `</div>`;
  $("ics").onclick = exportIcs; wireUnwait(el);
}
function wireRemind() {
  const r = $("remind");
  if (r) r.onchange = () => act(() => B.setReminders(r.checked), r.checked ? "You'll get an email the evening before each shift." : "Reminder emails turned off.");
}
function wireUnwait(el) {
  wireRemind();
  el.querySelectorAll("[data-unwait2]").forEach((b) => b.onclick = () => { const [d, sh] = b.dataset.unwait2.split("|"); act(() => B.leaveWaitlist(d, sh), "Left the waitlist."); });
}

function nextUpCard(mine) {
  const nowHour = new Date().getHours();
  const next = Object.entries(mine)
    .map(([k, r]) => ({ r, sh: SHIFTS.find((s) => s.id === r.shiftId) }))
    .filter(({ r, sh }) => sh && (r.date > TODAY || (r.date === TODAY && sh.end > nowHour)))
    .sort((a, b) => (a.r.date === b.r.date ? a.sh.start - b.sh.start : a.r.date < b.r.date ? -1 : 1))[0];
  if (!next) return `<span></span>`;
  const { r, sh } = next;
  const days = Math.round((parse(r.date) - parse(TODAY)) / 86400000);
  const when = days === 0 ? (sh.start <= nowHour ? "Happening now" : "Today") : days === 1 ? "Tomorrow" : `In ${days} days`;
  const g = groupAt(r.lane, sh.start);
  return `<div class="nextup"><span class="eyebrow">Next up · ${when}</span><b>${shortDate(r.date)} · ${sh.label}, ${hr(sh.start)} – ${hr(sh.end)}</b><span>Lane ${r.lane + 1}, starting in <span class="blk g${g}">${LETTERS[g]}</span> ${esc(S.groups[g])}</span></div>`;
}

async function exportIcs() {
  try {
    const { rows } = await B.load(TODAY, addDays(TODAY, 180));
    const mine = rows.filter((r) => S.me && r.userId === S.me.id).sort((a, b) => (a.date + a.shiftId < b.date + b.shiftId ? -1 : 1));
    if (!mine.length) { toast("You don't have any upcoming shifts yet."); return; }
    const shifts = mine.map((r) => { const sh = SHIFTS.find((x) => x.id === r.shiftId); return sh && { ...sh, date: r.date, lane: r.lane }; }).filter(Boolean);
    downloadFile("magnolia-shifts.ics", buildIcs({ orgName: CFG.orgName, shifts, groups: S.groups, letters: LETTERS, groupAt }), "text/calendar");
    toast(`Downloaded ${shifts.length} shift${shifts.length === 1 ? "" : "s"}. Open the file to add them to your calendar.`);
  } catch (e) { toast((e && e.friendly) || "Couldn't build the calendar file."); }
}

/* ---------- how ---------- */
function renderHow() {
  const names = ["Ana", "Ben", "Cara", "Dev", "Eli"];
  const allHours = []; for (let x = DAY_START; x < DAY_END; x++) allHours.push(x);
  let g = `<div class="exg"><span></span>${allHours.map((x) => `<span class="hd">${hs(x)}</span>`).join("")}`;
  names.forEach((n, k) => { g += `<span class="nm">${n} · ${k + 1}</span>` + allHours.map((x) => { const q = groupAt(k, x); return `<span class="blk g${q}">${LETTERS[q]}</span>`; }).join(""); });
  g += `<span></span><div class="split"><span>${SHIFTS[0] ? SHIFTS[0].label : ""}</span><span>${SHIFTS[1] ? SHIFTS[1].label : ""}</span></div></div>`;
  $("v-how").innerHTML = `<div class="how"><div><h2>One rule drives the whole board</h2><ul>
    <li><b>${LANES} lanes per shift.</b> Each person who signs up claims one lane.</li>
    <li><b>Lane number sets the starting group.</b> Lane 1 starts in ${esc(S.groups[0])} at ${hr(DAY_START)}, lane 2 in ${esc(S.groups[1])}, and so on.</li>
    <li><b>Everyone moves on the hour.</b> Each hour, a lane shifts to the next group and wraps from ${LETTERS[4]} back to ${LETTERS[0]}.</li>
    <li><b>Full shift, full coverage.</b> With all ${LANES} lanes taken, every group has exactly one person every hour. The dots under each shift show any gaps.</li>
    <li><b>Same lane all day = one smooth rotation.</b> Keeping your lane number across both shifts continues the same pattern from morning into afternoon.</li>
    <li><b>No double-booking.</b> The database only lets one person hold a lane, so two people can never land in the same spot.</li></ul></div>
    <div class="ex"><span class="tag">Example team · not real sign-ups</span><div class="tw">${g}</div><p class="hint">Read any column: each hour has one of every letter, so no group is ever left empty.</p></div></div>`;
}

/* ---------- admin ---------- */
function monthStats(idx) {
  const prefix = `${S.y}-${pad(S.m + 1)}`;
  const people = {};
  let lanes = 0, filled = 0;
  const days = [];
  for (let d = 1; d <= new Date(S.y, S.m + 1, 0).getDate(); d++) {
    const s = iso(S.y, S.m, d); if (!isWork(s)) continue;
    let dayFilled = 0;
    for (const sh of SHIFTS) {
      const L = idx.lanesFor(shiftKey(s, sh.id));
      lanes += LANES;
      L.forEach((r, k) => {
        if (!r) return; filled++; dayFilled++;
        const p = (people[r.userId] ||= { name: r.name || "Volunteer", shifts: 0, hours: 0, g: [0, 0, 0, 0, 0] });
        p.shifts++;
        for (let x = sh.start; x < sh.end; x++) { p.hours++; p.g[groupAt(k, x)]++; }
      });
    }
    days.push({ date: s, filled: dayFilled, total: SHIFTS.length * LANES });
  }
  return { prefix, people: Object.values(people).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name)), lanes, filled, days };
}
function renderAdmin(idx) {
  const st = monthStats(idx);
  const monthName = new Date(S.y, S.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const pct = st.lanes ? Math.round((st.filled / st.lanes) * 100) : 0;
  const hours = st.people.reduce((a, p) => a + p.hours, 0);
  const gaps = st.days.filter((d) => !isPast(d.date) && d.filled < d.total).sort((a, b) => a.filled - b.filled || (a.date < b.date ? -1 : 1)).slice(0, 6);
  let h = `<div class="adm"><div class="card annedit"><label for="ann" class="eyebrow">Announcement banner</label><textarea id="ann" maxlength="280" rows="2" placeholder="e.g. Extra help needed Friday afternoon! (Leave empty to hide the banner.)">${esc(S.announcement)}</textarea><div class="row"><span class="hint" style="margin:0">Shows at the top of the board for everyone.</span><button class="btn" id="ann-save">Save</button></div></div>`;
  h += `<div class="toolbar"><p>Coverage and volunteer hours for <b>${monthName}</b>. Use the arrows up top to switch months.</p><span><button class="btn ghost lg" id="csv">Download CSV</button> <button class="btn quiet lg" id="print">Print</button></span></div>`;
  h += `<div class="cards"><div class="card"><div class="v">${pct}%</div><div class="k">lanes filled (${st.filled} of ${st.lanes})</div></div><div class="card"><div class="v">${st.people.length}</div><div class="k">volunteers</div></div><div class="card"><div class="v">${hours}</div><div class="k">volunteer hours</div></div><div class="card"><div class="v">${st.lanes - st.filled}</div><div class="k">open lanes</div></div></div>`;
  if (gaps.length) h += `<h2>Thinnest upcoming days</h2><div class="spots">${gaps.map((d) => `<div class="spot"><div class="d">${shortDate(d.date)}</div><div class="sh"><span class="need">${d.filled} of ${d.total} lanes filled</span><button class="linkbtn" data-view="${d.date}">Open day</button></div></div>`).join("")}</div>`;
  h += `<h2>Roster</h2>`;
  if (!st.people.length) h += `<div class="empty">No sign-ups this month yet.</div>`;
  else h += `<div class="tw"><table class="roster"><thead><tr><th>Volunteer</th><th class="n">Shifts</th><th class="n">Hours</th>${S.groups.map((g, i) => `<th class="n"><span class="blk g${i}">${LETTERS[i]}</span></th>`).join("")}</tr></thead><tbody>`
    + st.people.map((p) => `<tr><td>${esc(p.name)}</td><td class="n">${p.shifts}</td><td class="n">${p.hours}</td>${p.g.map((n) => `<td class="n">${n || "·"}</td>`).join("")}</tr>`).join("")
    + `</tbody></table></div>`;
  h += `<h2>People &amp; admins</h2><div id="people">${peopleTable()}</div>`;
  if (B.mode === "preview") h += `<p class="hint">Preview mode shows demo volunteers. <button class="linkbtn" id="reset">Reset demo data</button></p>`;
  $("v-admin").innerHTML = h + `</div>`;
  $("csv").onclick = () => downloadCsv(idx);
  $("ann-save").onclick = () => { const v = $("ann").value.trim().slice(0, 280); act(() => B.saveAnnouncement(v), v ? "Announcement posted." : "Announcement removed."); };
  $("print").onclick = () => window.print();
  const rs = $("reset"); if (rs) rs.onclick = () => { if (confirm("Reset all preview data on this device?")) B.resetDemo(); };
  $("v-admin").querySelectorAll("[data-view]").forEach((b) => b.onclick = () => { S.sel = b.dataset.view; setTab("month"); });
  wirePeople();
  if (S.people === undefined) loadPeople();
}
async function loadPeople() {
  S.people = null;
  try { S.people = await B.listPeople(); } catch (e) { S.people = { error: (e && e.friendly) || "Couldn't load people." }; }
  if (S.tab === "admin") { $("people").innerHTML = peopleTable(); wirePeople(); }
}
function peopleTable() {
  const P = S.people;
  if (P === undefined || P === null) return `<p class="hint">Loading…</p>`;
  if (P.error) return `<p class="notice">${esc(P.error)}</p>`;
  const q = (S.peopleQuery || "").toLowerCase();
  const list = P.filter((p) => !q || (p.name + " " + p.email).toLowerCase().includes(q));
  return `<p class="hint" style="margin:0 0 10px">Everyone who has signed in. Admins can see this tab, remove sign-ups, and rename groups. <input id="people-q" placeholder="Search name or email" value="${esc(S.peopleQuery || "")}" style="margin-left:6px;font:inherit;font-size:13px;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink)"></p>`
    + `<div class="tw"><table class="roster"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>`
    + list.map((p) => {
      const self = S.me && p.id === S.me.id;
      const btn = self ? `<span class="hint" style="margin:0">You</span>`
        : `<button class="btn ${p.isAdmin ? "quiet" : "ghost"} sm" data-admin="${esc(p.id)}" data-on="${p.isAdmin ? 0 : 1}" data-name="${esc(p.name || p.email)}">${p.isAdmin ? "Remove admin" : "Make admin"}</button>`;
      return `<tr><td>${esc(p.name || "—")}</td><td>${esc(p.email)}</td><td>${p.isAdmin ? "<b>Admin</b>" : "Volunteer"}</td><td style="text-align:right">${btn}</td></tr>`;
    }).join("") + `</tbody></table></div>`;
}
function wirePeople() {
  const q = $("people-q");
  if (q) q.oninput = () => { S.peopleQuery = q.value; const pos = q.selectionStart; $("people").innerHTML = peopleTable(); wirePeople(); const n = $("people-q"); n.focus(); n.setSelectionRange(pos, pos); };
  document.querySelectorAll("[data-admin]").forEach((b) => b.onclick = async () => {
    const on = b.dataset.on === "1", name = b.dataset.name;
    if (!confirm(on ? `Make ${name} an admin? They'll be able to see everyone's email and manage the board.` : `Remove admin access from ${name}?`)) return;
    try { await B.setAdmin(b.dataset.admin, on); toast(on ? `${name} is now an admin.` : `${name} is no longer an admin.`); }
    catch (e) { toast((e && e.friendly) || "Couldn't change that."); }
    loadPeople();
  });
}
function downloadCsv(idx) {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["Date", "Shift", "Start", "End", "Lane", "Volunteer", ...S.groups.map((g) => g + " hrs")].map(q).join(",")];
  const prefix = `${S.y}-${pad(S.m + 1)}`;
  S.rows.filter((r) => r.date.startsWith(prefix)).sort((a, b) => (a.date + a.shiftId + a.lane < b.date + b.shiftId + b.lane ? -1 : 1)).forEach((r) => {
    const sh = SHIFTS.find((x) => x.id === r.shiftId); if (!sh) return;
    const g = [0, 0, 0, 0, 0]; for (let x = sh.start; x < sh.end; x++) g[groupAt(r.lane, x)]++;
    lines.push([r.date, sh.label, hr(sh.start), hr(sh.end), r.lane + 1, r.name || "Volunteer", ...g].map(q).join(","));
  });
  downloadFile(`magnolia-signups-${prefix}.csv`, lines.join("\n"), "text/csv");
}

function renderFooter() {
  $("footer").innerHTML = B && B.mode === "preview"
    ? `Preview mode: demo data saved only in this browser. Connect Supabase (see README) to share the board.`
    : `${esc(CFG.orgName)} ${esc(CFG.boardName)} · updates live as people sign up`;
}

/* ---------- navigation ---------- */
function setTab(t) { S.tab = TABS.includes(t) ? t : "month"; if (location.hash.slice(1) !== S.tab) history.replaceState(null, "", location.pathname + location.search + "#" + S.tab); render(); }
document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => setTab(b.dataset.tab));
window.addEventListener("hashchange", () => {
  const t = location.hash.slice(1), m = /^day-(\d{4}-\d{2}-\d{2})$/.exec(t);
  if (m) { const d = parse(m[1]); const moved = d.getFullYear() !== S.y || d.getMonth() !== S.m; S.y = d.getFullYear(); S.m = d.getMonth(); S.sel = m[1]; S.tab = "month"; render(); if (moved) refresh(); return; }
  if (TABS.includes(t) && t !== S.tab) setTab(t);
});
function shiftMonth(dir) {
  let m = S.m + dir, y = S.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
  S.y = y; S.m = m;
  const first = iso(y, m, 1);
  S.sel = firstWorkdayFrom(TODAY.startsWith(first.slice(0, 7)) ? TODAY : first);
  render(); refresh();
}
$("prev").onclick = () => shiftMonth(-1);
$("next").onclick = () => shiftMonth(1);

/* ---------- boot ---------- */
const h0 = location.hash.slice(1);
const dayLink = /^day-(\d{4}-\d{2}-\d{2})$/.exec(h0);
if (dayLink) { const d = parse(dayLink[1]); S.y = d.getFullYear(); S.m = d.getMonth(); S.sel = dayLink[1]; S.tab = "month"; }
else if (TABS.includes(h0)) S.tab = h0; // Supabase sign-in links put tokens in the hash; anything else falls back to Month.
render();
(async () => {
  B = await createBackend();
  await B.init(() => refresh());
  S.mode = B.mode;
  await refresh();
  if (!TABS.includes(location.hash.slice(1)) && location.hash && !dayLink) history.replaceState(null, "", location.pathname + location.search + "#" + S.tab);
})();
})();
