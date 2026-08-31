create table public.wedding_rsvp_settings (
  wedding_id uuid primary key references public.weddings(id) on delete cascade,
  deadline_date date,
  contact_copy text not null default 'Online RSVP has closed. Please contact Tucker or Sydney if you need to make a change.' check (char_length(contact_copy) between 1 and 300),
  is_manually_closed boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.guests add column guest_kind text not null default 'named' check (guest_kind in ('named','plus_one'));
alter table public.guests add column linked_to_guest_id uuid references public.guests(id) on delete set null;
alter table public.guests add column is_active boolean not null default true;
alter table public.guests add column version bigint not null default 1;
alter table public.guest_events add column plus_one_allowed boolean not null default false;
alter table public.guest_events add column version bigint not null default 1;

update public.guest_events ge set plus_one_allowed = g.plus_one_allowed
from public.guests g where g.id = ge.guest_id and ge.invited;

create unique index guests_one_active_plus_one_idx on public.guests(linked_to_guest_id)
  where guest_kind = 'plus_one' and is_active;

create table public.guest_name_aliases (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,
  alias text not null check (char_length(alias) between 1 and 120),
  normalized_alias text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(wedding_id, normalized_alias, guest_id)
);

create table public.rsvp_access_sessions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash text not null unique,
  mode text not null check (mode in ('initial','edit','view')),
  invitation_snapshot jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create table public.household_rsvp_credentials (
  household_id uuid primary key references public.households(id) on delete cascade,
  edit_pin_hash text,
  pin_failed_attempts integer not null default 0,
  pin_locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table public.rsvp_submissions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  version bigint not null,
  idempotency_key_hash text not null,
  request_hash text not null,
  response_snapshot jsonb not null,
  source text not null check (source in ('guest','admin')),
  actor_user_id uuid references auth.users(id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now(),
  unique(household_id, version), unique(household_id, idempotency_key_hash)
);

create table public.rsvp_help_requests (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  entered_name text not null check (char_length(entered_name) between 1 and 120),
  contact_method text check (char_length(contact_method) <= 160),
  message text check (char_length(message) <= 500),
  reason text not null check (reason in ('lookup_failed','duplicate_unresolved')),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.rsvp_rate_limits (
  identifier_hash text not null, action text not null,
  window_started_at timestamptz not null, attempt_count integer not null default 1,
  primary key(identifier_hash, action, window_started_at)
);

create index rsvp_sessions_expiry_idx on public.rsvp_access_sessions(expires_at);
create index rsvp_submissions_household_idx on public.rsvp_submissions(household_id, version desc);
create index rsvp_help_open_idx on public.rsvp_help_requests(wedding_id, status, created_at);

alter table public.wedding_rsvp_settings enable row level security;
alter table public.guest_name_aliases enable row level security;
alter table public.rsvp_access_sessions enable row level security;
alter table public.household_rsvp_credentials enable row level security;
alter table public.rsvp_submissions enable row level security;
alter table public.rsvp_help_requests enable row level security;
alter table public.rsvp_rate_limits enable row level security;

create policy member_rsvp_settings_read on public.wedding_rsvp_settings for select to authenticated using (public.is_wedding_member(wedding_id));
create policy member_aliases_all on public.guest_name_aliases for all to authenticated using (public.is_wedding_member(wedding_id)) with check (public.is_wedding_member(wedding_id));
create policy member_submissions_read on public.rsvp_submissions for select to authenticated using (public.is_wedding_member(wedding_id));
create policy member_help_read on public.rsvp_help_requests for select to authenticated using (public.is_wedding_member(wedding_id));

revoke all on public.rsvp_access_sessions, public.household_rsvp_credentials, public.rsvp_rate_limits from public, anon, authenticated;
grant select on public.wedding_rsvp_settings, public.guest_name_aliases, public.rsvp_submissions, public.rsvp_help_requests to authenticated;
grant insert, update, delete on public.guest_name_aliases to authenticated;

create or replace function public.normalize_rsvp_name(value text) returns text
language sql immutable set search_path = public as $$
  select trim(regexp_replace(regexp_replace(lower(coalesce(value,'')), '[^[:alnum:] ]+', ' ', 'g'), '\s+', ' ', 'g'));
$$;

create or replace function public.save_guest_bundle(payload jsonb, expected_version bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  wid uuid; gid uuid; hid uuid; current_version bigint; item jsonb; eid uuid; result jsonb;
begin
  select wm.wedding_id into wid from public.wedding_members wm where wm.user_id=auth.uid() order by wm.created_at limit 1;
  if wid is null then raise exception using errcode='P0001', message='NO_WEDDING_ACCESS'; end if;
  if nullif(trim(payload->>'first_name'),'') is null then raise exception using errcode='P0001', message='FIRST_NAME_REQUIRED'; end if;
  gid := nullif(payload->>'guest_id','')::uuid; hid := nullif(payload->>'household_id','')::uuid;
  if hid is not null and not exists(select 1 from public.households where id=hid and wedding_id=wid) then raise exception using errcode='P0001', message='INVALID_HOUSEHOLD'; end if;
  if gid is null then
    insert into public.guests(wedding_id,household_id,first_name,last_name,preferred_name,email,dietary_notes,plus_one_allowed)
    values(wid,hid,trim(payload->>'first_name'),trim(coalesce(payload->>'last_name','')),nullif(trim(payload->>'preferred_name'),''),nullif(trim(payload->>'email'),''),nullif(trim(payload->>'dietary_notes'),''),false)
    returning id,version into gid,current_version;
  else
    select version into current_version from public.guests where id=gid and wedding_id=wid and guest_kind='named' for update;
    if current_version is null then raise exception using errcode='P0001', message='GUEST_NOT_FOUND'; end if;
    if expected_version is not null and expected_version<>current_version then raise exception using errcode='P0001', message='GUEST_CHANGED'; end if;
    update public.guests set household_id=hid,first_name=trim(payload->>'first_name'),last_name=trim(coalesce(payload->>'last_name','')),
      preferred_name=nullif(trim(payload->>'preferred_name'),''),email=nullif(trim(payload->>'email'),''),dietary_notes=nullif(trim(payload->>'dietary_notes'),''),version=version+1
    where id=gid returning version into current_version;
  end if;
  update public.guest_events set invited=false,plus_one_allowed=false,version=version+1 where guest_id=gid;
  for item in select * from jsonb_array_elements(coalesce(payload->'events','[]'::jsonb)) loop
    eid := nullif(item->>'event_id','')::uuid;
    if not exists(select 1 from public.events where id=eid and wedding_id=wid) then raise exception using errcode='P0001', message='INVALID_EVENT'; end if;
    insert into public.guest_events(wedding_id,guest_id,event_id,invited,plus_one_allowed)
    values(wid,gid,eid,true,coalesce((item->>'plus_one_allowed')::boolean,false))
    on conflict(guest_id,event_id) do update set invited=true,plus_one_allowed=excluded.plus_one_allowed,version=public.guest_events.version+1;
  end loop;
  insert into public.activity_log(wedding_id,actor_user_id,action,entity_type,entity_id,after_data)
  values(wid,auth.uid(),case when payload ? 'guest_id' then 'updated' else 'created' end,'guest',gid::text,payload-'guest_id');
  select jsonb_build_object('guest',to_jsonb(g),'events',coalesce(jsonb_agg(to_jsonb(ge)) filter(where ge.id is not null),'[]'::jsonb)) into result
  from public.guests g left join public.guest_events ge on ge.guest_id=g.id and ge.invited where g.id=gid group by g.id;
  return result;
end $$;

revoke execute on function public.save_guest_bundle(jsonb,bigint) from public, anon;
grant execute on function public.save_guest_bundle(jsonb,bigint) to authenticated;

create or replace function public.save_rsvp_settings(target_wedding_id uuid, new_deadline date, new_contact_copy text, new_manually_closed boolean)
returns public.wedding_rsvp_settings language plpgsql security definer set search_path=public as $$
declare saved public.wedding_rsvp_settings;
begin
  if not public.is_wedding_admin(target_wedding_id) then raise exception 'Only an admin can change RSVP settings.'; end if;
  if new_deadline is null then raise exception 'Choose an RSVP deadline.'; end if;
  insert into public.wedding_rsvp_settings(wedding_id,deadline_date,contact_copy,is_manually_closed,updated_by)
  values(target_wedding_id,new_deadline,trim(new_contact_copy),new_manually_closed,auth.uid())
  on conflict(wedding_id) do update set deadline_date=excluded.deadline_date,contact_copy=excluded.contact_copy,is_manually_closed=excluded.is_manually_closed,updated_by=auth.uid(),updated_at=now()
  returning * into saved;
  insert into public.activity_log(wedding_id,actor_user_id,action,entity_type,entity_id,after_data)
  values(target_wedding_id,auth.uid(),'updated','rsvp_settings',target_wedding_id::text,to_jsonb(saved));
  return saved;
end $$;

revoke execute on function public.save_rsvp_settings(uuid,date,text,boolean) from public, anon;
grant execute on function public.save_rsvp_settings(uuid,date,text,boolean) to authenticated;

insert into public.wedding_rsvp_settings(wedding_id,is_manually_closed)
select id,true from public.weddings on conflict do nothing;
