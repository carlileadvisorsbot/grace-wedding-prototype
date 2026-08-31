create or replace function public.consume_rsvp_rate_limit(
  identifier_hash text,
  action_name text,
  window_seconds integer,
  attempt_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  bucket timestamptz;
  attempts integer;
begin
  if identifier_hash is null or length(identifier_hash) < 32
     or action_name not in ('lookup','help','unlock-edit')
     or window_seconds < 60 or attempt_limit < 1 then
    raise exception using errcode='22023', message='INVALID_RATE_LIMIT';
  end if;

  bucket := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
  insert into public.rsvp_rate_limits(identifier_hash, action, window_started_at, attempt_count)
  values(identifier_hash, action_name, bucket, 1)
  on conflict(identifier_hash, action, window_started_at)
  do update set attempt_count = public.rsvp_rate_limits.attempt_count + 1
  returning attempt_count into attempts;

  return attempts <= attempt_limit;
end $$;

revoke execute on function public.consume_rsvp_rate_limit(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_rsvp_rate_limit(text,text,integer,integer) to service_role;
