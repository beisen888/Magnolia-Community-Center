# Handing this board to a client

There are two ways to deliver it. Pick one per client.

## Option A: Transfer this exact board (they take over what's running)

Everything lives in three accounts. Move each one to the client:

| Piece | How to transfer | Where |
|---|---|---|
| **Code** (GitHub) | Repo → Settings → General → Danger Zone → **Transfer ownership** → client's GitHub username | github.com |
| **Website** (Vercel) | Project → Settings → General → **Transfer Project** → client's Vercel account/team | vercel.com |
| **Database + logins** (Supabase) | Project → Settings → General → **Transfer project** → client's Supabase organization. (Or: invite them to your org as Owner, then leave it.) | supabase.com |

Order: **Supabase → GitHub → Vercel.** After the GitHub transfer, re-link Git in Vercel (Project → Settings → Git) if it disconnects.

**Admins:** the client signs in on the site, then any current admin opens **Admin → People & admins → Make admin**. When they're set up, they can remove your admin access the same way.

**Billing note:** Vercel's free Hobby plan is for personal, non-commercial use. A business client should be on their own Vercel account (Pro, or Hobby if they're a qualifying non-profit). Supabase's free tier is fine for a board this size, but free projects pause after 1 week of no activity, so an active org won't notice.

## Option B: They build their own copy (template)

1. In GitHub: this repo → Settings → check **Template repository**.
2. Client clicks **Use this template → Create a new repository** on their account.
3. They follow **README → Setup** (Supabase project → run `supabase/schema.sql` → import to Vercel).
4. In their copy's `config.js`: set their Supabase URL + publishable key, org name, shift times, and groups.
5. First person to sign in clicks **Claim admin**. That's the owner. They add more admins from the Admin tab.

## What the client can change without code
- Group names: **Rename groups** (admins)
- Admins: **Admin → People & admins**
- Remove anyone's sign-up: **Remove** on a day (admins)

## What needs a code change (Cursor)
- Org name, shift times, workdays: `config.js`
- Colors / look: `styles.css` (`:root` variables)
- New features: see README → Ideas
