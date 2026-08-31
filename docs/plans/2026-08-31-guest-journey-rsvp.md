---
status: READY_FOR_IMPLEMENTATION
mode: SELECTIVE_EXPANSION
approach: COMPLETE_RSVP_VERTICAL_SLICE
date: 2026-08-31
---

# Guest Journey v1: Reliable Guest Saving and Public RSVP

## Outcome

Ship one trustworthy guest journey for Tucker and Sydney:

1. An Admin adds a household, its guests, event invitations, and event-specific plus-one permissions in one reliable save.
2. Every invitation uses the same QR code and the same public `/rsvp/` page.
3. A guest enters their full name. The server returns only that household's invitation.
4. The household responds by person and event, adds an accepted plus-one and dietary details, reviews, and submits.
5. The response appears immediately in the private RSVP dashboard.
6. The household can edit before the deadline with a private edit PIN.
7. After the Admin-set deadline, public responses are view-only. Tucker, Sydney, or another Admin can apply an exception privately.

This plan does not expose the guest list, create guest accounts, send messages, or publish anything automatically.

## Approved Product Decisions

- Build the complete household invitation system, not a temporary RSVP form.
- Use one shared QR code. Do not generate personalized QR codes.
- Match on normalized full name, never a public list or autocomplete.
- Ask for postal code only when the normalized full name is duplicated.
- Support private aliases and a private help queue for lookup failures.
- Run public lookup and submission through a Supabase Edge Function.
- Use one centrally configured wedding slug now; add domain-to-wedding routing only when a second wedding exists.
- Store an accepted plus-one as a real linked guest, with event invitations and dietary details.
- Save household, guest, events, and plus-one permissions in one database transaction.
- Make RSVP submissions idempotent so retries cannot duplicate companions or responses.
- Let an Admin set the RSVP deadline in the private dashboard.
- Close at 11:59 PM in `America/Detroit` on the selected date.
- After closing, allow viewing but not public submission or editing. Show "Online RSVP has closed. Please contact Tucker or Sydney if you need to make a change."
- Admins can extend/reopen the deadline or apply a response manually. Record actor, timestamp, and reason.

## Current Root Cause

`app/data.js` currently saves a guest and their event assignment in two browser requests:

```text
insert/update guests
        |
        v
upsert guest_events
```

If the first request succeeds and the second fails, the UI reports an error after leaving a partial guest behind. Activity logging is also a third best-effort browser request, so the saved state and its audit record can disagree.

Replace the path with one authenticated database function:

```text
validated form
     |
     v
save_guest_bundle(...)
     |
     +-- household change
     +-- guest change
     +-- event invitations
     +-- event plus-one permissions
     +-- activity record
     |
     v
one commit or one rollback
```

## Scope

### In scope

- Transactional household and guest create/edit flows.
- Multi-event invitations and per-event plus-one permission.
- Mobile guest cards and reliable form states.
- Public `/rsvp/` page matching the wedding site's visual system.
- One shared QR asset for the final `/rsvp/` URL.
- Safe full-name lookup, duplicate-name postal-code challenge, aliases, and lookup help.
- Household RSVP, real linked plus-ones, dietary notes, review, submission, and edit PIN.
- Idempotent retries and response version history.
- Admin-set deadline, public close behavior, manual Admin overrides, and audit history.
- Private RSVP dashboard with counts, filters, response detail, help requests, and recent changes.
- Rate limiting, retention limits, RLS verification, mobile/accessibility QA, and rollback gates.

### Explicitly deferred

- Reminder emails or texts.
- Automatic messages to guests, Tucker, or Sydney.
- Seating charts, meal-count exports, invitation printing, and analytics beyond launch-safe RSVP totals.
- Guest accounts, magic links, or social login.
- Personalized QR codes or household codes printed on invitations.
- Multi-wedding domain mapping and a second paid domain.
- Website editor, two-partner public publishing, and registry publishing; those remain in the separate control-center plan.

## User Experience

### Admin guest setup

```text
Guests -> Add household or choose household
       -> Add/edit named guest
       -> Select invited events
       -> Set plus-one allowed per event
       -> Save
       -> server commits everything
       -> UI reloads the saved record and shows success
```

The form must show event checkboxes rather than today's single-event select. A plus-one toggle appears under each selected event. Saving is disabled while the transaction runs. On failure, the dialog stays open with all input preserved.

### Public first response

