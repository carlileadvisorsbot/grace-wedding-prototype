create or replace function public.unlock_rsvp_internal(session_token text, edit_pin text)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare s public.rsvp_access_sessions; credentials public.household_rsvp_credentials; next_token text;
begin
  select * into s from public.rsvp_access_sessions where token_hash=encode(digest(session_token,'sha256'),'hex') and expires_at>now() for update;
  if s.id is null then raise exception using errcode='P0001',message='SESSION_EXPIRED'; end if;
  select * into credentials from public.household_rsvp_credentials where household_id=s.household_id for update;
  if credentials.pin_locked_until>now() then raise exception using errcode='P0001',message='PIN_LOCKED'; end if;
  if credentials.edit_pin_hash is null or crypt(edit_pin,credentials.edit_pin_hash)<>credentials.edit_pin_hash then
    update public.household_rsvp_credentials set pin_failed_attempts=pin_failed_attempts+1,pin_locked_until=case when pin_failed_attempts+1>=5 then now()+interval '15 minutes' else null end,updated_at=now() where household_id=s.household_id;
    raise exception using errcode='P0001',message='PIN_INVALID';
  end if;
  update public.household_rsvp_credentials set pin_failed_attempts=0,pin_locked_until=null,updated_at=now() where household_id=s.household_id;
  next_token:=encode(gen_random_bytes(32),'hex');
  insert into public.rsvp_access_sessions(wedding_id,household_id,token_hash,mode,invitation_snapshot,expires_at)
  values(s.wedding_id,s.household_id,encode(digest(next_token,'sha256'),'hex'),'edit',s.invitation_snapshot,now()+interval '30 minutes');
  return next_token;
end $$;

revoke execute on function public.unlock_rsvp_internal(text,text) from public,anon,authenticated;
grant execute on function public.unlock_rsvp_internal(text,text) to service_role;

create or replace function public.rsvp_session_requires_pin(session_token text)
returns boolean language sql security definer set search_path=public,extensions as $$
  select exists(select 1 from public.rsvp_access_sessions s join public.rsvp_submissions r on r.household_id=s.household_id where s.token_hash=encode(digest(session_token,'sha256'),'hex'));
$$;
revoke execute on function public.rsvp_session_requires_pin(text) from public,anon,authenticated;
grant execute on function public.rsvp_session_requires_pin(text) to service_role;
