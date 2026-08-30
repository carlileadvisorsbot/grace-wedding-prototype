create extension if not exists pgcrypto;

create table public.weddings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  event_date date,
  venue text,
  timezone text not null default 'America/Detroit',
  status text not null default 'planning' check (status in ('planning', 'published', 'completed', 'archived')),
  join_code_hash text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wedding_members (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  invited_email text not null,
  display_name text not null,
  role text not null default 'partner' check (role in ('partner', 'planner', 'viewer')),
  permissions jsonb not null default '{}'::jsonb,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index wedding_members_unique_email
  on public.wedding_members (wedding_id, lower(invited_email));
create unique index wedding_members_unique_user
  on public.wedding_members (wedding_id, user_id) where user_id is not null;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  region text,
  postal_code text,
  country text not null default 'US',
  invitation_code_hash text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  first_name text not null,
  last_name text not null default '',
  preferred_name text,
  email text,
  phone text,
  plus_one_allowed boolean not null default false,
  dietary_notes text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  name text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  venue text,
  description text,
  sort_order integer not null default 0,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.guest_events (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  invited boolean not null default true,
  rsvp_status text not null default 'pending' check (rsvp_status in ('pending', 'attending', 'declined')),
  meal_choice text,
  response_notes text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guest_id, event_id)
);

create table public.planning_items (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  kind text not null check (kind in ('task', 'idea', 'decision')),
  title text not null,
  details text,
  status text not null default 'open',
  owner_member_id uuid references public.wedding_members(id) on delete set null,
  due_date date,
  attribution jsonb not null default '{}'::jsonb,
  approvals jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.registry_links (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  name text not null,
  url text not null check (url ~ '^https://'),
  description text,
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.site_sections (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  section_key text not null,
  draft_content jsonb not null default '{}'::jsonb,
  published_content jsonb,
  is_published boolean not null default false,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, section_key)
);

create table public.activity_log (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['weddings','wedding_members','households','guests','events','guest_events','planning_items','registry_links','site_sections']
  loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

create or replace function public.is_wedding_member(target_wedding_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.wedding_members
    where wedding_id = target_wedding_id and user_id = auth.uid()
  );
$$;

create or replace function public.claim_wedding_membership(target_slug text, join_code text)
returns table (wedding_id uuid, wedding_name text, member_role text)
language plpgsql security definer set search_path = public, auth as $$
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

revoke all on function public.is_wedding_member(uuid) from public;
revoke all on function public.claim_wedding_membership(text, text) from public;
grant execute on function public.claim_wedding_membership(text, text) to authenticated;

alter table public.weddings enable row level security;
alter table public.wedding_members enable row level security;
alter table public.households enable row level security;
alter table public.guests enable row level security;
alter table public.events enable row level security;
alter table public.guest_events enable row level security;
alter table public.planning_items enable row level security;
alter table public.registry_links enable row level security;
alter table public.site_sections enable row level security;
alter table public.activity_log enable row level security;

create policy weddings_member_all on public.weddings for all to authenticated
  using (public.is_wedding_member(id)) with check (public.is_wedding_member(id));
create policy wedding_members_member_read on public.wedding_members for select to authenticated
  using (public.is_wedding_member(wedding_id));

do $$
declare table_name text;
begin
  foreach table_name in array array['households','guests','events','guest_events','planning_items','registry_links','site_sections']
  loop
    execute format('create policy %I_member_all on public.%I for all to authenticated using (public.is_wedding_member(wedding_id)) with check (public.is_wedding_member(wedding_id))', table_name, table_name);
  end loop;
end $$;

create policy activity_log_member_read on public.activity_log for select to authenticated
  using (public.is_wedding_member(wedding_id));
create policy activity_log_member_insert on public.activity_log for insert to authenticated
  with check (public.is_wedding_member(wedding_id) and actor_user_id = auth.uid());

grant usage on schema public to authenticated;
grant select on public.weddings, public.wedding_members to authenticated;
grant select, insert, update, delete on public.households, public.guests, public.events,
  public.guest_events, public.planning_items, public.registry_links, public.site_sections to authenticated;
grant select, insert on public.activity_log to authenticated;