```text
shared QR or /rsvp/
       -> full first + last name
       -> exact normalized match?
          | yes, unique -> short-lived household session
          | duplicate   -> request postal code
          | no match    -> neutral error + optional help request
       -> household invitation
       -> answers by guest and event
       -> accepted plus-one name/details
       -> dietary details for attendees
       -> review
       -> idempotent submit
       -> confirmation + private edit PIN
```

The initial response page reveals only the matched household, invited events, public event details, and allowed response fields. It never returns another household, internal UUIDs, notes, addresses, member records, or Admin data.

### Edit before deadline

```text
full name -> matched household -> "Edit an existing RSVP"
          -> enter edit PIN
          -> short-lived edit session
          -> change response
          -> new response version
          -> confirmation
```

Store only a slow hash of the edit PIN. Never log or return it after the first confirmation screen. An Admin can reset the PIN from the private dashboard after confirming the household.

### After deadline

```text
lookup -> invitation and current confirmation remain viewable
       -> response controls disabled
       -> contact Tucker or Sydney copy

Admin dashboard -> change response
                -> required reason
                -> audit event
```

Changing or reopening the deadline is Admin-only and audited. Deadline checks run server-side on lookup, unlock, and submit; hiding a browser button is not the security boundary.

## Data Model

Use additive migrations. Keep existing columns readable during rollout.

### `wedding_rsvp_settings`

```text
wedding_id uuid primary key -> weddings.id
deadline_date date null
contact_copy text not null
is_manually_closed boolean not null default false
updated_by uuid null -> auth.users.id
updated_at timestamptz not null
```

The effective close instant is the end of `deadline_date` in `weddings.timezone`. A manual close wins over the date. A null date means not yet configured; the public page remains unavailable until an Admin explicitly opens RSVP.

### Guest and invitation changes

```text
guests
  + guest_kind text not null default 'named'
      check in ('named', 'plus_one')
  + linked_to_guest_id uuid null -> guests.id
  + is_active boolean not null default true
  + version bigint not null default 1

guest_events
  + plus_one_allowed boolean not null default false
  + version bigint not null default 1
```

Migrate the legacy `guests.plus_one_allowed=true` value onto each currently invited `guest_events` row, then stop writing the legacy field. Keep it temporarily for frontend compatibility and remove it only in a later cleanup migration.

Add a partial unique index allowing at most one active linked plus-one per named guest. The linked plus-one receives only the events where the named guest is invited and `plus_one_allowed=true`.

### `guest_name_aliases`

```text
id uuid primary key
wedding_id uuid not null
guest_id uuid not null
alias text not null
normalized_alias text not null
created_by uuid null
created_at timestamptz not null
unique(wedding_id, normalized_alias, guest_id)
```

Aliases are private and available only to authenticated wedding members and the RSVP gateway. Existing `preferred_name` is included automatically in matching.

### `rsvp_access_sessions`

```text
id uuid primary key
wedding_id uuid not null
household_id uuid not null
token_hash text not null unique
mode text check in ('initial', 'edit', 'view')
expires_at timestamptz not null
created_at timestamptz not null
consumed_at timestamptz null
```

Return the raw opaque token only to the guest browser. Store only its hash. Initial/edit sessions expire quickly and are scoped to one household.

### `household_rsvp_credentials`

```text
household_id uuid primary key
edit_pin_hash text null
pin_failed_attempts integer not null default 0
pin_locked_until timestamptz null
updated_at timestamptz not null
```

The PIN is generated only after the first successful submission. Hash with PostgreSQL `crypt()` and a bcrypt salt. Rate-limit attempts independently of name lookup.

### `rsvp_submissions`

```text
id uuid primary key
wedding_id uuid not null
household_id uuid not null
version bigint not null
idempotency_key_hash text not null
request_hash text not null
response_snapshot jsonb not null
source text check in ('guest', 'admin')
actor_user_id uuid null
change_reason text null
created_at timestamptz not null
unique(household_id, version)
unique(household_id, idempotency_key_hash)
```

The normalized response snapshot provides history. Current operational status remains on `guest_events` for simple dashboard counts. The submission transaction updates both together.

### `rsvp_help_requests`

```text
id uuid primary key
wedding_id uuid not null
entered_name text not null
contact_method text null
message text null
reason text check in ('lookup_failed', 'duplicate_unresolved')
status text check in ('open', 'resolved', 'dismissed')
resolved_by uuid null
resolved_at timestamptz null
created_at timestamptz not null
```

Limit every public field's length. Treat it as untrusted input. Do not send anything automatically.

### Rate-limit storage

