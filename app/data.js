import { supabase } from '../shared/supabase.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));
const guestName = guest => [guest.preferred_name || guest.first_name, guest.last_name].filter(Boolean).join(' ');
const weddingId = () => document.body.dataset.weddingId;
const userId = () => document.body.dataset.userId;

class FieldValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

function normalizeSecureUrl(value) {
  let candidate = String(value || '').trim();
  if (!candidate) throw new FieldValidationError('url', 'Enter the registry website address.');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
  if (/^http:\/\//i.test(candidate)) candidate = `https://${candidate.slice(7)}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) throw new Error('Invalid secure URL');
    return url.href;
  } catch {
    throw new FieldValidationError('url', 'Use a complete secure link, such as https://amazon.com/your-registry.');
  }
}

async function recordActivity(action, entityType, entityId, afterData = null) {
  const { error } = await supabase.from('activity_log').insert({
    wedding_id: weddingId(), actor_user_id: userId(), action,
    entity_type: entityType, entity_id: entityId, after_data: afterData,
  });
  if (error) console.warn('Activity log failed', error);
}

function openDialog({ title, submitLabel = 'Save', fields, values = {}, onSubmit }) {
  const trigger = document.activeElement;
  const shell = document.querySelector('.app-shell');
  const dialog = document.createElement('dialog');
  dialog.className = 'data-dialog';
  dialog.innerHTML = `<form method="dialog" class="data-form">
    <div><span class="eyebrow">Private wedding data</span><h2>${escapeHtml(title)}</h2></div>
    <div class="form-fields">${fields.map(field => {
      const value = values[field.name] ?? '';
      if (field.type === 'checkbox-group') return `<fieldset class="checkbox-group"><legend>${escapeHtml(field.label)}</legend>${field.options.map(option => { const selected = Array.isArray(value) && value.some(item => String(item.value) === String(option.value)); const plusOne = Array.isArray(value) && value.find(item => String(item.value) === String(option.value))?.plus_one_allowed; return `<div class="event-check-row"><label class="check-field"><input name="${field.name}" type="checkbox" value="${escapeHtml(option.value)}" ${selected ? 'checked' : ''}><span>${escapeHtml(option.label)}</span></label><label class="check-field plus-one-event"><input name="${field.name}_plus_one_${escapeHtml(option.value)}" type="checkbox" ${plusOne ? 'checked' : ''}><span>Allow plus-one</span></label></div>`; }).join('')}</fieldset>`;
      if (field.type === 'checkbox') return `<label class="check-field"><input name="${field.name}" type="checkbox" ${value ? 'checked' : ''}><span>${escapeHtml(field.label)}</span></label>`;
      if (field.type === 'select') return `<label>${escapeHtml(field.label)}<select name="${field.name}"><option value="">${escapeHtml(field.placeholder || 'None')}</option>${field.options.map(option => `<option value="${escapeHtml(option.value)}" ${String(value) === String(option.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>`;
      if (field.type === 'textarea') return `<label>${escapeHtml(field.label)}<textarea name="${field.name}" rows="3" placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(value)}</textarea></label>`;
      return `<label>${escapeHtml(field.label)}<input name="${field.name}" type="${field.type || 'text'}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || '')}" ${field.required ? 'required' : ''}></label>`;
    }).join('')}</div>
    <p class="form-error" role="alert"></p>
    <div class="form-actions"><button class="button subtle" value="cancel">Cancel</button><button class="button primary" id="dialogSubmit" value="default">${escapeHtml(submitLabel)}</button></div>
  </form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    shell?.removeAttribute('inert');
    shell?.removeAttribute('aria-hidden');
    dialog.remove();
    trigger?.focus?.();
  });
  dialog.querySelector('form').addEventListener('submit', async event => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const button = dialog.querySelector('#dialogSubmit');
    const formData = new FormData(event.currentTarget);
    const payload = {};
    fields.forEach(field => {
      if (field.type === 'checkbox') payload[field.name] = formData.has(field.name);
      else if (field.type === 'checkbox-group') payload[field.name] = formData.getAll(field.name).map(value => ({ value, plus_one_allowed: formData.has(`${field.name}_plus_one_${value}`) }));
      else payload[field.name] = String(formData.get(field.name) || '').trim();
    });
    button.disabled = true;
    button.textContent = 'Saving…';
    try { await onSubmit(payload); dialog.close(); }
    catch (error) {
      dialog.querySelector('.form-error').textContent = error.message || 'Could not save this change.';
      const invalidField = error.field && dialog.querySelector(`[name="${error.field}"]`);
      if (invalidField) { invalidField.setAttribute('aria-invalid', 'true'); invalidField.focus(); }
      button.disabled = false; button.textContent = submitLabel;
    }
  });
  dialog.addEventListener('input', event => {
    event.target.removeAttribute?.('aria-invalid');
    dialog.querySelector('.form-error').textContent = '';
  });
  shell?.setAttribute('inert', '');
  shell?.setAttribute('aria-hidden', 'true');
  dialog.showModal();
}

