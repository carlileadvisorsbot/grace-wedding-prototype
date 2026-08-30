import { isSupabaseConfigured, supabase } from '../shared/supabase.js';

const form = document.getElementById('loginForm');
const email = document.getElementById('email');
const password = document.getElementById('password');
const confirmPassword = document.getElementById('confirmPassword');
const confirmField = document.getElementById('confirmField');
const button = document.getElementById('submitButton');
const notice = document.getElementById('notice');
const signInTab = document.getElementById('signInTab');
const signUpTab = document.getElementById('signUpTab');
const authTabs = document.getElementById('authTabs');
const authTitle = document.getElementById('authTitle');
const authIntro = document.getElementById('authIntro');
const passwordLabel = document.getElementById('passwordLabel');
const forgotPassword = document.getElementById('forgotPassword');
const requestedNext = new URLSearchParams(window.location.search).get('next');
const safeNext = requestedNext && new URL(requestedNext, window.location.href).origin === window.location.origin
  ? requestedNext
  : new URL('../app/', window.location.href).href;
const resetMode = new URLSearchParams(window.location.search).get('reset') === '1';
const signUpMode = new URLSearchParams(window.location.search).get('mode') === 'signup';
let mode = 'signIn';

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.className = `notice show${isError ? ' error' : ''}`;
}

function friendlyAuthError(error, fallback) {
  const message = String(error?.message || '');
  if (/invalid login credentials/i.test(message)) return 'That email and password do not match. Try again or reset your password.';
  if (/already registered|already exists/i.test(message)) return 'An account already exists for that email. Log in instead.';
  if (/password/i.test(message) && /least|short|weak/i.test(message)) return 'Choose a password with at least 8 characters.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a few minutes, then try again.';
  return fallback;
}

function setMode(nextMode) {
  mode = nextMode;
  const signingUp = mode === 'signUp';
  const resetting = mode === 'reset';
  authTabs.hidden = resetting;
  email.closest('label')?.removeAttribute('hidden');
  email.hidden = resetting;
  document.querySelector('label[for="email"]').hidden = resetting;
  confirmField.hidden = !signingUp;
  confirmPassword.required = signingUp;
  password.autocomplete = signingUp || resetting ? 'new-password' : 'current-password';
  passwordLabel.textContent = resetting ? 'New password' : 'Password';
  signInTab.classList.toggle('active', !signingUp);
  signInTab.setAttribute('aria-selected', String(!signingUp));
  signUpTab.classList.toggle('active', signingUp);
  signUpTab.setAttribute('aria-selected', String(signingUp));
  authTitle.textContent = resetting ? 'Choose a new password.' : signingUp ? 'Create your account.' : 'Welcome back.';
  authIntro.textContent = resetting
    ? 'Use at least 8 characters. Your new password will work immediately.'
    : signingUp
      ? 'Use your pre-approved partner email. After verification, enter the wedding code to join the shared workspace.'
      : 'Log in with the email and password you chose for your private wedding workspace.';
  button.textContent = resetting ? 'Save new password' : signingUp ? 'Create account' : 'Log in';
  forgotPassword.hidden = signingUp || resetting;
  notice.className = 'notice';
  notice.textContent = '';
}

if (!isSupabaseConfigured) {
  form.hidden = true;
  showNotice('Supabase is ready to connect, but this deployment still needs its project URL and publishable key.');
} else {
  const { data: { session } } = await supabase.auth.getSession();
  if (resetMode) {
    if (session) setMode('reset');
    else showNotice('Open the newest password-reset link from your email to continue.', true);
  } else if (session) {
    window.location.replace(safeNext);
  } else if (signUpMode) {
    setMode('signUp');
  }
}

signInTab.addEventListener('click', () => setMode('signIn'));
signUpTab.addEventListener('click', () => setMode('signUp'));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!isSupabaseConfigured) return;
  button.disabled = true;
  button.textContent = mode === 'reset' ? 'Saving…' : mode === 'signUp' ? 'Creating…' : 'Logging in…';

  if (mode === 'reset') {
    const { error } = await supabase.auth.updateUser({ password: password.value });
    if (error) {
      showNotice(friendlyAuthError(error, 'We could not update your password. Open a new reset link and try again.'), true);
      button.disabled = false;
      button.textContent = 'Save new password';
      return;
    }
    showNotice('Password updated. Opening your wedding workspace…');
    window.setTimeout(() => window.location.replace(safeNext), 500);
    return;
  }

  if (mode === 'signUp') {
    if (password.value !== confirmPassword.value) {
      showNotice('The two passwords do not match.', true);
      confirmPassword.focus();
      button.disabled = false;
      button.textContent = 'Create account';
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.value.trim(),
      password: password.value,
      options: { emailRedirectTo: safeNext },
    });
    if (error || data.user?.identities?.length === 0) {
      showNotice(friendlyAuthError(error, 'We could not create that account. Check the email and password, then try again.'), true);
      button.disabled = false;
      button.textContent = 'Create account';
      return;
    }
    if (data.session) {
      window.location.replace(safeNext);
      return;
    }
    form.reset();
    showNotice('Account created. Check your email to verify it, then you’ll enter the wedding code.');
    button.textContent = 'Check your email';
    return;
  }

  const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
  if (error) {
    showNotice(friendlyAuthError(error, 'We could not log you in. Check your email and password, then try again.'), true);
    button.disabled = false;
    button.textContent = 'Log in';
    return;
  }
  window.location.replace(safeNext);
});

forgotPassword.addEventListener('click', async () => {
  if (!email.reportValidity()) return;
  forgotPassword.disabled = true;
  const redirectTo = new URL('./?reset=1', window.location.href).href;
  const { error } = await supabase.auth.resetPasswordForEmail(email.value.trim(), { redirectTo });
  if (error) showNotice(friendlyAuthError(error, 'We could not send a reset email. Try again in a moment.'), true);
  else showNotice('Check your email for a password-reset link.');
  forgotPassword.disabled = false;
});
