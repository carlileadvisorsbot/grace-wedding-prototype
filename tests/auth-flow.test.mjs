import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getRecoveryRedirect,
  getSignUpErrorMessage,
  resolveSafeNext,
} from '../login/auth-helpers.js';

test('password recovery returns to the login reset screen on the current origin', () => {
  assert.equal(
    getRecoveryRedirect('https://grace-wedding-prototype-5gl.pages.dev/login/'),
    'https://grace-wedding-prototype-5gl.pages.dev/login/?reset=1',
  );
});

test('an existing Supabase identity gets an actionable login message', () => {
  assert.equal(
    getSignUpErrorMessage({ user: { identities: [] } }, null),
    'An account already exists for that email. Log in or reset its password instead.',
  );
});

test('post-auth navigation cannot leave the current origin', () => {
  const current = 'https://grace-wedding-prototype-5gl.pages.dev/login/';
  assert.equal(
    resolveSafeNext('https://example.com/steal-session', current),
    'https://grace-wedding-prototype-5gl.pages.dev/app/',
  );
});