export function guestsView(pageHead) {
  return pageHead('Guests & households', 'Your real private guest list, grouped for invitations and connected to wedding events.', 'Live · shared securely', '<button class="button subtle" id="addHousehold">+ Household</button><button class="button primary" id="addGuest">+ Guest</button>') + `
    <div class="grid four" id="guestMetrics"><div class="card metric"><span class="label">Loading</span><strong>—</strong><small>Reading Supabase</small></div></div>
    <div class="section-title"><h2>Households</h2><span class="pill">Invitation groups</span></div>
    <div class="grid three" id="liveHouseholds"><div class="card card-pad"><p class="page-intro">Loading households…</p></div></div>
    <div class="section-title"><h2>Guest list</h2><span class="pill green">Private</span></div>
    <div class="list-toolbar"><input class="search" id="guestSearch" placeholder="Search a guest or household…"></div>
    <div class="card table-card" id="liveGuestList"><div class="empty-note">Loading your guest list…</div></div>`;
}

export function registryView(pageHead) {
  return pageHead('Registry', 'Manage the registry destinations that will eventually appear on your guest site.', 'Live · unpublished by default', '<button class="button primary" id="addRegistry">+ Add registry link</button>') + `
    <div class="grid three" id="liveRegistry"><div class="card registry-card"><p>Loading registry links…</p></div></div>
    <div class="card card-pad" style="margin-top:22px"><span class="pill gold">Publishing safety</span><p class="page-intro" style="margin-top:12px">Only links marked Published are eligible for the guest site. Adding or editing a link does not publish the wedding site.</p></div>`;
}

export function settingsView(pageHead) {
  return pageHead('Settings', 'Manage your profile and control who can work inside this wedding workspace.', 'Private wedding workspace') + `
    <div class="settings-section-grid">
      <section class="card settings-panel">
        <span class="eyebrow">Your profile</span><h2>Account details</h2>
        <form id="profileForm" class="settings-form">
          <label>Display name<input id="profileDisplayName" autocomplete="name" required></label>
          <label>Email address<input id="profileEmail" type="email" autocomplete="email" required></label>
          <div class="settings-meta"><span>Joined</span><strong id="profileJoined">Loading…</strong></div>
          <button class="button primary" type="submit">Save profile</button>
          <span class="settings-notice" id="profileNotice" role="status" aria-live="polite"></span>
        </form>
      </section>
      <section class="card settings-panel">
        <span class="eyebrow">Password</span><h2>Change your password</h2>
        <form class="password-form" id="passwordForm">
          <label>New password<input id="newPassword" type="password" autocomplete="new-password" minlength="8" required></label>
          <label>Confirm password<input id="confirmNewPassword" type="password" autocomplete="new-password" minlength="8" required></label>
          <button class="button primary" type="submit">Update password</button>
          <span id="passwordNotice" role="status" aria-live="polite"></span>
        </form>
      </section>
    </div>
    <section class="card settings-panel access-code-panel" id="accessCodePanel">
      <div><span class="eyebrow">Signup code</span><h2>Invite people to this wedding</h2><p id="accessCodeHelp">Loading access controls…</p></div>
      <div class="code-controls" id="codeControls"></div>
    </section>
    <section class="card settings-panel member-panel">
      <div class="member-panel-head"><div><span class="eyebrow">Wedding access</span><h2>People with access</h2><p>Admins manage people and the signup code. Members can work in the wedding workspace.</p></div><span class="pill" id="memberCount">Loading</span></div>
      <div id="memberAccessList" class="member-access-list"><div class="empty-note">Loading members…</div></div>
    </section>`;
}