Store a rotating hash of IP plus wedding, action, and time bucket. Do not persist raw IP addresses or raw attempted names. Retain buckets for no more than seven days and remove them with a scheduled database cleanup.

## Server Contracts

### Authenticated transactional RPCs

```text
save_guest_bundle(payload jsonb, expected_version bigint null) -> saved bundle
save_rsvp_settings(deadline_date date, contact_copy text, is_manually_closed boolean)
admin_apply_rsvp(household_id uuid, response jsonb, reason text, idempotency_key text)
reset_household_edit_pin(household_id uuid) -> one-time new PIN
resolve_rsvp_help_request(request_id uuid, status text)
```

All derive wedding and actor identity from `auth.uid()`. Do not accept a caller-supplied wedding role. `save_guest_bundle` validates every referenced household, guest, and event belongs to the actor's wedding before writing.

### Public Supabase Edge Function

Deploy one `rsvp` function with explicit actions:

```text
POST /rsvp/lookup
POST /rsvp/unlock-edit
POST /rsvp/submit
POST /rsvp/help
```

The function reads `WEDDING_SLUG=tucker-and-syd` from server configuration. The browser never supplies a wedding ID or slug. Allow CORS only from the Cloudflare preview origin and the final custom domain.

The Edge Function holds the service credential, but calls narrow database functions rather than constructing unrestricted table queries. Database functions re-check session scope, deadline state, event permissions, plus-one permissions, and idempotency.

### Idempotency rules

1. The review step receives a random submission key.
2. The database stores its hash with the normalized request hash.
3. Repeating the same key and same request returns the original success.
4. Repeating the same key with a different request returns `SUBMISSION_KEY_REUSED` and writes nothing.
5. A real edit uses a fresh key and creates the next response version.

## Name Matching and Privacy

Normalize server-side with Unicode normalization, lowercase, collapsed whitespace, and consistent punctuation/hyphen handling. Match only:

- canonical first + last name;
- preferred first + last name;
- explicitly stored private aliases.

Do not use fuzzy matching. Do not return suggestions or match counts.

```text
0 matches -> generic not-found response
1 match   -> household session
2+ matches with distinct postal codes -> request postal code
2+ matches still ambiguous -> generic unresolved response + help option
```

Externally, lookup failures use neutral copy and a consistent response shape. Internally, structured diagnostics may distinguish the path without logging the raw name.

## Named Error Registry

| Code | Trigger | Transaction result | Guest/Admin experience | Test |
|---|---|---|---|---|
| `RSVP_NOT_CONFIGURED` | No Admin deadline/open state exists | No write | RSVP is not open yet | Edge + browser |
| `LOOKUP_NOT_FOUND` | No normalized name/alias match | No write | Neutral not-found copy and help option | SQL + Edge |
| `POSTAL_REQUIRED` | More than one normalized name match | No write | Postal-code field appears | SQL + browser |
| `LOOKUP_UNRESOLVED` | Postal code still does not identify one household | No write | Neutral failure and help option | SQL + Edge |
| `RATE_LIMITED` | Lookup/help/IP bucket exceeds threshold | No write | Wait-and-retry copy, no match information | Edge |
| `SESSION_EXPIRED` | Household token expired or was revoked | No write | Restart lookup; preserve unsent answers locally | SQL + browser |
| `DEADLINE_CLOSED` | Submit/unlock after close instant | No write | View-only invitation and contact copy | SQL + browser |
| `PIN_INVALID` | Edit PIN does not verify | No write; increment bounded counter | Generic invalid PIN message | SQL + Edge |
| `PIN_LOCKED` | Too many PIN failures | No write | Temporary lock message and contact copy | SQL + Edge |
| `INVITATION_CHANGED` | Admin changed events after guest loaded review | No write | Reload invitation and review changes | SQL + browser |
| `SUBMISSION_KEY_REUSED` | Same key, different normalized payload | No write | Restart review safely | SQL + Edge |
| `INVALID_PLUS_ONE` | Companion requested for a disallowed event | Full rollback | Refresh invitation; no partial companion | SQL |
| `VALIDATION_FAILED` | Missing answer/name or oversized text | Full rollback | Specific field message | Unit + browser |
| `SERVICE_UNAVAILABLE` | Edge/DB timeout or network failure | Unknown until status check | "Checking whether your response saved" then one safe retry | Edge + browser |

No public error includes guest names, household names, UUIDs, database messages, or whether a guessed person is invited.

## Private Dashboard

