import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = new Set((Deno.env.get('RSVP_ALLOWED_ORIGINS') || 'https://grace-wedding-prototype-5gl.pages.dev').split(',').map(v => v.trim()));
const weddingSlug = Deno.env.get('WEDDING_SLUG') || 'tucker-and-syd';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200, origin = '') => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': allowedOrigins.has(origin) ? origin : '', 'access-control-allow-headers': 'content-type', 'vary': 'origin' } });
const normalize = (value = '') => value.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const randomToken = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(v => v.toString(16).padStart(2, '0')).join('');
const localDate = (timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};
const consumeRateLimit = async (request: Request, action: 'lookup' | 'help' | 'unlock-edit', windowSeconds: number, attemptLimit: number) => {
  const forwarded = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const identifierHash = await sha256(`${forwarded}|${action}`);
  const { data, error } = await supabase.rpc('consume_rsvp_rate_limit', { identifier_hash: identifierHash, action_name: action, window_seconds: windowSeconds, attempt_limit: attemptLimit });
  if (error) throw error;
  return Boolean(data);
};

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': allowedOrigins.has(origin) ? origin : '', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST,OPTIONS' } });
  if (request.method !== 'POST' || !allowedOrigins.has(origin)) return json({ code: 'ORIGIN_NOT_ALLOWED' }, 403, origin);
  try {
    const input = await request.json();
    const { data: wedding } = await supabase.from('weddings').select('id,timezone').eq('slug', weddingSlug).single();
    if (!wedding) return json({ code: 'RSVP_NOT_CONFIGURED' }, 503, origin);
    const { data: settings } = await supabase.from('wedding_rsvp_settings').select('*').eq('wedding_id', wedding.id).maybeSingle();
    const closed = !settings?.deadline_date || settings.is_manually_closed || localDate(wedding.timezone || 'America/Detroit') > settings.deadline_date;
    if (input.action === 'status') return json({ configured: Boolean(settings?.deadline_date), closed, deadline: settings?.deadline_date || null, contactCopy: settings?.contact_copy || 'RSVP is not open yet.' }, 200, origin);
    if (input.action === 'help') {
      if (!await consumeRateLimit(request, 'help', 3600, 5)) return json({ code: 'RATE_LIMITED' }, 429, origin);
      const enteredName = String(input.name || '').trim().slice(0, 120);
      if (!enteredName) return json({ code: 'VALIDATION_FAILED', field: 'name' }, 400, origin);
      const { error } = await supabase.from('rsvp_help_requests').insert({ wedding_id: wedding.id, entered_name: enteredName, contact_method: String(input.contact || '').trim().slice(0, 160) || null, message: String(input.message || '').trim().slice(0, 500) || null, reason: 'lookup_failed' });
      if (error) throw error;
      return json({ ok: true }, 201, origin);
    }
    if (input.action === 'submit') {
      const tokenHash = await sha256(String(input.token || ''));
      const { data: session } = await supabase.from('rsvp_access_sessions').select('mode').eq('token_hash', tokenHash).maybeSingle();
      if (!session || session.mode === 'view') return json({ code: session ? 'PIN_REQUIRED' : 'SESSION_EXPIRED' }, 409, origin);
      const { data, error } = await supabase.rpc('submit_rsvp_internal', { session_token: String(input.token || ''), idempotency_key: String(input.idempotencyKey || ''), responses: input.responses });
      if (error) {
        const code = ['SESSION_EXPIRED','DEADLINE_CLOSED','SUBMISSION_KEY_REUSED','INVITATION_CHANGED','INVALID_PLUS_ONE','PLUS_ONE_NAME_REQUIRED','VALIDATION_FAILED'].find(value => error.message.includes(value)) || 'SERVICE_UNAVAILABLE';
        return json({ code }, code === 'SERVICE_UNAVAILABLE' ? 503 : 409, origin);
      }
      return json(data, 200, origin);
    }
    if (input.action === 'unlock-edit') {
      if (!await consumeRateLimit(request, 'unlock-edit', 900, 10)) return json({ code: 'RATE_LIMITED' }, 429, origin);
      const { data, error } = await supabase.rpc('unlock_rsvp_internal', { session_token: String(input.token || ''), edit_pin: String(input.pin || '') });
      if (error) { const code=error.message.includes('PIN_LOCKED')?'PIN_LOCKED':error.message.includes('PIN_INVALID')?'PIN_INVALID':'SESSION_EXPIRED'; return json({code},409,origin); }
      return json({ token:data },200,origin);
    }
    if (input.action !== 'lookup') return json({ code: 'UNKNOWN_ACTION' }, 400, origin);
    if (!await consumeRateLimit(request, 'lookup', 900, 15)) return json({ code: 'RATE_LIMITED' }, 429, origin);
    const wanted = normalize(String(input.name || ''));
    if (wanted.length < 3) return json({ code: 'VALIDATION_FAILED', field: 'name' }, 400, origin);
    const [{ data: guests }, { data: aliases }, { data: households }, { data: events }, { data: guestEvents }] = await Promise.all([
      supabase.from('guests').select('id,household_id,first_name,last_name,preferred_name,dietary_notes').eq('wedding_id', wedding.id).eq('guest_kind','named').eq('is_active',true),
      supabase.from('guest_name_aliases').select('guest_id,normalized_alias').eq('wedding_id', wedding.id),
      supabase.from('households').select('id,name,postal_code').eq('wedding_id', wedding.id),
      supabase.from('events').select('id,name,starts_at,venue,description,sort_order').eq('wedding_id', wedding.id),
      supabase.from('guest_events').select('guest_id,event_id,rsvp_status,meal_choice,response_notes,plus_one_allowed').eq('wedding_id', wedding.id).eq('invited',true),
    ]);
    const aliasMap = new Map<string,string[]>(); for (const a of aliases || []) aliasMap.set(a.guest_id, [...(aliasMap.get(a.guest_id)||[]), a.normalized_alias]);
    const matched = (guests || []).filter(g => [normalize(`${g.first_name} ${g.last_name}`), normalize(`${g.preferred_name || ''} ${g.last_name}`), ...(aliasMap.get(g.id)||[])].includes(wanted));
    const householdIds = [...new Set(matched.map(g => g.household_id).filter(Boolean))];
    if (!householdIds.length) return json({ code: 'LOOKUP_NOT_FOUND' }, 404, origin);
    let selected = householdIds;
    if (selected.length > 1 && !input.postalCode) return json({ code: 'POSTAL_REQUIRED' }, 409, origin);
    if (selected.length > 1) { const postal = normalize(String(input.postalCode)); selected = selected.filter(id => normalize((households || []).find(h => h.id === id)?.postal_code || '') === postal); }
    if (selected.length !== 1) return json({ code: 'LOOKUP_NOT_FOUND' }, 404, origin);
    const householdId = selected[0], household = (households || []).find(h => h.id === householdId);
    const refs: Record<string,string> = {}, eventRefs: Record<string,string> = {};
    for (const g of (guests || []).filter(item => item.household_id === householdId)) refs[g.id] = randomToken().slice(0,24);
    for (const e of events || []) eventRefs[e.id] = randomToken().slice(0,24);
    const publicGuests = (guests || []).filter(g => g.household_id === householdId).map(g => ({ ref: refs[g.id], name: [g.preferred_name || g.first_name,g.last_name].filter(Boolean).join(' '), dietaryNotes: g.dietary_notes || '', events: (guestEvents || []).filter(ge => ge.guest_id === g.id).map(ge => { const e=(events||[]).find(x=>x.id===ge.event_id); return { ref:eventRefs[ge.event_id], name:e?.name, startsAt:e?.starts_at, venue:e?.venue, description:e?.description, status:ge.rsvp_status, mealChoice:ge.meal_choice, responseNotes:ge.response_notes, plusOneAllowed:ge.plus_one_allowed }; }) }));
    const { count: priorCount } = await supabase.from('rsvp_submissions').select('id',{count:'exact',head:true}).eq('household_id',householdId);
    const requiresPin=(priorCount||0)>0;
    const token = randomToken(); const snapshot = { guests: Object.entries(refs).map(([id,ref])=>({id,ref})), events:Object.entries(eventRefs).map(([id,ref])=>({id,ref})) };
    const { error: sessionError } = await supabase.from('rsvp_access_sessions').insert({ wedding_id:wedding.id, household_id:householdId, token_hash:await sha256(token), mode:closed||requiresPin?'view':'initial', invitation_snapshot:snapshot, expires_at:new Date(Date.now()+30*60*1000).toISOString() });
    if (sessionError) throw sessionError;
    return json({ token, closed, requiresPin, contactCopy:settings?.contact_copy, deadline:settings?.deadline_date, householdName:household?.name, guests:publicGuests }, 200, origin);
  } catch (error) {
    console.error('RSVP_GATEWAY_ERROR', error instanceof Error ? error.message : 'unknown');
    return json({ code: 'SERVICE_UNAVAILABLE' }, 503, origin);
  }
});
