# Cursor brief: Magnolia DSP Schedule

Read this first, then `.cursor/rules/project.mdc` and `README.md`.

## What this is
An internal staff-scheduling web app for **Magnolia Community Services** (New Orleans nonprofit serving adults with intellectual and developmental disabilities). Built by a Tulane consulting team (Ben Eisen) as part of a proposal to reduce DSP (Direct Support Professional) turnover.

- **Live site:** https://magnolia-community-center.vercel.app
- **GitHub:** https://github.com/beisen888/Magnolia-Community-Center
- **Client's public website (match its look):** https://www.mcs-nola.org

## The idea behind it (from the proposal)
DSPs are organized into **activity-based teams** instead of by house, so people do work they enjoy:
1. House & Daily Living + Job Coaches (cooking, cleaning, homeroom, job prep for Ochsner; covers nights; no license)
2. On-Campus Activities (music garden, walks, crafts, fitness, sports; no license)
3. Community Outings (mall, library, Dollar Tree, lunches, events, bowling; driver's license required)
4. Learning & Community (reading, journaling, music, structured learning)

Each team has roles **assigned by HR**: 1 Lead DSP, 2 DSP II, 1–2 DSP I. Shifts are **4-hour blocks** (two back-to-back = 8 hours) around the clock. 20 homes sit in clusters A–D; during a daytime shift each team rotates through the clusters one hour at a time. Full-time target is **40 hours/week**. DSPs pick shifts up to 2 weeks ahead; HR clicks **Publish & email** each week to lock it and email everyone their final schedule. **No pay or money appears anywhere in the app** (by request).

## What's built
| Tab | Who | What |
|---|---|---|
| My week | DSPs | Hours vs 40-hr target (progress bar by team), next shift + cluster rotation, one-tap open shifts (4 or 8 hrs), profile (license, CNA, reminder emails), calendar export |
| Schedule | DSPs | Month calendar with your shifts + daily staffing bar; day view by block and team; take/drop. "HR tools" toggle for admins: assign people, remove, "No Lead DSP" flags |
| Teams & homes | All | Team cards with activities, hours worked, roster by role; team roles explained; homes by cluster; sample 12–4 PM rotation |
| Find my team | DSPs | 6-question quiz → recommends a team and joins it |
| HR | Admins | Coverage grid + KPIs + Publish & email; Employees (role, teams, weekly target, add people without logins, make HR); Teams & staffing (DSPs needed per block); Homes; Settings (announcement, remove demo data) |

Demo data: 16 fake DSPs (incl. "Sally Thompson") with shifts 2 weeks back to 3 weeks ahead, for the class presentation. HR → Settings → Remove demo data.

## How it's built
- Plain HTML/CSS/JS, **no framework, no build step**. Vercel serves files as-is.
- `app.js`: all UI. State object `S`; `render()` redraws; each tab is a `viewX()` function; buttons use `data-act="name"` → `actions` map.
- `data.js`: the only file that talks to storage. Two backends with the same methods: **Preview** (demo data in localStorage, used when no Supabase keys) and **Supabase** (live). New data features must be added to both.
- `styles.css`: brand tokens in `:root` (Magnolia greens `#29572D` / `#497A39`, cream `#F3EDD6`, gold `#DEA710`, fonts Alice + Source Sans 3). Team colors `--t0…--t7` via class `tcN`.
- `config.js`: org name, the 6 shift blocks, sign-up window. Teams/homes/people live in the database.
- `api/notify.js` (shift alerts: web push via `api/_webpush.js` + Resend email, 24h and 1h before; also "off the waitlist" messages; pinged every 10 min by Supabase pg_cron, see `supabase/alerts-cron.sql`), `api/publish.js` (weekly schedule emails), `sw.js` (service worker that shows alerts). `api/remind.js` is the old nightly email and is no longer scheduled.
- Staffing rules live in `data.js` (`slotNeed`, `clusterBlock`, `clusterMap`) and mirror `slot_need` / `cluster_block` in `supabase/dsp.sql` v2.2. Keep them in sync.
- Teams have `staffing`: `fixed` (one pool), `home` (per house), `cluster` (per monthly outing cluster). Sign-ups carry `homeId` / `clusterNo`.
- `supabase/schema.sql`, `supabase/dsp.sql`, `supabase/demo-seed.sql`: database + security rules. **Editing these files does not change the live database**; Claude runs them in Supabase.

## Run it locally
`npm run dev` → http://localhost:3000 (uses the real database). To use demo-only data, temporarily blank `supabaseUrl` in `config.js` (don't commit that).

## Known open items (not for Cursor)
- Vercel env var `RESEND_API_KEY` still has the wrong value, so emails don't send yet.
- Resend only emails the account owner until Magnolia's domain is verified.
- Using Magnolia's real logo needs their permission (a drawn tree mark is used now).

## Good things for Cursor to add (front-end only, safe)
- Clearer wording and labels for DSPs who aren't comfortable with tech; bigger tap targets on phones.
- A printable one-page weekly schedule per team (for posting in each home).
- An onboarding walkthrough for first-time users (3 quick tips).
- A "My team" section on My week showing my Lead DSP and teammates.
- Better empty states, loading states and accessibility (labels, contrast, keyboard).
- Visual polish that still matches mcs-nola.org: simple, professional, not flashy.

## Leave for Claude (needs database or server changes)
Shift swaps, time-off requests, anonymous feedback box, recognition awards, text reminders, anything that stores new kinds of data or changes who can do what.

## Rules
- Keep it simple. No new frameworks or build tools.
- No pay/money anywhere.
- Escape user text with `esc()`. Mobile first (375px). No emoji in the UI.
- Never put the Supabase secret key in code or git.
- One change at a time; test at localhost:3000 before committing.
