create table public.signup_reservations (
  email text primary key check (email = lower(email)),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index signup_reservations_wedding_expiry
  on public.signup_reservations (wedding_id, expires_at);

create table public.signup_code_attempts (
  id bigint generated always as identity primary key,
  ip_address inet,
  email text,
  attempted_at timestamptz not null default now()
);

create index signup_code_attempts_ip_time
  on public.signup_code_attempts (ip_address, attempted_at desc);

alter table public.signup_reservations enable row level security;
alter table public.signup_code_attempts enable row level security;

create or replace function public.hook_validate_signup_code(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  request_email text := lower(event->'user'->>'email');
  signup_code text := event->'user'->'user_metadata'->>'signup_code';
  request_ip inet;
  recent_attempts integer;
  target_wedding public.weddings%rowtype;
begin
  begin
    request_ip := nullif(event->'metadata'->>'ip_address', '')::inet;
  exception when invalid_text_representation then
    request_ip := null;
  end;

  delete from public.signup_code_attempts
   where attempted_at < now() - interval '24 hours';
  delete from public.signup_reservations
   where expires_at <= now();

  if request_ip is not null then
    select count(*) into recent_attempts
      from public.signup_code_attempts
     where ip_address = request_ip
       and attempted_at > now() - interval '15 minutes';
    if recent_attempts >= 10 then
      return jsonb_build_object(
        'error', jsonb_build_object(
          'http_code', 429,
          'message', 'Too many signup-code attempts. Wait 15 minutes and try again.'
        )
      );
    end if;
  end if;

  insert into public.signup_code_attempts (ip_address, email)
  values (request_ip, request_email);

  if request_email is null or signup_code is null or signup_code !~ '^[0-9]{6}$' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
          'message', 'A valid six-digit signup code is required.'
      )
    );
  end if;

  select w.* into target_wedding
    from public.weddings as w
   where w.status in ('planning', 'published')
     and w.join_code_hash is not null
     and extensions.crypt(signup_code, w.join_code_hash) = w.join_code_hash
     and (
       select count(*)
         from public.wedding_members as wm
        where wm.wedding_id = w.id and wm.user_id is null
     ) > (
       select count(*)
         from public.signup_reservations as sr
        where sr.wedding_id = w.id
          and sr.expires_at > now()
          and sr.email <> request_email
     )
   order by w.created_at
   for update of w
   limit 1;

  if target_wedding.id is null then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'That signup code is invalid or has no partner seats available.'
      )
    );
  end if;

  insert into public.signup_reservations (email, wedding_id, expires_at)
  values (request_email, target_wedding.id, now() + interval '24 hours')
  on conflict (email) do update
    set wedding_id = excluded.wedding_id,
        expires_at = excluded.expires_at,
        updated_at = now();

  return '{}'::jsonb;
end;
$$;

revoke execute on function public.hook_validate_signup_code(jsonb) from public, anon, authenticated;
grant execute on function public.hook_validate_signup_code(jsonb) to supabase_auth_admin;

create or replace function public.claim_signup_reservation()
returns table (wedding_id uuid, wedding_name text, member_role text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_email text;
  reservation public.signup_reservations%rowtype;
  claimed_member public.wedding_members%rowtype;
  target_wedding public.weddings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in before joining a wedding workspace.';
  end if;

  select lower(email) into current_email
    from auth.users
   where id = auth.uid() and email_confirmed_at is not null;
  if current_email is null then
    raise exception 'Verify your email before joining a wedding workspace.';
  end if;

  select * into reservation
    from public.signup_reservations
   where email = current_email and expires_at > now()
   for update;
  if reservation.email is null then
    raise exception 'No active signup-code reservation was found for this email.';
  end if;

  select * into target_wedding
    from public.weddings
   where id = reservation.wedding_id;

  select * into claimed_member
    from public.wedding_members
   where wedding_id = reservation.wedding_id and user_id = auth.uid()
   limit 1;

  if claimed_member.id is null then
    select * into claimed_member
      from public.wedding_members
     where wedding_id = reservation.wedding_id and user_id is null
     order by created_at
     for update skip locked
     limit 1;
    if claimed_member.id is null then
      raise exception 'This wedding workspace has no partner seats available.';
    end if;

    update public.wedding_members as wm
       set user_id = auth.uid(),
           invited_email = current_email,
           claimed_at = now()
     where wm.id = claimed_member.id
    returning wm.* into claimed_member;
  end if;

  delete from public.signup_reservations where email = current_email;
  return query select target_wedding.id, target_wedding.name, claimed_member.role;
end;
$$;

revoke execute on function public.claim_signup_reservation() from public, anon;
grant execute on function public.claim_signup_reservation() to authenticated;

create or replace function public.claim_wedding_membership(target_slug text, join_code text)
returns table (wedding_id uuid, wedding_name text, member_role text)
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  current_email text;
  target_wedding public.weddings%rowtype;
  claimed_member public.wedding_members%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in before entering a wedding code.'; end if;
  select lower(email) into current_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if current_email is null then raise exception 'Verify your email before entering a wedding code.'; end if;
  select * into target_wedding from public.weddings where slug = target_slug;
  if target_wedding.id is null or target_wedding.join_code_hash is null
     or extensions.crypt(join_code, target_wedding.join_code_hash) <> target_wedding.join_code_hash then
    raise exception 'That wedding code is not valid.';
  end if;

  select * into claimed_member
    from public.wedding_members
   where wedding_id = target_wedding.id and user_id = auth.uid()
   limit 1;

  if claimed_member.id is null then
    select * into claimed_member
      from public.wedding_members
     where wedding_id = target_wedding.id and user_id is null
     order by created_at
     for update skip locked
     limit 1;
    if claimed_member.id is null then raise exception 'This wedding workspace has no partner seats available.'; end if;

    update public.wedding_members as wm
       set user_id = auth.uid(), invited_email = current_email, claimed_at = now()
     where wm.id = claimed_member.id
    returning wm.* into claimed_member;
  end if;

  return query select target_wedding.id, target_wedding.name, claimed_member.role;
end;
$$;

revoke execute on function public.claim_wedding_membership(text, text) from public, anon;
grant execute on function public.claim_wedding_membership(text, text) to authenticated;