export function rsvpsView(pageHead) {
  return pageHead('RSVPs','Live responses, deadlines, and guest lookup help in one private place.','Private · RSVP closed by default',`<a class="button subtle" href="../rsvp/" target="_blank" rel="noopener">Preview RSVP ↗</a>`) + `
    <div class="grid four" id="rsvpMetrics"><div class="card metric"><span class="label">Loading</span><strong>—</strong></div></div>
    <div class="grid two"><section class="card settings-panel"><span class="eyebrow">Guest deadline</span><h2>RSVP availability</h2><form id="rsvpSettingsForm" class="settings-form"><label>Deadline<input id="rsvpDeadline" type="date" required></label><label>After-deadline message<textarea id="rsvpContactCopy" rows="3" required></textarea></label><label class="check-field"><input id="rsvpManuallyClosed" type="checkbox"><span>Keep online RSVP closed</span></label><button class="button primary" type="submit">Save RSVP settings</button><span id="rsvpSettingsNotice" role="status"></span></form></section><section class="card settings-panel"><span class="eyebrow">One shared link</span><h2>Invitation RSVP</h2><p>Every invitation will use the same QR code.</p><code class="signup-code">/rsvp/</code><p class="page-intro">The invitation-ready QR stays pending until the final custom domain is confirmed.</p></section></div>
    <div class="section-title"><h2>Guest responses</h2><span class="pill">Admin controls</span></div><div class="card" id="rsvpResponseList"><div class="empty-note">Loading responses…</div></div>
    <div class="section-title"><h2>Needs help</h2><span class="pill" id="rsvpHelpCount">Loading</span></div><div class="card" id="rsvpHelpList"><div class="empty-note">Loading requests…</div></div>`;
}

