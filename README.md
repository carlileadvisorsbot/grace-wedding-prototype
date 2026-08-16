# Clickable Front-End Prototype

Start at `index.html`. It redirects to the public product landing page.

## Surfaces

- `marketing/index.html` — public Wedding OS product site
- `app/index.html` — authenticated couple workspace with nine clickable views
- `wedding/index.html` — Tucker and Syd guest-facing wedding-site design preview

## Prototype safety

- This is a local front-end prototype with no backend writes.
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
