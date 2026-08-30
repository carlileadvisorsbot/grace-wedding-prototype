# Grace wedding site and couple workspace

Start at `index.html`. It redirects to the public product landing page.

## Surfaces

- `marketing/index.html` — public Wedding OS product site
- `login/index.html` — Supabase magic-link login
- `app/index.html` — private couple workspace with nine clickable views
- `wedding/index.html` — Tucker and Syd guest-facing wedding-site design preview

See `SUPABASE_SETUP.md` to connect authentication and shared wedding data.

## Prototype safety

- Without Supabase configuration, the workspace remains a local front-end prototype with no backend writes.
- With Supabase configured, authentication, wedding membership, Guests, Households, event assignment, and Registry are live. Other dashboard panels remain clearly labeled prototype views until they are connected.
- It cannot send invitations, messages, RSVPs, vendor outreach, or payments.
- June 26, 2027 at Walloon Lake Country Club is the confirmed wedding plan.
- Ceremony time, travel, lodging, dress code, registry, and RSVP-method details remain to come.
- App counts and operational states labeled as sample/prototype are not wedding records.

## Local preview

Serve the prototype directory:

```sh
python3 -m http.server 4173 --directory /Users/openclaw/.openclaw/workspace-grace/projects/wedding-os/prototype
```

Then open:

`http://localhost:4173/`
