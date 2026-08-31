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
   order by w.created_at
   limit 1;

  if target_wedding.id is null then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'That signup code is invalid.'
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
  current_name text;
  reservation public.signup_reservations%rowtype;
  claimed_member public.wedding_members%rowtype;
  target_wedding public.weddings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in before joining a wedding workspace.';
  end if;

  select lower(email), coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
    into current_email, current_name
    from auth.users
   where id = auth.uid();
  if current_email is null then
    raise exception 'This account does not have an email address.';
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
    from public.wedding_members as wm
   where wm.wedding_id = reservation.wedding_id and wm.user_id = auth.uid()
   limit 1;

  if claimed_member.id is null then
    select * into claimed_member
      from public.wedding_members as wm
     where wm.wedding_id = reservation.wedding_id
       and wm.user_id is null
       and lower(wm.invited_email) = current_email
     for update skip locked
     limit 1;
  end if;

  if claimed_member.id is null then
    insert into public.wedding_members (
      wedding_id, user_id, invited_email, display_name, role, claimed_at
    ) values (
      reservation.wedding_id, auth.uid(), current_email, current_name, 'partner', now()
    ) returning * into claimed_member;
  elsif claimed_member.user_id is null then
    update public.wedding_members as wm
       set user_id = auth.uid(), display_name = current_name, claimed_at = now(), updated_at = now()
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
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  current_email text;
  current_name text;
  target_wedding public.weddings%rowtype;
  claimed_member public.wedding_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in before entering a wedding code.';
  end if;
  select lower(email), coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
    into current_email, current_name
    from auth.users
   where id = auth.uid();
  if current_email is null then
    raise exception 'This account does not have an email address.';
  end if;

  select * into target_wedding from public.weddings where slug = target_slug;
  if target_wedding.id is null or target_wedding.join_code_hash is null
     or extensions.crypt(join_code, target_wedding.join_code_hash) <> target_wedding.join_code_hash then
    raise exception 'That wedding code is not valid.';
  end if;

  select * into claimed_member
    from public.wedding_members as wm
   where wm.wedding_id = target_wedding.id and wm.user_id = auth.uid()
   limit 1;

  if claimed_member.id is null then
    select * into claimed_member
      from public.wedding_members as wm
     where wm.wedding_id = target_wedding.id
       and wm.user_id is null
       and lower(wm.invited_email) = current_email
     for update skip locked
     limit 1;
  end if;

  if claimed_member.id is null then
    insert into public.wedding_members (
      wedding_id, user_id, invited_email, display_name, role, claimed_at
    ) values (
      target_wedding.id, auth.uid(), current_email, current_name, 'partner', now()
    ) returning * into claimed_member;
  elsif claimed_member.user_id is null then
    update public.wedding_members as wm
       set user_id = auth.uid(), display_name = current_name, claimed_at = now(), updated_at = now()
     where wm.id = claimed_member.id
    returning wm.* into claimed_member;
  end if;

  return query select target_wedding.id, target_wedding.name, claimed_member.role;
end;
$$;

revoke execute on function public.claim_wedding_membership(text, text) from public, anon;
grant execute on function public.claim_wedding_membership(text, text) to authenticated;