async function loadGuests(toast) {
  const id = weddingId();
  const [householdResult, guestResult, eventResult, assignmentResult] = await Promise.all([
    supabase.from('households').select('*').eq('wedding_id', id).order('name'),
    supabase.from('guests').select('*').eq('wedding_id', id).order('last_name').order('first_name'),
    supabase.from('events').select('*').eq('wedding_id', id).order('sort_order'),
    supabase.from('guest_events').select('*').eq('wedding_id', id),
  ]);
  const error = householdResult.error || guestResult.error || eventResult.error || assignmentResult.error;
  if (error) throw error;
  const households = householdResult.data || [], guests = guestResult.data || [], events = eventResult.data || [], assignments = assignmentResult.data || [];
  const householdById = Object.fromEntries(households.map(item => [item.id, item]));
  const eventById = Object.fromEntries(events.map(item => [item.id, item]));
  const assignmentsByGuest = assignments.reduce((groups, item) => ((groups[item.guest_id] ||= []).push(item), groups), {});
  document.querySelector('#guestMetrics').innerHTML = `
    <div class="card metric"><span class="label">People</span><strong>${guests.length}</strong><small>Real guest records</small></div>
    <div class="card metric"><span class="label">Households</span><strong>${households.length}</strong><small>Invitation groups</small></div>
    <div class="card metric"><span class="label">Event invites</span><strong>${assignments.filter(item => item.invited).length}</strong><small>Across ${events.length} event${events.length === 1 ? '' : 's'}</small></div>
    <div class="card metric"><span class="label">Attending</span><strong>${assignments.filter(item => item.rsvp_status === 'attending').length}</strong><small>Responses received</small></div>`;
  const rows = guests.map(guest => {
    const guestAssignments = assignmentsByGuest[guest.id] || [];
    const eventNames = guestAssignments.filter(item => item.invited).map(item => eventById[item.event_id]?.name).filter(Boolean).join(', ') || 'Not assigned';
    const statuses = guestAssignments.map(item => item.rsvp_status);
    const rsvp = statuses.includes('attending') ? 'Attending' : statuses.includes('declined') ? 'Declined' : 'Pending';
    const household = householdById[guest.household_id];
    const plusOneCount = guestAssignments.filter(item => item.invited && item.plus_one_allowed).length;
    return `<tr data-search="${escapeHtml(`${guestName(guest)} ${household?.name || ''}`.toLowerCase())}"><td><div class="person"><span class="person-dot">${escapeHtml((guest.first_name[0] || '') + (guest.last_name[0] || ''))}</span><div><strong>${escapeHtml(guestName(guest))}</strong><small>${plusOneCount ? `Plus-one allowed for ${plusOneCount} event${plusOneCount === 1 ? '' : 's'}` : 'Named guest'}</small></div></div></td><td>${escapeHtml(household?.name || 'No household')}</td><td>${escapeHtml(eventNames)}</td><td><span class="pill ${rsvp === 'Attending' ? 'green' : 'gold'}">${rsvp}</span></td><td><div class="row-actions"><button class="chip edit-guest" data-id="${guest.id}">Edit</button><button class="chip outline delete-guest" data-id="${guest.id}">Delete</button></div></td></tr>`;
  }).join('');
  document.querySelector('#liveGuestList').innerHTML = guests.length ? `<table class="table" id="guestTable"><thead><tr><th>Guest</th><th>Household</th><th>Events</th><th>RSVP</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty-note">No guests yet. Add a household, then add your first guest.</div>';

  const householdFields = [
    { name: 'name', label: 'Household name', required: true, placeholder: 'Carlile household' }, { name: 'email', label: 'Household email', type: 'email' },
    { name: 'address_line_1', label: 'Street address' }, { name: 'city', label: 'City' }, { name: 'region', label: 'State / region' }, { name: 'postal_code', label: 'Postal code' },
  ];
  document.querySelector('#liveHouseholds').innerHTML = households.length ? households.map(household => `<div class="card card-pad household-card"><h3>${escapeHtml(household.name)}</h3><p class="page-intro">${escapeHtml([household.email, household.city, household.region].filter(Boolean).join(' · ') || 'Address and contact details not added')}</p><div class="row-actions"><button class="chip edit-household" data-id="${household.id}">Edit</button><button class="chip outline delete-household" data-id="${household.id}">Delete</button></div></div>`).join('') : '<div class="card card-pad"><p class="page-intro">No households yet.</p></div>';
  const saveHousehold = existing => openDialog({ title: existing ? `Edit ${existing.name}` : 'Add a household', fields: householdFields, values: existing || {}, onSubmit: async payload => {
    const query = existing ? supabase.from('households').update(payload).eq('id', existing.id).eq('wedding_id', id) : supabase.from('households').insert({ ...payload, wedding_id: id });
    const { data, error: saveError } = await query.select().single();
    if (saveError) throw saveError; await recordActivity(existing ? 'updated' : 'created', 'household', data.id, data); toast(existing ? 'Household updated' : 'Household added'); await loadGuests(toast);
  }});
  document.querySelector('#addHousehold').onclick = () => saveHousehold(null);
  document.querySelectorAll('.edit-household').forEach(button => button.onclick = () => saveHousehold(households.find(item => item.id === button.dataset.id)));
  document.querySelectorAll('.delete-household').forEach(button => button.onclick = async () => {
    const household = households.find(item => item.id === button.dataset.id); if (!window.confirm(`Delete ${household.name}? Guests will remain but become ungrouped.`)) return;
    const { error: deleteError } = await supabase.from('households').delete().eq('id', household.id).eq('wedding_id', id); if (deleteError) return toast(deleteError.message);
    await recordActivity('deleted', 'household', household.id, { name: household.name }); toast('Household deleted'); await loadGuests(toast);
  });
  const guestFields = [
    { name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name' }, { name: 'preferred_name', label: 'Preferred name' },
    { name: 'household_id', label: 'Household', type: 'select', options: households.map(item => ({ value: item.id, label: item.name })) }, { name: 'email', label: 'Email', type: 'email' },
    { name: 'events', label: 'Event invitations', type: 'checkbox-group', options: events.map(item => ({ value: item.id, label: item.name })) },
    { name: 'dietary_notes', label: 'Dietary notes', type: 'textarea' },
  ];
  const saveGuest = existing => openDialog({ title: existing ? `Edit ${guestName(existing)}` : 'Add a guest', fields: guestFields, values: existing ? { ...existing, events: (assignmentsByGuest[existing.id] || []).filter(item => item.invited).map(item => ({ value: item.event_id, plus_one_allowed: item.plus_one_allowed })) } : {}, onSubmit: async payload => {
    const rpcPayload = { ...payload, household_id: payload.household_id || null, events: payload.events.map(item => ({ event_id: item.value, plus_one_allowed: item.plus_one_allowed })) };
    if (existing) rpcPayload.guest_id = existing.id;
    const { error: saveError } = await supabase.rpc('save_guest_bundle', { payload: rpcPayload, expected_version: existing?.version || null });
    if (saveError) {
      if (saveError.message.includes('GUEST_CHANGED')) throw new Error('This guest changed in another session. Close this form, review the latest record, and try again.');
      throw saveError;
    }
    toast(existing ? 'Guest and invitations updated' : 'Guest and invitations added'); await loadGuests(toast);
  }});
  document.querySelector('#addGuest').onclick = () => saveGuest(null);
  document.querySelectorAll('.edit-guest').forEach(button => button.onclick = () => saveGuest(guests.find(item => item.id === button.dataset.id)));
  document.querySelectorAll('.delete-guest').forEach(button => button.onclick = async () => {
    const guest = guests.find(item => item.id === button.dataset.id); if (!window.confirm(`Delete ${guestName(guest)} from the guest list?`)) return;
    const { error: deleteError } = await supabase.from('guests').delete().eq('id', guest.id).eq('wedding_id', id); if (deleteError) return toast(deleteError.message);
    await recordActivity('deleted', 'guest', guest.id, { name: guestName(guest) }); toast('Guest deleted'); await loadGuests(toast);
  });
  document.querySelector('#guestSearch')?.addEventListener('input', event => document.querySelectorAll('#guestTable tbody tr').forEach(row => { row.hidden = !row.dataset.search.includes(event.target.value.toLowerCase()); }));
}

async function loadRegistry(toast) {
  const id = weddingId();
  const { data: links, error } = await supabase.from('registry_links').select('*').eq('wedding_id', id).order('sort_order').order('created_at'); if (error) throw error;
  document.querySelector('#liveRegistry').innerHTML = links.length ? links.map((link, index) => `<div class="card registry-card"><div class="registry-icon">${escapeHtml(link.name[0] || '◇')}</div><div class="registry-status"><span class="pill ${link.is_published ? 'green' : 'gold'}">${link.is_published ? 'Published' : 'Hidden'}</span></div><h3>${escapeHtml(link.name)}</h3><p>${escapeHtml(link.description || 'No description yet')}</p><div class="registry-actions"><a class="chip" href="${escapeHtml(link.url)}" target="_blank" rel="noopener">Preview</a><button class="chip edit-registry" data-id="${link.id}">Edit</button><button class="chip outline move-registry" data-id="${link.id}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>↑</button><button class="chip outline move-registry" data-id="${link.id}" data-direction="1" ${index === links.length - 1 ? 'disabled' : ''}>↓</button><button class="chip outline delete-registry" data-id="${link.id}">Delete</button></div></div>`).join('') : '<div class="card registry-card"><div class="registry-icon">◇</div><h3>No registry links yet</h3><p>Add one when you are ready. It will stay hidden by default.</p></div>';
  const fields = [{ name: 'name', label: 'Registry or store name', required: true, placeholder: 'Amazon, Zola, or Honeyfund' }, { name: 'url', label: 'Website URL', type: 'url', required: true, placeholder: 'https://…' }, { name: 'description', label: 'Guest-facing description', type: 'textarea' }, { name: 'is_published', label: 'Mark ready to publish', type: 'checkbox' }];
  const saveLink = existing => openDialog({ title: existing ? `Edit ${existing.name}` : 'Add a registry link', fields, values: existing || {}, onSubmit: async payload => {
    payload.url = normalizeSecureUrl(payload.url);
    const values = { ...payload, wedding_id: id }; if (!existing) values.sort_order = links.length * 10;
    const query = existing ? supabase.from('registry_links').update(values).eq('id', existing.id).eq('wedding_id', id) : supabase.from('registry_links').insert(values);
    const { data, error: saveError } = await query.select().single();
    if (saveError?.message?.includes('registry_links_url_check')) throw new FieldValidationError('url', 'Use a secure registry link beginning with https://.');
    if (saveError) throw new Error('We could not save that registry link. Please check the details and try again.');
    await recordActivity(existing ? 'updated' : 'created', 'registry_link', data.id, data); toast(existing ? 'Registry link updated' : 'Registry link added'); await loadRegistry(toast);
  }});
  document.querySelector('#addRegistry').onclick = () => saveLink(null);
  document.querySelectorAll('.edit-registry').forEach(button => button.onclick = () => saveLink(links.find(item => item.id === button.dataset.id)));
  document.querySelectorAll('.move-registry').forEach(button => button.onclick = async () => {
    const index = links.findIndex(item => item.id === button.dataset.id), otherIndex = index + Number(button.dataset.direction); if (otherIndex < 0 || otherIndex >= links.length) return;
    const first = links[index], second = links[otherIndex];
    const [firstResult, secondResult] = await Promise.all([supabase.from('registry_links').update({ sort_order: second.sort_order }).eq('id', first.id).eq('wedding_id', id), supabase.from('registry_links').update({ sort_order: first.sort_order }).eq('id', second.id).eq('wedding_id', id)]);
    if (firstResult.error || secondResult.error) return toast((firstResult.error || secondResult.error).message); toast('Registry order updated'); await loadRegistry(toast);
  });
  document.querySelectorAll('.delete-registry').forEach(button => button.onclick = async () => {
    const link = links.find(item => item.id === button.dataset.id); if (!window.confirm(`Delete the ${link.name} registry link?`)) return;
    const { error: deleteError } = await supabase.from('registry_links').delete().eq('id', link.id).eq('wedding_id', id); if (deleteError) return toast(deleteError.message);
    await recordActivity('deleted', 'registry_link', link.id, { name: link.name }); toast('Registry link deleted'); await loadRegistry(toast);
  });
}

