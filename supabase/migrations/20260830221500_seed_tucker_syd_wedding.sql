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
  update public.wedding_members
     set user_id = auth.uid(), claimed_at = now()
   where wedding_id = target_wedding.id
     and lower(invited_email) = current_email
     and (user_id is null or user_id = auth.uid())
  returning * into claimed_member;
  if claimed_member.id is null then raise exception 'This verified email is not invited to that wedding.'; end if;
  return query select target_wedding.id, target_wedding.name, claimed_member.role;
end;
$$;

do $$
declare new_wedding_id uuid;
begin
  insert into public.weddings (
    name, slug, event_date, venue, timezone, status, join_code_hash
  )
  values (
    'Tucker & Syd',
    'tucker-and-syd',
    '2027-06-26',
    'Walloon Lake Country Club',
    'America/Detroit',
    'planning',
    extensions.crypt('9898', extensions.gen_salt('bf'))
  )
  on conflict (slug) do update set
    name = excluded.name,
    event_date = excluded.event_date,
    venue = excluded.venue,
    join_code_hash = excluded.join_code_hash
  returning id into new_wedding_id;

  insert into public.wedding_members (
    wedding_id, invited_email, display_name, role
  )
  values (
    new_wedding_id, 'sydneyslp8@gmail.com', 'Sydney Lancaster', 'partner'
  )
  on conflict (wedding_id, (lower(invited_email))) do update set
    display_name = excluded.display_name,
    role = excluded.role;

  insert into public.events (
    wedding_id, name, starts_at, venue, sort_order, is_public
  )
  values (
    new_wedding_id,
    'Wedding Day',
    '2027-06-26 16:00:00-04',
    'Walloon Lake Country Club',
    10,
    true
  );
end $$;
