create or replace function public.admin_apply_rsvp(
  target_wedding_id uuid,
  target_guest_event_id uuid,
  new_status text,
  change_reason text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  assignment public.guest_events;
  household uuid;
  next_version bigint;
  snapshot jsonb;
  key_hash text;
begin
  if not public.is_wedding_admin(target_wedding_id) then
    raise exception using errcode='42501', message='ADMIN_REQUIRED';
  end if;
  if new_status not in ('pending','attending','declined') or length(trim(coalesce(change_reason,''))) < 3 then
    raise exception using errcode='22023', message='STATUS_AND_REASON_REQUIRED';
  end if;

  select * into assignment from public.guest_events
   where id=target_guest_event_id and wedding_id=target_wedding_id for update;
  if assignment.id is null then raise exception using errcode='P0001', message='INVITATION_NOT_FOUND'; end if;

  select household_id into household from public.guests where id=assignment.guest_id;
  update public.guest_events set rsvp_status=new_status,
    responded_at=case when new_status='pending' then null else now() end,
    response_notes=trim(change_reason), version=version+1
   where id=assignment.id;

  select coalesce(max(version),0)+1 into next_version from public.rsvp_submissions where household_id=household;
  select jsonb_agg(jsonb_build_object('guestEventId',ge.id,'status',ge.rsvp_status) order by ge.id)
    into snapshot
    from public.guest_events ge join public.guests g on g.id=ge.guest_id
   where g.household_id=household and ge.invited;
  key_hash:=encode(digest(gen_random_bytes(32),'sha256'),'hex');
  insert into public.rsvp_submissions(wedding_id,household_id,version,idempotency_key_hash,request_hash,response_snapshot,source,actor_user_id,change_reason)
  values(target_wedding_id,household,next_version,key_hash,key_hash,coalesce(snapshot,'[]'::jsonb),'admin',auth.uid(),trim(change_reason));
  insert into public.activity_log(wedding_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values(target_wedding_id,auth.uid(),'rsvp.admin_override','guest_event',assignment.id::text,
    jsonb_build_object('status',assignment.rsvp_status),jsonb_build_object('status',new_status,'reason',trim(change_reason)));
end $$;

create or replace function public.resolve_rsvp_help(
  target_wedding_id uuid,
  target_request_id uuid,
  new_status text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_wedding_admin(target_wedding_id) then
    raise exception using errcode='42501', message='ADMIN_REQUIRED';
  end if;
  if new_status not in ('resolved','dismissed') then
    raise exception using errcode='22023', message='INVALID_HELP_STATUS';
  end if;
  update public.rsvp_help_requests set status=new_status,resolved_by=auth.uid(),resolved_at=now()
   where id=target_request_id and wedding_id=target_wedding_id and status='open';
  if not found then raise exception using errcode='P0001', message='HELP_REQUEST_NOT_FOUND'; end if;
end $$;

revoke execute on function public.admin_apply_rsvp(uuid,uuid,text,text) from public,anon;
revoke execute on function public.resolve_rsvp_help(uuid,uuid,text) from public,anon;
grant execute on function public.admin_apply_rsvp(uuid,uuid,text,text) to authenticated;
grant execute on function public.resolve_rsvp_help(uuid,uuid,text) to authenticated;
