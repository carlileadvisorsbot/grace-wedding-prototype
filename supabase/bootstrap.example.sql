-- Run once after applying the migration. Replace Tucker's placeholder email first.
do $$
declare new_wedding_id uuid;
begin
  insert into public.weddings (name, slug, event_date, venue, timezone, status, join_code_hash)
  values (
    'Tucker & Syd', 'tucker-and-syd', '2027-06-26',
    'Walloon Lake Country Club', 'America/Detroit', 'planning',
    extensions.crypt('9898', extensions.gen_salt('bf'))
  )
  on conflict (slug) do update set
    name = excluded.name,
    event_date = excluded.event_date,
    venue = excluded.venue,
    join_code_hash = excluded.join_code_hash
  returning id into new_wedding_id;

  insert into public.wedding_members (wedding_id, invited_email, display_name, role)
  values
    (new_wedding_id, 'TUCKER_EMAIL_HERE', 'Tucker Carlile', 'partner'),
    (new_wedding_id, 'sydneyslp8@gmail.com', 'Sydney Lancaster', 'partner')
  on conflict (wedding_id, (lower(invited_email))) do update set
    display_name = excluded.display_name,
    role = excluded.role;

  insert into public.events (wedding_id, name, starts_at, venue, sort_order, is_public)
  values (new_wedding_id, 'Wedding Day', '2027-06-26 16:00:00-04', 'Walloon Lake Country Club', 10, true)
  on conflict do nothing;
end $$;
