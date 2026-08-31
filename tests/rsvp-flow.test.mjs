import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260831182500_guest_journey_rsvp.sql', import.meta.url), 'utf8');
const data = await readFile(new URL('../app/data.js', import.meta.url), 'utf8');
const publicApp = await readFile(new URL('../rsvp/app.js', import.meta.url), 'utf8');
const weddingPage = await readFile(new URL('../wedding/index.html', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/rsvp/index.ts', import.meta.url), 'utf8');

test('guest and event invitations route through one transactional RPC', () => {
  assert.match(migration, /function public\.save_guest_bundle/);
  assert.match(data, /supabase\.rpc\('save_guest_bundle'/);
  assert.doesNotMatch(data, /from\('guest_events'\)\.upsert/);
});

test('RSVP is closed unless admins configure and open it', () => {
  assert.match(migration, /is_manually_closed boolean not null default true/);
  assert.match(edge, /!settings\?\.deadline_date \|\| settings\.is_manually_closed/);
});

test('main wedding site links to RSVP while the closed page hides lookup', () => {
  assert.match(weddingPage, /href="\.\.\/rsvp\/">RSVP</);
  assert.match(weddingPage, /href="\.\.\/rsvp\/">RSVP here</);
  assert.match(publicApp, /if\(data\.closed\)\{form\.hidden=true/);
});

test('public lookup never renders raw HTML from guest data', () => {
  assert.match(publicApp, /const escape=/);
  assert.match(publicApp, /escape\(g\.name\)/);
});

test('gateway is scoped to an origin allowlist and server wedding slug', () => {
  assert.match(edge, /RSVP_ALLOWED_ORIGINS/);
  assert.match(edge, /WEDDING_SLUG/);
  assert.match(edge, /ORIGIN_NOT_ALLOWED/);
});
