# Clickable Front-End Prototype

Start at `index.html`. It redirects to the public product landing page.

## Surfaces

- `marketing/index.html` — public Wedding OS product site
- `app/index.html` — authenticated couple workspace with nine clickable views
- `wedding/index.html` — Tucker and Syd guest-facing wedding-site design preview

## Prototype safety

- This is a local front-end prototype with no backend writes.
- It cannot send invitations, messages, RSVPs, vendor outreach, or payments.
- June 26, 2027 is a tentative planning anchor.
- Walloon Lake Country Club has a hold/first-refusal context but is not booked.
- App counts and operational states labeled as sample/prototype are not wedding records.

## Local preview

Serve the prototype directory:

```sh
python3 -m http.server 4173 --directory /Users/openclaw/.openclaw/workspace-grace/projects/wedding-os/prototype
```

Then open:

`http://localhost:4173/`