async function loadSettings(toast) {
  const id = weddingId();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw userError || new Error('Sign in to manage settings.');

  const loadMembers = async () => {
    const { data, error } = await supabase.rpc('list_wedding_access', { target_wedding_id: id });
    if (error) throw error;
    return data || [];
  };

  let members = await loadMembers();
  let current = members.find(member => member.is_current);
  if (!current) throw new Error('Your wedding membership could not be found.');

  if (current.email.toLowerCase() !== user.email.toLowerCase()) {
    const { error } = await supabase.rpc('update_my_wedding_profile', {
      target_wedding_id: id,
      new_display_name: current.display_name,
    });
    if (!error) {
      members = await loadMembers();
      current = members.find(member => member.is_current);
    }
  }

  const isAdmin = current.access_level === 'admin';
  const profileForm = document.querySelector('#profileForm');
  const profileEmail = document.querySelector('#profileEmail');
  const profileDisplayName = document.querySelector('#profileDisplayName');
  const profileNotice = document.querySelector('#profileNotice');
  profileEmail.value = user.email;
  profileDisplayName.value = current.display_name;
  document.querySelector('#profileJoined').textContent = new Date(current.joined_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  profileForm.onsubmit = async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Saving…';
    profileNotice.textContent = '';
    let pendingEmail = false;
    if (profileEmail.value.trim().toLowerCase() !== user.email.toLowerCase()) {
      const { data, error } = await supabase.auth.updateUser({ email: profileEmail.value.trim() });
      if (error) {
        profileNotice.textContent = error.message;
        submit.disabled = false;
        submit.textContent = 'Save profile';
        return;
      }
      pendingEmail = data.user.email.toLowerCase() !== profileEmail.value.trim().toLowerCase();
    }
    const { error } = await supabase.rpc('update_my_wedding_profile', {
      target_wedding_id: id,
      new_display_name: profileDisplayName.value.trim(),
    });
    if (error) profileNotice.textContent = error.message;
    else {
      document.querySelector('#accountName').textContent = profileDisplayName.value.trim();
      profileNotice.textContent = pendingEmail ? 'Display name saved. Confirm the email change from your inbox.' : 'Profile saved.';
      toast('Profile saved');
    }
    submit.disabled = false;
    submit.textContent = 'Save profile';
  };

  const codeHelp = document.querySelector('#accessCodeHelp');
  const codeControls = document.querySelector('#codeControls');
  if (isAdmin) {
    const { data: code, error } = await supabase.rpc('get_wedding_signup_code', { target_wedding_id: id });
    if (error) throw error;
    codeHelp.textContent = 'Anyone with this code can create an account and join as a Member.';
    codeControls.innerHTML = `<strong class="signup-code" id="currentSignupCode">${escapeHtml(code || 'Not set')}</strong><button class="button subtle" id="copySignupCode">Copy</button><button class="button" id="rotateSignupCode">Rotate code</button>`;
    document.querySelector('#copySignupCode').onclick = async () => {
      await navigator.clipboard.writeText(document.querySelector('#currentSignupCode').textContent);
      toast('Signup code copied');
    };
    document.querySelector('#rotateSignupCode').onclick = async event => {
      if (!window.confirm('Rotate the signup code? The current code will stop working for new accounts.')) return;
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = 'Rotating…';
      const { data: nextCode, error: rotateError } = await supabase.rpc('rotate_wedding_signup_code', { target_wedding_id: id });
      if (rotateError) toast(rotateError.message);
      else {
        document.querySelector('#currentSignupCode').textContent = nextCode;
        toast('Signup code rotated');
      }
      event.currentTarget.disabled = false;
      event.currentTarget.textContent = 'Rotate code';
    };
  } else {
    codeHelp.textContent = 'Only an Admin can view or rotate the signup code.';
    codeControls.innerHTML = '<span class="pill gray">Admin only</span>';
  }

  const memberList = document.querySelector('#memberAccessList');
  document.querySelector('#memberCount').textContent = `${members.length} ${members.length === 1 ? 'person' : 'people'}`;
  memberList.innerHTML = members.map(member => `
    <div class="member-access-row" data-member-id="${member.member_id}">
      <span class="person-dot">${escapeHtml((member.display_name || member.email).slice(0, 1).toUpperCase())}</span>
      <div class="member-access-copy"><strong>${escapeHtml(member.display_name)}</strong><span>${escapeHtml(member.email)} · Joined ${escapeHtml(new Date(member.joined_at).toLocaleDateString())}${member.is_current ? ' · You' : ''}</span></div>
      <select class="access-select" aria-label="Access level for ${escapeHtml(member.display_name)}" ${isAdmin ? '' : 'disabled'}><option value="admin" ${member.access_level === 'admin' ? 'selected' : ''}>Admin</option><option value="member" ${member.access_level === 'member' ? 'selected' : ''}>Member</option></select>
      <button class="chip outline remove-member" ${!isAdmin || member.is_current ? 'disabled' : ''}>Remove access</button>
    </div>`).join('');

  memberList.querySelectorAll('.access-select').forEach(select => {
    select.addEventListener('change', async event => {
      const row = event.currentTarget.closest('.member-access-row');
      event.currentTarget.disabled = true;
      const { error } = await supabase.rpc('set_wedding_member_access', {
        target_wedding_id: id,
        target_member_id: row.dataset.memberId,
        new_access_level: event.currentTarget.value,
      });
      if (error) toast(error.message);
      else toast('Access level updated');
      await loadSettings(toast);
    });
  });

  memberList.querySelectorAll('.remove-member').forEach(button => {
    button.addEventListener('click', async event => {
      const row = event.currentTarget.closest('.member-access-row');
      const member = members.find(item => item.member_id === row.dataset.memberId);
      if (!window.confirm(`Remove ${member.display_name}'s access to this wedding?`)) return;
      event.currentTarget.disabled = true;
      const { error } = await supabase.rpc('remove_wedding_member', {
        target_wedding_id: id,
        target_member_id: member.member_id,
      });
      if (error) toast(error.message);
      else {
        toast('Access removed');
        await loadSettings(toast);
      }
    });
  });
}

