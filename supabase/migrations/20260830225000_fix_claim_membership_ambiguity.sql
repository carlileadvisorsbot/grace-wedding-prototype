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
  update public.wedding_members as wm
     set user_id = auth.uid(), claimed_at = now()
   where wm.wedding_id = target_wedding.id
     and lower(wm.invited_email) = current_email
     and (wm.user_id is null or wm.user_id = auth.uid())
  returning wm.* into claimed_member;
  if claimed_member.id is null then raise exception 'This verified email is not invited to that wedding.'; end if;
  return query select target_wedding.id, target_wedding.name, claimed_member.role;
end;
$$;

revoke execute on function public.claim_wedding_membership(text, text) from public, anon;
grant execute on function public.claim_wedding_membership(text, text) to authenticated;
