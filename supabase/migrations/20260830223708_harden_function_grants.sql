alter function public.set_updated_at() set search_path = pg_catalog;

revoke execute on function public.claim_wedding_membership(text, text) from public, anon;
grant execute on function public.claim_wedding_membership(text, text) to authenticated;

revoke execute on function public.is_wedding_member(uuid) from public, anon;
grant execute on function public.is_wedding_member(uuid) to authenticated;

drop policy if exists activity_log_member_insert on public.activity_log;
create policy activity_log_member_insert on public.activity_log for insert to authenticated
  with check (public.is_wedding_member(wedding_id) and actor_user_id = (select auth.uid()));

create index if not exists households_wedding_id_idx on public.households (wedding_id);
create index if not exists guests_wedding_id_idx on public.guests (wedding_id);
create index if not exists guests_household_id_idx on public.guests (household_id);
create index if not exists events_wedding_id_idx on public.events (wedding_id);
create index if not exists guest_events_wedding_id_idx on public.guest_events (wedding_id);
create index if not exists guest_events_event_id_idx on public.guest_events (event_id);
create index if not exists planning_items_wedding_id_idx on public.planning_items (wedding_id);
create index if not exists planning_items_owner_member_id_idx on public.planning_items (owner_member_id);
create index if not exists planning_items_created_by_idx on public.planning_items (created_by);
create index if not exists registry_links_wedding_id_idx on public.registry_links (wedding_id);
create index if not exists site_sections_updated_by_idx on public.site_sections (updated_by);
create index if not exists activity_log_wedding_id_idx on public.activity_log (wedding_id);
create index if not exists activity_log_actor_user_id_idx on public.activity_log (actor_user_id);
