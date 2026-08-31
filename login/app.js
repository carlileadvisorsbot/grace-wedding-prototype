import { isSupabaseConfigured, supabase } from '../shared/supabase.js';
import {
  friendlyAuthError,
  getRecoveryRedirect,
  getSignUpErrorMessage,
  isValidSignupCode,
  resolveSafeNext,
} from './auth-helpers.js';

const form = document.getElementById('loginForm');
const email = document.getElementById('email');
const password = document.getElementById('password');
const confirmPassword = document.getElementById('confirmPassword');
const confirmField = document.getElementById('confirmField');
const signupCode = document.getElementById('signupCode');
const signupCodeField = document.getElementById('signupCodeField');
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
const safeNext = resolveSafeNext(requestedNext, window.location.href);
const resetMode = new URLSearchParams(window.location.search).get('reset') === '1';
const signUpMode = new URLSearchParams(window.location.search).get('mode') === 'signup';
let mode = 'signIn';

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.className = `notice show${isError ? ' error' : ''}`;
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
  signupCodeField.hidden = !signingUp;
  signupCode.required = signingUp;
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
      ? 'Use any email, choose a password, and enter the signup code for the wedding workspace you are joining.'
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
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) setMode('reset');
  });
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
    if (!isValidSignupCode(signupCode.value)) {
      showNotice('Enter the six-digit signup code for your wedding workspace.', true);
      signupCode.focus();
      button.disabled = false;
      button.textContent = 'Create account';
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.value.trim(),
      password: password.value,
      options: {
        emailRedirectTo: safeNext,
        data: { signup_code: signupCode.value },
      },
    });
    const signUpError = getSignUpErrorMessage(data, error);
    if (signUpError) {
      showNotice(signUpError, true);
      button.disabled = false;
      button.textContent = 'Create account';
      return;
    }
    if (data.session) {
      window.location.replace(safeNext);
      return;
    }
    form.reset();
    showNotice('Account created. Check your email to verify it; your wedding workspace will open automatically.');
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
  const redirectTo = getRecoveryRedirect(window.location.href);
  const { error } = await supabase.auth.resetPasswordForEmail(email.value.trim(), { redirectTo });
  if (error) showNotice(friendlyAuthError(error, 'We could not send a reset email. Try again in a moment.'), true);
  else showNotice('Check your email for a password-reset link.');
  forgotPassword.disabled = false;
});
