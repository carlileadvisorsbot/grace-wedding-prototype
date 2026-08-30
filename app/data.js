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
  const dialog = document.createElement('dialog');
  dialog.className = 'data-dialog';
  dialog.innerHTML = `<form method="dialog" class="data-form">
    <div><span class="eyebrow">Private wedding data</span><h2>${escapeHtml(title)}</h2></div>
    <div class="form-fields">${fields.map(field => {
      const value = values[field.name] ?? '';
      if (field.type === 'checkbox') return `<label class="check-field"><input name="${field.name}" type="checkbox" ${value ? 'checked' : ''}><span>${escapeHtml(field.label)}</span></label>`;
      if (field.type === 'select') return `<label>${escapeHtml(field.label)}<select name="${field.name}"><option value="">${escapeHtml(field.placeholder || 'None')}</option>${field.options.map(option => `<option value="${escapeHtml(option.value)}" ${String(value) === String(option.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>`;
      if (field.type === 'textarea') return `<label>${escapeHtml(field.label)}<textarea name="${field.name}" rows="3" placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(value)}</textarea></label>`;
      return `<label>${escapeHtml(field.label)}<input name="${field.name}" type="${field.type || 'text'}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || '')}" ${field.required ? 'required' : ''}></label>`;
    }).join('')}</div>
    <p class="form-error" role="alert"></p>
    <div class="form-actions"><button class="button subtle" value="cancel">Cancel</button><button class="button primary" id="dialogSubmit" value="default">${escapeHtml(submitLabel)}</button></div>
  </form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('form').addEventListener('submit', async event => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const button = dialog.querySelector('#dialogSubmit');
    const formData = new FormData(event.currentTarget);
    const payload = {};
    fields.forEach(field => { payload[field.name] = field.type === 'checkbox' ? formData.has(field.name) : String(formData.get(field.name) || '').trim(); });
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
    return `<tr data-search="${escapeHtml(`${guestName(guest)} ${household?.name || ''}`.toLowerCase())}"><td><div class="person"><span class="person-dot">${escapeHtml((guest.first_name[0] || '') + (guest.last_name[0] || ''))}</span><div><strong>${escapeHtml(guestName(guest))}</strong><small>${guest.plus_one_allowed ? 'Plus-one allowed' : 'Named guest'}</small></div></div></td><td>${escapeHtml(household?.name || 'No household')}</td><td>${escapeHtml(eventNames)}</td><td><span class="pill ${rsvp === 'Attending' ? 'green' : 'gold'}">${rsvp}</span></td><td><div class="row-actions"><button class="chip edit-guest" data-id="${guest.id}">Edit</button><button class="chip outline delete-guest" data-id="${guest.id}">Delete</button></div></td></tr>`;
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
    { name: 'event_id', label: 'Invite to event', type: 'select', options: events.map(item => ({ value: item.id, label: item.name })), placeholder: 'Not assigned yet' },
    { name: 'plus_one_allowed', label: 'Allow a plus-one', type: 'checkbox' }, { name: 'dietary_notes', label: 'Dietary notes', type: 'textarea' },
  ];
  const saveGuest = existing => openDialog({ title: existing ? `Edit ${guestName(existing)}` : 'Add a guest', fields: guestFields, values: existing ? { ...existing, event_id: (assignmentsByGuest[existing.id] || []).find(item => item.invited)?.event_id || '' } : {}, onSubmit: async payload => {
    const eventId = payload.event_id || null; delete payload.event_id; payload.household_id ||= null;
    const query = existing ? supabase.from('guests').update(payload).eq('id', existing.id).eq('wedding_id', id) : supabase.from('guests').insert({ ...payload, wedding_id: id });
    const { data, error: saveError } = await query.select().single(); if (saveError) throw saveError;
    if (eventId) { const { error: assignmentError } = await supabase.from('guest_events').upsert({ wedding_id: id, guest_id: data.id, event_id: eventId, invited: true }, { onConflict: 'guest_id,event_id' }); if (assignmentError) throw assignmentError; }
    await recordActivity(existing ? 'updated' : 'created', 'guest', data.id, data); toast(existing ? 'Guest updated' : 'Guest added'); await loadGuests(toast);
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

export async function bindLiveView(name, toast) {
  if (name === 'guests') await loadGuests(toast);
  if (name === 'registry') await loadRegistry(toast);
}

export { escapeHtml };
