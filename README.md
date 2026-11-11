# Magnolia DSP Schedule

Internal staff scheduling for **Magnolia Community Services**: DSPs work on activity-based teams, sign up for 4-hour shift blocks (two back-to-back = an 8-hour day), and track progress toward a 40-hour week. HR sees coverage for every block, team and home.

Built from the team's proposal: 4 activity teams (House & Daily Living + Job Coaches, On-Campus Activities, Community Outings, Learning & Community), 20 homes in clusters A–D with an hourly cluster rotation, the DSP I $16 → DSP II $16.50 → Lead DSP $17 ladder (+$0.50 CNA, +$0.50 overnight), and the "availability by the 20th, schedule published by the 28th" cycle.

**Stack:** plain HTML/CSS/JS (no build step) · **Supabase** (logins, database, live updates) · **Vercel** (hosting + email/alert functions) · **Resend** (email) · **GitHub** · **Cursor**.

| Tab | Who | What it does |
|---|---|---|
| **My week** | Everyone | Hours vs 40-hour target (progress bar by team), est. pay, next shift with its cluster rotation, one-tap open shifts (4 or 8 hrs), profile, calendar export |
| **Schedule** | Everyone | Month calendar with your shifts + daily staffing bar; day view by 4-hour block and team; take/drop shifts |
| **Teams & homes** | Everyone | Team cards (activities, hours, license), join/leave, career ladder, homes by cluster, sample 12–4 PM rotation |
| **Find my team** | Everyone | 6-question quiz that recommends a team and joins it |
| **HR** | Admins | Coverage grid + KPIs, employees (levels, teams, targets, add people without logins), team staffing needs per block, homes, announcement, publish/lock months, remove demo data, CSV |

The database enforces the rules: DSPs only take future shifts on their own teams, nobody is double-booked, teams can't be overfilled, published months are locked for DSPs, and only HR can change levels, staffing and teams.

**Demo data:** `supabase/demo-seed.sql` loads 16 demo DSPs (incl. Sally Thompson) with shifts from 2 weeks ago to 3 weeks ahead. HR → Settings → *Remove demo data* clears them.

## Setup (about 20 minutes, all free tiers)

### 1. Put the code on GitHub
**Easiest (Cursor):** open this folder in Cursor → Source Control panel (left sidebar) → **Publish to GitHub** → choose **Private** → done.

**Or on github.com:** New repository → name it `magnolia-shift-board` → Create → "uploading an existing file" → drag in everything in this folder → Commit.

### 2. Create the database (Supabase)
1. Go to [supabase.com](https://supabase.com) → **New project** (pick a region near you, save the password somewhere).
2. Left sidebar → **SQL Editor** → **New query** → paste all of `supabase/schema.sql` → **Run**. Then do the same with `supabase/dsp.sql`, and optionally `supabase/demo-seed.sql`.
3. **Authentication → URL Configuration:** set **Site URL** to your Vercel URL (you'll get it in step 3; come back and fill it in). Add `http://localhost:3000` under **Redirect URLs** for local testing.

### 3. Deploy on Vercel
1. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import `magnolia-shift-board` from GitHub.
2. Framework preset: **Other**. Leave the build settings empty → **Deploy**.
3. Connect the database: put your Supabase **Project URL** and **publishable key** (Project Settings → API Keys) into `config.js`, then push. *(Already done for this project.)*
4. Every push to `main` redeploys automatically.
5. Copy your `*.vercel.app` URL into Supabase's **Site URL** (step 2.3).

### 4. Make yourself an admin
Sign in on the live site, add your name, and click **Claim admin** in the banner (only works while the board has no admin). Add more admins from **Admin → People & admins**.

Manual fallback, in the Supabase SQL Editor:
```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```
Refresh the site. The **Admin** tab appears.

### 5. (Optional) Custom domain
Vercel → Project → **Settings → Domains** → add e.g. `shifts.yourorg.org`. Update the Supabase Site URL to match.

---

## Houses, outing clusters, waitlists and phone alerts (v2.2)

- **House & Daily Living** sign-ups name the exact house (20 houses, 2 DSPs per house per block; HR can change the number in HR → Teams & staffing).
- **Outing clusters:** HR enters residents (first name, house, "needs their own DSP"). Every month the app deals them into new clusters of 8 or fewer. Each cluster goes out once a day (the time rotates); an outing needs 2 DSPs plus 1 per resident who needs their own, and runs about 30 minutes longer when one is along.
- **Waitlist:** when a slot is full, up to 10 DSPs can wait. DSPs can drop a shift until 48 hours before it starts; the first person waiting gets it automatically and an alert.
- **Phone alerts:** push to DSPs' phones 24 hours and 1 hour before each shift, with email as backup.
  1. HR → Settings → **Create alert keys**. Copy the private key into Vercel as `VAPID_PRIVATE_KEY`, then redeploy.
  2. Run `supabase/alerts-cron.sql` once in the Supabase SQL editor (pings `/api/notify` every 10 minutes).
  3. Each DSP taps **Turn on phone alerts** under My week → My profile. iPhone users first add the site to their home screen (Share → Add to Home Screen).

## Handing it to a client
See **HANDOFF.md**: transfer this board, or let them build their own from a template.

## Working in Cursor

**Run it locally:** open the terminal in Cursor and run `npm run dev`, then open http://localhost:3000. (Or just double-click `index.html` for preview mode.)

**Ship a change:** edit → Source Control → write a message → **Commit** → **Sync/Push**. Vercel deploys in ~30 seconds. Every pull request also gets its own preview link.

The file `.cursor/rules/project.mdc` teaches Cursor's AI how this project is built, so its suggestions stay consistent. Good prompts to try (Cmd/Ctrl + L to open chat):

- "Change the shifts to 8–12 and 12–4 and add Saturdays." *(config.js only)*
- "Add a 'Notes' field to each day that admins can edit, stored in Supabase. Update schema.sql, data.js (both backends), and the day panel."
- "Add a waitlist: when a shift is full, let people join a waitlist and show their position."
- "Let volunteers request a swap with someone else's lane, and the other person can accept."
- "Make the Open spots tab filter by Morning / Afternoon."
- "Review app.js for accessibility problems and fix them."

## Ideas for what's next

1. **Email reminders**: a Vercel Cron job (`/api/remind`) runs each evening and emails tomorrow's volunteers through [Resend](https://resend.com). Needs the Supabase service key as a server-only env var.
2. **Shift swaps and a waitlist**: so full days still have backups.
3. **Vercel Web Analytics**: one toggle in the Vercel dashboard. See which tabs people use.
4. **Google sign-in**: Supabase → Authentication → Providers → Google, plus a button in the sign-in dialog.
5. **Admin shift editor**: move shift times and workdays from `config.js` into the database so admins can change them without code.
6. **Hours certificate**: a printable "Volunteer hours" page per person for service-hour requirements.
7. **QR check-in**: a QR code at the door that marks the person as present, so hours are actual rather than scheduled.

## File map
```
index.html            page skeleton + sign-in dialog
styles.css            design tokens (light/dark) + layout
config.js             org name, shift times, workdays, group defaults
app.js                all the UI
data.js               storage: Preview (localStorage) or Supabase
ics.js                calendar export
api/config.js         Vercel function → public Supabase keys from env vars
supabase/schema.sql   tables + security rules + realtime
vercel.json           headers / clean URLs
.cursor/rules/        instructions for Cursor's AI
```

**Security notes:** the Supabase *anon* key is designed to be public. The row-level security rules in `schema.sql` are what protect the data. Never put the *service_role* key in the frontend or commit it to git.
