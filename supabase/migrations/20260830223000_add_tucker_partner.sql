insert into public.wedding_members (
  wedding_id,
  invited_email,
  display_name,
  role
)
select
  id,
  'Tucker@carlileadvisors.com',
  'Tucker Carlile',
  'partner'
from public.weddings
where slug = 'tucker-and-syd'
on conflict (wedding_id, (lower(invited_email))) do update set
  display_name = excluded.display_name,
  role = excluded.role;
