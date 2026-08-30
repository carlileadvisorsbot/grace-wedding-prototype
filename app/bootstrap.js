import { isSupabaseConfigured, supabase } from '../shared/supabase.js';

const setText = (id, value) => {
  const element = document.getElementById(id);
  if (element && value) element.textContent = value;
};

const redirectToLogin = () => {
  const loginUrl = new URL('../login/', window.location.href);
  loginUrl.searchParams.set('next', window.location.href);
  window.location.replace(loginUrl.href);
};

const showClaimScreen = (emailAddress) => {
  document.body.innerHTML = `
    <main class="auth-boundary">
      <form id="claimWeddingForm" class="auth-boundary-card">
        <span class="brand-mark">G</span>
        <p class="eyebrow">Signed in as ${emailAddress}</p>
        <h1>Join your wedding room.</h1>
        <p>Enter the four-digit code Tucker and Syd chose. The code works only for a pre-approved email address.</p>
        <label for="weddingCode">Wedding code</label>
        <input id="weddingCode" name="weddingCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4}" maxlength="4" placeholder="••••" required>
        <button class="button primary" type="submit">Open wedding room</button>
        <p id="claimNotice" role="status" aria-live="polite"></p>
        <button id="unassignedLogout" class="button" type="button">Use a different email</button>
      </form>
    </main>`;

  document.getElementById('claimWeddingForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    const notice = document.getElementById('claimNotice');
    button.disabled = true;
    button.textContent = 'Checking…';
    const { error } = await supabase.rpc('claim_wedding_membership', {
      target_slug: 'tucker-and-syd',
      join_code: document.getElementById('weddingCode').value,
    });
    if (error) {
      notice.textContent = error.message;
      button.disabled = false;
      button.textContent = 'Open wedding room';
      return;
    }
    window.location.reload();
  });

  document.getElementById('unassignedLogout').addEventListener('click', async () => {
    await supabase.auth.signOut();
    redirectToLogin();
  });
};

async function loadAuthenticatedWorkspace() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) {
    redirectToLogin();
    return false;
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('wedding_members')
    .select('role, display_name, weddings(id, name, slug, event_date, timezone, status)')
    .eq('user_id', session.user.id)
    .limit(1);

  if (membershipError) throw membershipError;

  const membership = memberships?.[0];
  if (!membership?.weddings) {
    showClaimScreen(session.user.email);
    return false;
  }

  const wedding = membership.weddings;
  const displayName = membership.display_name || session.user.user_metadata?.display_name || session.user.email;
  setText('weddingName', wedding.name);
  setText('weddingMeta', wedding.event_date
    ? `${new Date(`${wedding.event_date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} · ${wedding.status}`
    : `Private wedding room · ${wedding.status}`);
  setText('accountName', displayName);
  setText('accountRole', `${membership.role} · signed in`);
  setText('syncState', 'Connected securely to Supabase');
  setText('logoutButton', 'Log out');
  setText('sidebarLogout', '← Log out');
  document.body.dataset.weddingId = wedding.id;
  document.body.dataset.userId = session.user.id;

  const logout = async (event) => {
    event.preventDefault();
    await supabase.auth.signOut();
    redirectToLogin();
  };
  document.getElementById('logoutButton').addEventListener('click', logout);
  document.getElementById('sidebarLogout').addEventListener('click', logout);
  return true;
}

try {
  if (isSupabaseConfigured) {
    const ready = await loadAuthenticatedWorkspace();
    if (!ready) throw new Error('Authentication redirect or wedding assignment required.');
  }
  await import('./app.js');
} catch (error) {
  if (!String(error.message).includes('Authentication redirect')) {
    console.error(error);
    document.body.innerHTML = `
      <main class="auth-boundary">
        <div class="auth-boundary-card">
          <span class="brand-mark">G</span>
          <h1>We could not open the wedding room.</h1>
          <p>${error.message || 'Please try again in a moment.'}</p>
          <a class="button primary" href="../login/">Return to login</a>
        </div>
      </main>`;
  }
}
