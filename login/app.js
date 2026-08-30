import { isSupabaseConfigured, supabase } from '../shared/supabase.js';

const form = document.getElementById('loginForm');
const email = document.getElementById('email');
const button = document.getElementById('submitButton');
const notice = document.getElementById('notice');

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.className = `notice show${isError ? ' error' : ''}`;
}

if (!isSupabaseConfigured) {
  form.hidden = true;
  showNotice('Supabase is ready to connect, but this deployment still needs its project URL and publishable key.');
} else {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) window.location.replace(new URL('../app/', window.location.href).href);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!isSupabaseConfigured) return;
  button.disabled = true;
  button.textContent = 'Sending…';

  const requestedNext = new URLSearchParams(window.location.search).get('next');
  const safeNext = requestedNext && new URL(requestedNext, window.location.href).origin === window.location.origin
    ? requestedNext
    : new URL('../app/', window.location.href).href;

  const { error } = await supabase.auth.signInWithOtp({
    email: email.value.trim(),
    options: {
      emailRedirectTo: safeNext,
      shouldCreateUser: true,
    },
  });

  if (error) {
    showNotice(error.message, true);
    button.disabled = false;
    button.textContent = 'Email me a sign-in link';
    return;
  }

  form.reset();
  showNotice('Check your inbox for your secure Grace sign-in link. You can close this page.');
  button.textContent = 'Link sent';
});
