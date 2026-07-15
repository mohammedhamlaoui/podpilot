-- Follow-up for PodPilot databases that already applied migration_affiliate_system.sql.
-- Supabase exposes pgcrypto from the extensions schema.

begin;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.affiliate_join(p_user_id uuid)
returns public.affiliate_accounts
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare result public.affiliate_accounts; candidate text;
begin
  select * into result from public.affiliate_accounts where user_id = p_user_id;
  if found then return result; end if;
  loop
    candidate := upper(substr(encode(extensions.gen_random_bytes(9), 'hex'), 1, 12));
    begin
      insert into public.affiliate_accounts(user_id, referral_code) values (p_user_id, candidate)
      returning * into result;
      return result;
    exception when unique_violation then null;
    end;
  end loop;
end $$;

alter function public.affiliate_attribute(uuid, text, timestamptz, text)
  set search_path = public, extensions, pg_temp;
alter function public.affiliate_create_commission(uuid, text, text, text, text, numeric, timestamptz)
  set search_path = public, extensions, pg_temp;
alter function public.affiliate_reverse_commission(text, text)
  set search_path = public, extensions, pg_temp;
alter function public.affiliate_release_commissions(uuid)
  set search_path = public, extensions, pg_temp;
alter function public.affiliate_request_payout(uuid, numeric)
  set search_path = public, extensions, pg_temp;
alter function public.affiliate_review_payout(uuid, uuid, text, text)
  set search_path = public, extensions, pg_temp;

commit;
