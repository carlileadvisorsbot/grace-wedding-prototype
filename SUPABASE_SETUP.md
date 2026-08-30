# Supabase setup

This first vertical slice turns the existing couple dashboard into a real private room while leaving the guest site intact. It adds magic-link authentication, equal partner membership, live Guests, Households, event assignment, Registry management, shared wedding metadata, and Row Level Security.

## Information needed

- A new Supabase project on the Free plan
- The project's URL
- The project's **publishable** key (or legacy `anon` key)
- The email address each partner will use to sign in

Never copy a `service_role` or secret key into this repository or browser code.

## 1. Create the Supabase project

Create a project at <https://supabase.com/dashboard>. Use a strong database password and store it in a password manager. The project region should be close to Michigan; the exact region is not important for this prototype.

## 2. Create the database

Open **SQL Editor** in the Supabase dashboard and run:

`supabase/migrations/20260830210000_initial_wedding_room.sql`

The migration enables Row Level Security on every private table. A signed-in user can only read rows for a wedding where that user is a member.

## 3. Configure login redirects

In **Authentication → URL Configuration**, set:

- Site URL: `https://carlileadvisorsbot.github.io/grace-wedding-prototype/`
- Additional Redirect URL: `https://carlileadvisorsbot.github.io/grace-wedding-prototype/app/`
- Local development redirect: `http://localhost:4173/app/`

## 4. Connect the browser app

In **Project Settings → API**, copy the project URL and publishable key into:

`shared/supabase-config.js`

These values identify the Supabase project; security comes from authentication and the database policies. They are intentionally safe for a public browser bundle.

## 5. Claim the two partner accounts

The two approved partner emails are seeded as pending memberships. Open `/login/`, enter each partner email separately, use the emailed magic link, and enter the shared four-digit wedding code once.

Each partner gets a separate login and equal `partner` membership in the same wedding room.

## 6. Verify

1. Open `/app/` in a private browser window. It should redirect to `/login/`.
2. Sign in as Tucker. The dashboard header should say “Connected securely to Supabase.”
3. Sign out and sign in as Syd. The same wedding room should appear.
4. Confirm neither account can query a wedding where it is not a member.

## Current boundary

Authentication, wedding membership, Guests, Households, event assignment, and Registry are live. The Room, Overview, Website, RSVP summary, Tasks, Budget, and Vendors panels still show clearly labeled prototype data. The next slices should connect planning items and published website sections, then open the household RSVP flow only after couple approval.