Replace the sample RSVP page in `app/app.js` with live views:

- deadline status and Admin edit controls;
- shared RSVP URL and QR preview;
- invited, attending, declined, pending, and response-rate counts;
- counts by event, including active accepted plus-ones;
- household response list and detail drawer;
- dietary notes requiring review;
- open lookup-help requests;
- recent response changes and Admin overrides;
- filters for event, status, household, dietary note, help needed, and changed recently.

Members may view RSVP data and edit guest records. Admin-only controls are deadline changes, PIN reset, manual RSVP override, and help-request resolution.

## Public Page and QR

Add `rsvp/index.html`, `rsvp/styles.css`, and `rsvp/app.js`. Reuse the wedding site's fonts, colors, spacing, buttons, focus styles, and footer. The page owns a small explicit state machine:

```text
LOOKUP -> POSTAL_CHECK -> INVITATION -> REVIEW -> SUBMITTING -> CONFIRMED
   |           |              |             |          |
   +------ HELP/ERROR <--------+-------------+----------+

CONFIRMED -> PIN_UNLOCK -> INVITATION(edit) -> REVIEW -> CONFIRMED
```

Generate one QR code only after the final custom domain spelling is confirmed. The encoded value must be exactly the canonical HTTPS `/rsvp/` URL, with no tracking parameters or household data. Use a maintained offline QR generator during development and commit the resulting SVG plus a high-resolution PNG. Do not load a third-party runtime QR script on the guest page.

Until the custom domain is connected, the dashboard may preview a clearly labeled test QR for the `pages.dev` URL, but it must not present that asset as invitation-ready.

## File-Level Implementation Map

```text
supabase/migrations/<timestamp>_rsvp_guest_journey.sql
  additive tables, columns, indexes, RLS, transactional RPCs, grants

supabase/functions/rsvp/index.ts
  CORS, action routing, rate limits, generic error mapping

app/data.js
  replace two-step guest save; add multi-event form; load RSVP dashboard/settings

app/app.js
  route real RSVP view; remove sample RSVP metrics/actions

app/styles.css
  mobile guest cards, RSVP dashboard, settings/deadline/help states

rsvp/index.html
rsvp/app.js
rsvp/styles.css
  public guest journey and state machine

assets/rsvp-qr.svg
assets/rsvp-qr.png
  one final-domain QR generated at launch gate

tests/guest-save.test.mjs
tests/rsvp-ui.test.mjs
supabase/tests/rsvp_guest_journey.sql
supabase/functions/rsvp/index.test.ts
  validation, transaction, RLS, Edge, and UI contracts
```

## Security Boundary

- Keep RLS enabled on every RSVP table.
- Grant anonymous users no direct table access.
- Revoke public execution on internal database functions; grant only the Edge Function's service path or authenticated roles as appropriate.
- Derive authenticated wedding access from `auth.uid()`.
- Keep service-role credentials only in Supabase function secrets.
- Enforce deadline, invitation version, plus-one permission, and session scope in the database transaction.
- Hash edit PINs, session tokens, idempotency keys, and rate-limit identifiers.
- Escape all returned text at render time and enforce server-side length limits.
- Never log raw names, postal codes, addresses, dietary notes, PINs, session tokens, or response payloads.
- Apply generic public error mapping and bounded request sizes.

## Test Matrix

### Database

- Household + guest + three event invitations commit together.
- Invalid event causes full rollback, including activity log.
- Cross-wedding household/event IDs are rejected.
- Stale `expected_version` is rejected without overwriting.
- Legacy plus-one permission migrates correctly.
- Accepted plus-one becomes one linked active guest and correct event assignments.
- Declining later deactivates the linked guest without deleting history.
- Same idempotency key and same payload returns original success.
- Same idempotency key and different payload writes nothing.
- Guest and Admin submissions create ordered versions.
- Deadline closes at the correct Detroit instant, including DST boundaries.
- Admin override works after deadline and requires a reason.
- Member cannot change deadline, reset PIN, or apply Admin RSVP.
- Anonymous role cannot select any private table.

### Edge Function

- Unique full-name, preferred-name, and alias matches.
- Duplicate full name requests postal code.
- Wrong postal code and missing name use neutral output.
- Raw name and raw IP never appear in diagnostic records.
- Rate limits apply per action and recover after the window.
- Expired/revoked session cannot read or submit.
- Origin allowlist rejects an unapproved website.
- Timeout maps to `SERVICE_UNAVAILABLE` without leaking database errors.