async function loadRsvps(toast) {
  const id=weddingId();
  const [assignmentResult,settingsResult,helpResult]=await Promise.all([
    supabase.from('guest_events').select('id,rsvp_status,invited,guests(first_name,last_name),events(name)').eq('wedding_id',id).eq('invited',true),
    supabase.from('wedding_rsvp_settings').select('*').eq('wedding_id',id).maybeSingle(),
    supabase.from('rsvp_help_requests').select('*').eq('wedding_id',id).eq('status','open').order('created_at',{ascending:false}),
  ]);
  const error=assignmentResult.error||settingsResult.error||helpResult.error;if(error)throw error;
  const rows=assignmentResult.data||[],attending=rows.filter(x=>x.rsvp_status==='attending').length,declined=rows.filter(x=>x.rsvp_status==='declined').length,pending=rows.filter(x=>x.rsvp_status==='pending').length;
  document.querySelector('#rsvpMetrics').innerHTML=`<div class="card metric"><span class="label">Attending</span><strong>${attending}</strong></div><div class="card metric"><span class="label">Declined</span><strong>${declined}</strong></div><div class="card metric"><span class="label">Waiting</span><strong>${pending}</strong></div><div class="card metric"><span class="label">Response rate</span><strong>${rows.length?Math.round((attending+declined)/rows.length*100):0}%</strong></div>`;
  const settings=settingsResult.data; document.querySelector('#rsvpDeadline').value=settings?.deadline_date||''; document.querySelector('#rsvpContactCopy').value=settings?.contact_copy||'Online RSVP has closed. Please contact Tucker or Sydney if you need to make a change.'; document.querySelector('#rsvpManuallyClosed').checked=settings?.is_manually_closed??true;
  document.querySelector('#rsvpSettingsForm').onsubmit=async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;const{error}=await supabase.rpc('save_rsvp_settings',{target_wedding_id:id,new_deadline:document.querySelector('#rsvpDeadline').value,new_contact_copy:document.querySelector('#rsvpContactCopy').value,new_manually_closed:document.querySelector('#rsvpManuallyClosed').checked});document.querySelector('#rsvpSettingsNotice').textContent=error?error.message:'RSVP settings saved.';button.disabled=false;if(!error)toast('RSVP settings saved');};
  document.querySelector('#rsvpResponseList').innerHTML=rows.length?rows.map(item=>`<div class="task-row" data-rsvp-id="${item.id}"><span class="pill">${escapeHtml(item.rsvp_status)}</span><div class="task-copy"><strong>${escapeHtml([item.guests?.first_name,item.guests?.last_name].filter(Boolean).join(' '))}</strong><span>${escapeHtml(item.events?.name||'Wedding event')}</span></div><select class="rsvp-admin-status" aria-label="RSVP status"><option value="pending" ${item.rsvp_status==='pending'?'selected':''}>Pending</option><option value="attending" ${item.rsvp_status==='attending'?'selected':''}>Attending</option><option value="declined" ${item.rsvp_status==='declined'?'selected':''}>Declined</option></select><button class="button subtle rsvp-admin-save" type="button">Apply</button></div>`).join(''):'<div class="empty-note">No event invitations yet.</div>';
  document.querySelectorAll('.rsvp-admin-save').forEach(button=>button.onclick=async event=>{const row=event.currentTarget.closest('[data-rsvp-id]'),reason=window.prompt('Why are you changing this RSVP? This is saved in the audit history.');if(!reason)return;event.currentTarget.disabled=true;const{error}=await supabase.rpc('admin_apply_rsvp',{target_wedding_id:id,target_guest_event_id:row.dataset.rsvpId,new_status:row.querySelector('.rsvp-admin-status').value,change_reason:reason});if(error)toast(error.message);else{toast('RSVP updated');await loadRsvps(toast);}});
  const help=helpResult.data||[];document.querySelector('#rsvpHelpCount').textContent=`${help.length} open`;document.querySelector('#rsvpHelpList').innerHTML=help.length?help.map(item=>`<div class="task-row" data-help-id="${item.id}"><span class="pill gold">Help</span><div class="task-copy"><strong>${escapeHtml(item.entered_name)}</strong><span>${escapeHtml(item.contact_method||'No contact supplied')} · ${escapeHtml(new Date(item.created_at).toLocaleString())}</span></div><button class="button subtle rsvp-help-resolve" type="button">Mark resolved</button></div>`).join(''):'<div class="empty-note">No guest lookup requests.</div>';
  document.querySelectorAll('.rsvp-help-resolve').forEach(button=>button.onclick=async event=>{event.currentTarget.disabled=true;const row=event.currentTarget.closest('[data-help-id]'),{error}=await supabase.rpc('resolve_rsvp_help',{target_wedding_id:id,target_request_id:row.dataset.helpId,new_status:'resolved'});if(error)toast(error.message);else{toast('Help request resolved');await loadRsvps(toast);}});
}

export async function bindLiveView(name, toast) {
  if (name === 'guests') await loadGuests(toast);
  if (name === 'registry') await loadRegistry(toast);
  if (name === 'settings') await loadSettings(toast);
  if (name === 'rsvps') await loadRsvps(toast);
}

export { escapeHtml };
