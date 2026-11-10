# Magnolia Shift Board

A volunteer sign-up board. Pick a day, take an open **lane**, and you're on the schedule. Every lane rotates through five groups one hour at a time, so a full shift covers every group every hour.

**Stack:** plain HTML/CSS/JS (no build step) · **Supabase** for logins, database and live updates · **Vercel** for hosting · **GitHub** for the code · **Cursor** for editing.

```
You edit in Cursor ──push──▶ GitHub ──auto-deploy──▶ Vercel (live site)
                                                        │
                                   Supabase (logins + sign-ups) ◀── the browser talks to it directly
```

## What's in it

| Tab | What it does |
|---|---|
| **Month** | Calendar with colored lane markers; click a day to take, switch, or drop a lane. |
| **Open spots** | Every unfilled shift in the next 3 weeks, with one-tap "Take lane." Picks the lane that keeps your day continuous. |
| **My schedule** | Your shifts, hours by group, and **Add to my calendar** (.ics file with 1-hour reminders). |
| **How it works** | The rotation explained with an example grid. |
| **Admin** *(admins only)* | Coverage %, volunteer hours, thinnest upcoming days, roster, CSV export, print, remove people, rename groups. |

Also: email magic-link sign-in (no passwords), live updates across everyone's screens, the database blocks double-booking, past days are locked, dark mode, installs to a phone home screen.

**Preview mode:** without Supabase keys, the site runs on demo data saved only in your browser. Good for designing in Cursor.

---

## Setup (about 20 minutes, all free tiers)

### 1. Put the code on GitHub
**Easiest (Cursor):** open this folder in Cursor → Source Control panel (left sidebar) → **Publish to GitHub** → choose **Private** → done.

**Or on github.com:** New repository → name it `magnolia-shift-board` → Create → "uploading an existing file" → drag in everything in this folder → Commit.

### 2. Create the database (Supabase)
1. Go to [supabase.com](https://supabase.com) → **New project** (pick a region near you, save the password somewhere).
2. Left sidebar → **SQL Editor** → **New query** → paste all of `supabase/schema.sql` → **Run**.
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