### Browser and accessibility

- 320x568, 390x844, 430x932, tablet, and desktop.
- QR landing, keyboard-only lookup, screen-reader labels, focus order, error focus, and 44px controls.
- Back button from every step.
- Refresh during invitation, review, submitting, and confirmation.
- Double tap, offline submit, lost response, and safe retry.
- Navigate away during guest save with form input preserved when possible.
- Deadline changes while a guest is on the review screen.
- Invitation changes while a guest is on the review screen.
- PIN failure, temporary lock, Admin reset, and successful edit.
- No horizontal overflow, console errors, or private data in URLs/local storage.

## Delivery Order and Gates

```text
Gate 0: snapshot production schema/data and establish isolated QA wedding
   -> no automated test writes to Tucker & Sydney's real guest data

Gate 1: additive schema + RLS + transactional guest RPC
   -> database tests pass
   -> deploy migration
   -> switch private guest form to RPC
   -> verify real manual guest create/edit/delete with Tucker approval

Gate 2: public lookup and rate limits
   -> deploy Edge Function disabled by RSVP configuration
   -> verify no private table access and neutral failure behavior

Gate 3: submission, linked plus-one, PIN edits, idempotency
   -> full QA household journey passes on mobile and desktop
   -> deadline remains closed for real guests

Gate 4: private RSVP dashboard and Admin deadline controls
   -> Tucker/Sydney can inspect responses and apply an override

Gate 5: Cloudflare route and preview-domain smoke test
   -> `/rsvp/` loads from the public wedding site
   -> auth/login/app routes remain unchanged

Gate 6: final custom domain
   -> confirm exact spelling
   -> connect domain and allow origin
   -> update Supabase auth redirects
   -> generate final QR assets
   -> run one end-to-end real-device RSVP rehearsal

Gate 7: launch
   -> set deadline/contact copy
   -> explicitly open RSVP
   -> verify monitoring and rollback path
```

Do not enable real public RSVP before Gates 1-6 pass. The default configuration is closed.

## Observability and Operations

- Record structured action code, outcome, latency bucket, wedding ID, and hashed request identifier.
- Dashboard shows Edge failures, rate-limit spikes, open help requests, and submission failures without guest PII in logs.
- Add a short runbook covering: close RSVP, reopen RSVP, reset PIN, resolve lookup failure, inspect a submission retry, and disable the Edge Function.
- Retain response/audit history for wedding operations. Delete transient access sessions after expiry and rate-limit buckets after seven days.
- Alerting can remain manual for v1: the private dashboard visibly flags unresolved help requests and repeated service failures. External paging/email is out of scope.

## Rollback

- Migrations are additive and the public RSVP setting defaults closed.
- If the guest RPC fails, restore the prior frontend only after confirming no partial browser writes are re-enabled; prefer fixing the RPC while keeping Add Guest temporarily disabled.
- If the Edge Function fails, close RSVP in settings and keep the wedding website online.
- If the public page deployment fails, remove the RSVP navigation link and leave `/wedding/`, `/login/`, and `/app/` unchanged.
- Do not drop RSVP tables during an incident. Preserve submissions and audit history, then roll forward.

## Definition of Done

- A guest bundle cannot be partially saved.
- A single shared QR reaches a polished `/rsvp/` page.
- No public response enumerates or suggests guest names.
- A household sees only its own invitation.
- Multi-event attendance, dietary notes, and plus-ones save atomically.
- Retry after a lost connection cannot duplicate data.
- Existing responses are editable only with the private PIN before the deadline.
- Admin-set deadline closes public mutation server-side at the correct local time.
- Admin overrides after deadline are possible and audited.
- Tucker and Sydney see accurate live counts, help requests, and response history.
- Cross-wedding, anonymous-table, rate-limit, mobile, and accessibility tests pass.
- The real RSVP configuration remains closed until the custom domain and final QR are verified.

## GSTACK REVIEW REPORT

**Status:** READY_FOR_IMPLEMENTATION

**CEO call:** Build the complete guest-to-dashboard vertical slice. Do not ship a name-search demo that can leak the guest list or create partial records.

**Largest current risk removed:** Guest and event assignment become one transaction, eliminating the observed "save failed but data may exist" state.

**Launch-critical watch items:** exact custom-domain spelling, isolated QA data, server-side deadline enforcement, neutral lookup failures, and service-role containment inside the Edge Function.

**Not in scope:** messaging, reminders, seating, guest accounts, personalized QR codes, and multi-wedding domain routing.
