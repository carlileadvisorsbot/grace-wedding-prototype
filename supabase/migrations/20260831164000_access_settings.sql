create table public.wedding_signup_codes (
  wedding_id uuid primary key references public.weddings(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{6}$'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.wedding_signup_codes enable row level security;
revoke all on public.wedding_signup_codes from public, anon, authenticated;

create or replace function public.is_wedding_admin(target_wedding_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.wedding_members as wm
     where wm.wedding_id = target_wedding_id
       and wm.user_id = auth.uid()
       and wm.role = 'partner'
  );
$$;

revoke execute on function public.is_wedding_admin(uuid) from public, anon;
grant execute on function public.is_wedding_admin(uuid) to authenticated;

create or replace function public.list_wedding_access(target_wedding_id uuid)
returns table (
  member_id uuid,
  email text,
  display_name text,
  access_level text,
  joined_at timestamptz,
  is_current boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_wedding_member(target_wedding_id) then
    raise exception 'You do not have access to this wedding.';
  end if;

  return query
  select wm.id,
         wm.invited_email,
         wm.display_name,
         case when wm.role = 'partner' then 'admin' else 'member' end,
         coalesce(wm.claimed_at, wm.created_at),
         wm.user_id = auth.uid()
    from public.wedding_members as wm
   where wm.wedding_id = target_wedding_id
     and wm.user_id is not null
   order by coalesce(wm.claimed_at, wm.created_at), wm.display_name;
end;
$$;

revoke execute on function public.list_wedding_access(uuid) from public, anon;
grant execute on function public.list_wedding_access(uuid) to authenticated;

create or replace function public.get_wedding_signup_code(target_wedding_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_code text;
begin
  if not public.is_wedding_admin(target_wedding_id) then
    raise exception 'Only an admin can view the signup code.';
  end if;

  select wsc.code into current_code
    from public.wedding_signup_codes as wsc
   where wsc.wedding_id = target_wedding_id;
  return current_code;
end;
$$;

revoke execute on function public.get_wedding_signup_code(uuid) from public, anon;
grant execute on function public.get_wedding_signup_code(uuid) to authenticated;

create or replace function public.rotate_wedding_signup_code(target_wedding_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  next_code text;
begin
  if not public.is_wedding_admin(target_wedding_id) then
    raise exception 'Only an admin can rotate the signup code.';
  end if;

  next_code := (100000 + floor(random() * 900000))::integer::text;
  update public.weddings as w
     set join_code_hash = extensions.crypt(next_code, extensions.gen_salt('bf')),
         updated_at = now()
   where w.id = target_wedding_id;

  insert into public.wedding_signup_codes (wedding_id, code, updated_by, updated_at)
  values (target_wedding_id, next_code, auth.uid(), now())
  on conflict (wedding_id) do update
    set code = excluded.code,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return next_code;
end;
$$;

revoke execute on function public.rotate_wedding_signup_code(uuid) from public, anon;
grant execute on function public.rotate_wedding_signup_code(uuid) to authenticated;

create or replace function public.update_my_wedding_profile(
  target_wedding_id uuid,
  new_display_name text
)
returns table (email text, display_name text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before updating your profile.';
  end if;
  if nullif(trim(new_display_name), '') is null then
    raise exception 'Display name is required.';
  end if;

  select lower(au.email) into current_email
    from auth.users as au
   where au.id = auth.uid();

  update public.wedding_members as wm
     set invited_email = current_email,
         display_name = trim(new_display_name),
         updated_at = now()
   where wm.wedding_id = target_wedding_id
     and wm.user_id = auth.uid();
  if not found then
    raise exception 'You do not have access to this wedding.';
  end if;

  return query select current_email, trim(new_display_name);
end;
$$;

revoke execute on function public.update_my_wedding_profile(uuid, text) from public, anon;
grant execute on function public.update_my_wedding_profile(uuid, text) to authenticated;

create or replace function public.set_wedding_member_access(
  target_wedding_id uuid,
  target_member_id uuid,
  new_access_level text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
  current_role text;
  admin_count integer;
begin
  if not public.is_wedding_admin(target_wedding_id) then
    raise exception 'Only an admin can change access levels.';
  end if;
  if new_access_level not in ('admin', 'member') then
    raise exception 'Access level must be admin or member.';
  end if;
  target_role := case when new_access_level = 'admin' then 'partner' else 'planner' end;

  select wm.role into current_role
    from public.wedding_members as wm
   where wm.id = target_member_id
     and wm.wedding_id = target_wedding_id
     and wm.user_id is not null
   for update;
  if current_role is null then
    raise exception 'That member was not found.';
  end if;

  if current_role = 'partner' and target_role <> 'partner' then
    select count(*) into admin_count
      from public.wedding_members as wm
     where wm.wedding_id = target_wedding_id
       and wm.user_id is not null
       and wm.role = 'partner';
    if admin_count <= 1 then
      raise exception 'Promote another admin before changing the last admin.';
    end if;
  end if;

  update public.wedding_members as wm
     set role = target_role, updated_at = now()
   where wm.id = target_member_id;
end;
$$;

revoke execute on function public.set_wedding_member_access(uuid, uuid, text) from public, anon;
grant execute on function public.set_wedding_member_access(uuid, uuid, text) to authenticated;

create or replace function public.remove_wedding_member(
  target_wedding_id uuid,
  target_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  target_role text;
  admin_count integer;
begin
  if not public.is_wedding_admin(target_wedding_id) then
    raise exception 'Only an admin can remove access.';
  end if;

  select wm.user_id, wm.role into target_user_id, target_role
    from public.wedding_members as wm
   where wm.id = target_member_id
     and wm.wedding_id = target_wedding_id
     and wm.user_id is not null
   for update;
  if target_user_id is null then
    raise exception 'That member was not found.';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'You cannot remove your own access.';
  end if;

  if target_role = 'partner' then
    select count(*) into admin_count
      from public.wedding_members as wm
     where wm.wedding_id = target_wedding_id
       and wm.user_id is not null
       and wm.role = 'partner';
    if admin_count <= 1 then
      raise exception 'Promote another admin before removing the last admin.';
    end if;
  end if;

  delete from public.wedding_members as wm
   where wm.id = target_member_id;
end;
$$;

revoke execute on function public.remove_wedding_member(uuid, uuid) from public, anon;
grant execute on function public.remove_wedding_member(uuid, uuid) to authenticated;
