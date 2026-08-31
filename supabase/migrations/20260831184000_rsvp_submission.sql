create or replace function public.submit_rsvp_internal(session_token text, idempotency_key text, responses jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  s public.rsvp_access_sessions; settings public.wedding_rsvp_settings; tz text; key_hash text; body_hash text;
  prior public.rsvp_submissions; next_version bigint; item jsonb; gid uuid; eid uuid; ge public.guest_events;
  companion public.guests; companion_name text; pin text; result jsonb;
begin
  if char_length(session_token)<32 or char_length(idempotency_key)<16 then raise exception using errcode='P0001',message='SESSION_EXPIRED'; end if;
  select * into s from public.rsvp_access_sessions where token_hash=encode(digest(session_token,'sha256'),'hex') and expires_at>now() for update;
  if s.id is null then raise exception using errcode='P0001',message='SESSION_EXPIRED'; end if;
  select * into settings from public.wedding_rsvp_settings where wedding_id=s.wedding_id;
  select timezone into tz from public.weddings where id=s.wedding_id;
  if settings.deadline_date is null or settings.is_manually_closed or settings.deadline_date < (now() at time zone tz)::date then raise exception using errcode='P0001',message='DEADLINE_CLOSED'; end if;
  key_hash:=encode(digest(idempotency_key,'sha256'),'hex'); body_hash:=encode(digest(responses::text,'sha256'),'hex');
  select * into prior from public.rsvp_submissions where household_id=s.household_id and idempotency_key_hash=key_hash;
  if prior.id is not null then
    if prior.request_hash<>body_hash then raise exception using errcode='P0001',message='SUBMISSION_KEY_REUSED'; end if;
    return jsonb_build_object('ok',true,'version',prior.version,'replayed',true);
  end if;
  if jsonb_typeof(responses)<>'array' or jsonb_array_length(responses)=0 then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
  for item in select * from jsonb_array_elements(responses) loop
    select (x->>'id')::uuid into gid from jsonb_array_elements(s.invitation_snapshot->'guests') x where x->>'ref'=item->>'guestRef';
    select (x->>'id')::uuid into eid from jsonb_array_elements(s.invitation_snapshot->'events') x where x->>'ref'=item->>'eventRef';
    if gid is null or eid is null then raise exception using errcode='P0001',message='INVITATION_CHANGED'; end if;
    select * into ge from public.guest_events where guest_id=gid and event_id=eid and invited for update;
    if ge.id is null or (item->>'status') not in ('attending','declined') then raise exception using errcode='P0001',message='VALIDATION_FAILED'; end if;
    update public.guest_events set rsvp_status=item->>'status',meal_choice=nullif(trim(item->>'mealChoice'),''),response_notes=nullif(trim(item->>'responseNotes'),''),responded_at=now(),version=version+1 where id=ge.id;
    update public.guests set dietary_notes=nullif(trim(item->>'dietaryNotes'),''),version=version+1 where id=gid;
    if coalesce((item->>'plusOneAccepted')::boolean,false) then
      if not ge.plus_one_allowed or item->>'status'<>'attending' then raise exception using errcode='P0001',message='INVALID_PLUS_ONE'; end if;
      companion_name:=nullif(trim(item->>'plusOneName'),''); if companion_name is null then raise exception using errcode='P0001',message='PLUS_ONE_NAME_REQUIRED'; end if;
      select * into companion from public.guests where linked_to_guest_id=gid and guest_kind='plus_one' and is_active for update;
      if companion.id is null then
        insert into public.guests(wedding_id,household_id,first_name,last_name,guest_kind,linked_to_guest_id,is_active,dietary_notes)
        select s.wedding_id,s.household_id,split_part(companion_name,' ',1),trim(substr(companion_name,length(split_part(companion_name,' ',1))+1)),'plus_one',gid,true,nullif(trim(item->>'plusOneDietaryNotes'),'') returning * into companion;
      else
        update public.guests set first_name=split_part(companion_name,' ',1),last_name=trim(substr(companion_name,length(split_part(companion_name,' ',1))+1)),dietary_notes=nullif(trim(item->>'plusOneDietaryNotes'),''),version=version+1 where id=companion.id;
      end if;
      insert into public.guest_events(wedding_id,guest_id,event_id,invited,rsvp_status,responded_at)
      values(s.wedding_id,companion.id,eid,true,'attending',now()) on conflict(guest_id,event_id) do update set invited=true,rsvp_status='attending',responded_at=now(),version=public.guest_events.version+1;
    elsif ge.plus_one_allowed then
      update public.guest_events set rsvp_status='declined',responded_at=now(),version=version+1 where guest_id in(select id from public.guests where linked_to_guest_id=gid and guest_kind='plus_one' and is_active) and event_id=eid;
    end if;
  end loop;
  select coalesce(max(version),0)+1 into next_version from public.rsvp_submissions where household_id=s.household_id;
  insert into public.rsvp_submissions(wedding_id,household_id,version,idempotency_key_hash,request_hash,response_snapshot,source)
  values(s.wedding_id,s.household_id,next_version,key_hash,body_hash,responses,'guest');
  select null into pin; if not exists(select 1 from public.household_rsvp_credentials where household_id=s.household_id and edit_pin_hash is not null) then
    pin:=(100000+floor(random()*900000))::integer::text;
    insert into public.household_rsvp_credentials(household_id,edit_pin_hash) values(s.household_id,crypt(pin,gen_salt('bf'))) on conflict(household_id) do update set edit_pin_hash=excluded.edit_pin_hash,updated_at=now();
  end if;
  update public.rsvp_access_sessions set consumed_at=now() where id=s.id;
  result:=jsonb_build_object('ok',true,'version',next_version,'editPin',pin,'replayed',false); return result;
end $$;

revoke execute on function public.submit_rsvp_internal(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.submit_rsvp_internal(text,text,jsonb) to service_role;
