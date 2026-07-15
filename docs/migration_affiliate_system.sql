-- PodPilot affiliate/referral system.
-- Apply once in the Supabase SQL editor before deploying the API/frontend.
-- All financial writes are service-role-only and performed by atomic RPCs.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.affiliate_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  referral_code text not null unique check (referral_code ~ '^[A-Z0-9]{8,24}$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  payout_method text check (payout_method is null or payout_method in ('paypal', 'bank_transfer')),
  payout_email text,
  account_name text,
  iban text,
  swift_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts(id) on delete restrict,
  referred_user_id uuid not null unique references auth.users(id) on delete restrict,
  referral_code text not null,
  first_visit_at timestamptz not null,
  attributed_at timestamptz not null default now(),
  attribution_source text not null default 'first_party',
  created_at timestamptz not null default now(),
  check (first_visit_at >= attributed_at - interval '30 days' - interval '5 minutes')
);

create table if not exists public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts(id) on delete restrict,
  referral_code text not null,
  anonymous_visitor_id text not null check (char_length(anonymous_visitor_id) between 8 and 128),
  landing_path text not null default '/',
  referrer_origin text,
  user_agent_hash text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts(id) on delete restrict,
  referred_user_id uuid not null references auth.users(id) on delete restrict,
  paddle_transaction_id text not null unique,
  paddle_subscription_id text,
  plan text not null check (plan in ('redbubble', 'teepublic', 'all_platforms')),
  transaction_type text not null check (transaction_type in ('initial', 'renewal')),
  gross_amount numeric(12,2) not null check (gross_amount >= 0),
  commission_amount numeric(12,2) not null default 2.00 check (commission_amount = 2.00),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'pending' check (status in ('pending', 'available', 'paid', 'reversed')),
  hold_until timestamptz not null,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_payout_requests (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts(id) on delete restrict,
  amount numeric(12,2) not null check (amount >= 20 and mod(amount, 2) = 0),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'requested' check (status in ('requested', 'approved', 'paid', 'rejected')),
  payout_method_snapshot jsonb not null,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  paid_at timestamptz,
  admin_note text
);

-- Preserves the debt created when an already-paid commission is reversed.
create table if not exists public.affiliate_balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts(id) on delete restrict,
  commission_id uuid not null unique references public.affiliate_commissions(id) on delete restrict,
  amount numeric(12,2) not null check (amount < 0),
  reason text not null,
  created_at timestamptz not null default now()
);

-- Keeps approved reversals idempotent even if Paddle delivers an adjustment
-- before the corresponding transaction.completed event.
create table if not exists public.affiliate_transaction_reversals (
  paddle_transaction_id text primary key,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_payout_audit_logs (
  id uuid primary key default gen_random_uuid(),
  payout_request_id uuid not null references public.affiliate_payout_requests(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  from_status text,
  to_status text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in (
    'approve_payout', 'reject_payout', 'mark_payout_paid',
    'suspend_affiliate', 'reactivate_affiliate'
  )),
  target_type text not null check (target_type in ('affiliate_account', 'payout_request')),
  target_id uuid not null,
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_accounts_user_idx on public.affiliate_accounts(user_id);
create index if not exists affiliate_referrals_affiliate_created_idx on public.affiliate_referrals(affiliate_id, created_at desc);
create index if not exists affiliate_clicks_affiliate_created_idx on public.affiliate_clicks(affiliate_id, created_at desc);
create index if not exists affiliate_clicks_visitor_created_idx on public.affiliate_clicks(anonymous_visitor_id, created_at desc);
create index if not exists affiliate_commissions_affiliate_status_idx on public.affiliate_commissions(affiliate_id, status, created_at desc);
create index if not exists affiliate_commissions_user_idx on public.affiliate_commissions(referred_user_id);
create index if not exists affiliate_commissions_subscription_idx on public.affiliate_commissions(paddle_subscription_id);
create index if not exists affiliate_payouts_affiliate_status_idx on public.affiliate_payout_requests(affiliate_id, status, requested_at desc);
create unique index if not exists affiliate_one_open_payout_idx
  on public.affiliate_payout_requests(affiliate_id)
  where status in ('requested', 'approved');
create index if not exists affiliate_adjustments_affiliate_idx on public.affiliate_balance_adjustments(affiliate_id, created_at desc);
create index if not exists affiliate_payout_audit_request_idx on public.affiliate_payout_audit_logs(payout_request_id, created_at desc);
create index if not exists affiliate_admin_audit_target_idx on public.affiliate_admin_audit_logs(target_type, target_id, created_at desc);

alter table public.affiliate_accounts enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.affiliate_clicks enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.affiliate_payout_requests enable row level security;
alter table public.affiliate_balance_adjustments enable row level security;
alter table public.affiliate_transaction_reversals enable row level security;
alter table public.affiliate_payout_audit_logs enable row level security;
alter table public.affiliate_admin_audit_logs enable row level security;

drop policy if exists "affiliate accounts select own" on public.affiliate_accounts;
create policy "affiliate accounts select own" on public.affiliate_accounts
  for select using (auth.uid() = user_id);
drop policy if exists "affiliate accounts update own" on public.affiliate_accounts;
create policy "affiliate accounts update own" on public.affiliate_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "affiliate referrals select own" on public.affiliate_referrals;
create policy "affiliate referrals select own" on public.affiliate_referrals
  for select using (affiliate_id in (select id from public.affiliate_accounts where user_id = auth.uid()));
drop policy if exists "affiliate clicks select own" on public.affiliate_clicks;
create policy "affiliate clicks select own" on public.affiliate_clicks
  for select using (affiliate_id in (select id from public.affiliate_accounts where user_id = auth.uid()));
drop policy if exists "affiliate commissions select own" on public.affiliate_commissions;
create policy "affiliate commissions select own" on public.affiliate_commissions
  for select using (affiliate_id in (select id from public.affiliate_accounts where user_id = auth.uid()));
drop policy if exists "affiliate payouts select own" on public.affiliate_payout_requests;
create policy "affiliate payouts select own" on public.affiliate_payout_requests
  for select using (affiliate_id in (select id from public.affiliate_accounts where user_id = auth.uid()));
drop policy if exists "affiliate adjustments select own" on public.affiliate_balance_adjustments;
create policy "affiliate adjustments select own" on public.affiliate_balance_adjustments
  for select using (affiliate_id in (select id from public.affiliate_accounts where user_id = auth.uid()));

revoke all on public.affiliate_accounts, public.affiliate_referrals, public.affiliate_clicks,
  public.affiliate_commissions, public.affiliate_payout_requests,
  public.affiliate_balance_adjustments, public.affiliate_transaction_reversals,
  public.affiliate_payout_audit_logs, public.affiliate_admin_audit_logs from anon, authenticated;
grant select on public.affiliate_accounts, public.affiliate_referrals, public.affiliate_clicks,
  public.affiliate_commissions, public.affiliate_payout_requests,
  public.affiliate_balance_adjustments to authenticated;
grant update (payout_method, payout_email, account_name, iban, swift_code, updated_at)
  on public.affiliate_accounts to authenticated;

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

create or replace function public.affiliate_attribute(
  p_referred_user_id uuid, p_referral_code text, p_first_visit_at timestamptz, p_source text
) returns public.affiliate_referrals
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare account public.affiliate_accounts; result public.affiliate_referrals;
begin
  select * into result from public.affiliate_referrals where referred_user_id = p_referred_user_id;
  if found then return result; end if;
  select * into account from public.affiliate_accounts
    where referral_code = upper(p_referral_code) and status = 'active' for update;
  if not found then raise exception 'INVALID_REFERRAL_CODE'; end if;
  if account.user_id = p_referred_user_id then raise exception 'SELF_REFERRAL'; end if;
  if p_first_visit_at < now() - interval '30 days' or p_first_visit_at > now() + interval '5 minutes' then
    raise exception 'EXPIRED_ATTRIBUTION';
  end if;
  insert into public.affiliate_referrals(
    affiliate_id, referred_user_id, referral_code, first_visit_at, attribution_source
  ) values (account.id, p_referred_user_id, account.referral_code, p_first_visit_at, left(coalesce(p_source, 'first_party'), 50))
  on conflict (referred_user_id) do nothing;
  select * into result from public.affiliate_referrals where referred_user_id = p_referred_user_id;
  return result;
end $$;

create or replace function public.affiliate_create_commission(
  p_referred_user_id uuid, p_transaction_id text, p_subscription_id text,
  p_plan text, p_transaction_type text, p_gross_amount numeric, p_completed_at timestamptz
) returns public.affiliate_commissions
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare referral public.affiliate_referrals; account public.affiliate_accounts;
  result public.affiliate_commissions; reversal public.affiliate_transaction_reversals;
begin
  if p_plan not in ('redbubble', 'teepublic', 'all_platforms') then raise exception 'INELIGIBLE_PLAN'; end if;
  select * into result from public.affiliate_commissions where paddle_transaction_id = p_transaction_id;
  if found then return result; end if;
  select * into referral from public.affiliate_referrals where referred_user_id = p_referred_user_id;
  if not found then return null; end if;
  select * into account from public.affiliate_accounts where id = referral.affiliate_id and status = 'active';
  if not found or account.user_id = p_referred_user_id then return null; end if;
  insert into public.affiliate_commissions(
    affiliate_id, referred_user_id, paddle_transaction_id, paddle_subscription_id,
    plan, transaction_type, gross_amount, hold_until
  ) values (
    account.id, p_referred_user_id, p_transaction_id, p_subscription_id,
    p_plan, p_transaction_type, greatest(coalesce(p_gross_amount, 0), 0), p_completed_at + interval '30 days'
  ) on conflict (paddle_transaction_id) do nothing;
  select * into result from public.affiliate_commissions where paddle_transaction_id = p_transaction_id;
  select * into reversal from public.affiliate_transaction_reversals where paddle_transaction_id = p_transaction_id;
  if found and result.status <> 'reversed' then
    update public.affiliate_commissions set status = 'reversed', reversed_at = reversal.created_at,
      reversal_reason = reversal.reason, updated_at = now()
      where id = result.id returning * into result;
  end if;
  return result;
end $$;

create or replace function public.affiliate_reverse_commission(p_transaction_id text, p_reason text)
returns public.affiliate_commissions
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare result public.affiliate_commissions; previous_status text;
begin
  insert into public.affiliate_transaction_reversals(paddle_transaction_id, reason)
    values (p_transaction_id, left(coalesce(p_reason, 'refund_or_chargeback'), 200))
    on conflict (paddle_transaction_id) do update set reason = excluded.reason;
  select * into result from public.affiliate_commissions where paddle_transaction_id = p_transaction_id for update;
  if not found or result.status = 'reversed' then return result; end if;
  previous_status := result.status;
  update public.affiliate_commissions set status = 'reversed', reversed_at = now(),
    reversal_reason = left(coalesce(p_reason, 'refund_or_chargeback'), 200), updated_at = now()
    where id = result.id returning * into result;
  if previous_status = 'paid' then
    insert into public.affiliate_balance_adjustments(affiliate_id, commission_id, amount, reason)
    values (result.affiliate_id, result.id, -result.commission_amount, result.reversal_reason)
    on conflict (commission_id) do nothing;
  end if;
  return result;
end $$;

create or replace function public.affiliate_release_commissions(p_affiliate_id uuid default null)
returns integer language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare changed integer;
begin
  update public.affiliate_commissions set status = 'available', updated_at = now()
    where status = 'pending' and hold_until <= now()
      and (p_affiliate_id is null or affiliate_id = p_affiliate_id);
  get diagnostics changed = row_count;
  return changed;
end $$;

create or replace function public.affiliate_request_payout(p_user_id uuid, p_amount numeric)
returns public.affiliate_payout_requests
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare account public.affiliate_accounts; result public.affiliate_payout_requests;
  gross_available numeric; reserved numeric; debt numeric; spendable numeric; snapshot jsonb;
begin
  select * into account from public.affiliate_accounts where user_id = p_user_id and status = 'active' for update;
  if not found then raise exception 'AFFILIATE_NOT_FOUND'; end if;
  perform public.affiliate_release_commissions(account.id);
  if account.payout_method is null or
     (account.payout_method = 'paypal' and coalesce(account.payout_email, '') = '') or
     (account.payout_method = 'bank_transfer' and (coalesce(account.account_name, '') = '' or coalesce(account.iban, '') = '' or coalesce(account.swift_code, '') = '')) then
    raise exception 'PAYOUT_SETTINGS_REQUIRED';
  end if;
  if exists(select 1 from public.affiliate_payout_requests where affiliate_id = account.id and status in ('requested','approved')) then
    raise exception 'OPEN_PAYOUT_EXISTS';
  end if;
  select coalesce(sum(commission_amount), 0) into gross_available from public.affiliate_commissions
    where affiliate_id = account.id and status = 'available';
  select coalesce(sum(amount), 0) into reserved from public.affiliate_payout_requests
    where affiliate_id = account.id and status in ('requested','approved');
  select coalesce(sum(amount), 0) into debt from public.affiliate_balance_adjustments where affiliate_id = account.id;
  spendable := greatest(gross_available + debt - reserved, 0);
  if p_amount < 20 then raise exception 'PAYOUT_MINIMUM'; end if;
  if mod(p_amount, 2) <> 0 then raise exception 'INVALID_PAYOUT_INCREMENT'; end if;
  if p_amount > spendable then raise exception 'INSUFFICIENT_AVAILABLE_BALANCE'; end if;
  snapshot := case when account.payout_method = 'paypal'
    then jsonb_build_object('method','paypal','email',account.payout_email)
    else jsonb_build_object('method','bank_transfer','account_name',account.account_name,'iban',account.iban,'swift_code',account.swift_code) end;
  insert into public.affiliate_payout_requests(affiliate_id, amount, payout_method_snapshot)
    values (account.id, p_amount, snapshot) returning * into result;
  return result;
end $$;

create or replace function public.affiliate_set_account_status(
  p_affiliate_id uuid, p_admin_user_id uuid, p_status text, p_note text default null
) returns public.affiliate_accounts
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare result public.affiliate_accounts; old_status text;
begin
  if p_status not in ('active','suspended') then raise exception 'INVALID_AFFILIATE_STATUS'; end if;
  select * into result from public.affiliate_accounts where id = p_affiliate_id for update;
  if not found then raise exception 'AFFILIATE_NOT_FOUND'; end if;
  old_status := result.status;
  if old_status = p_status then raise exception 'INVALID_AFFILIATE_STATUS_TRANSITION'; end if;
  update public.affiliate_accounts set status = p_status, updated_at = now()
    where id = p_affiliate_id returning * into result;
  insert into public.affiliate_admin_audit_logs(
    admin_user_id, action, target_type, target_id, previous_state, new_state, note
  ) values (
    p_admin_user_id,
    case when p_status = 'suspended' then 'suspend_affiliate' else 'reactivate_affiliate' end,
    'affiliate_account', p_affiliate_id,
    jsonb_build_object('status', old_status),
    jsonb_build_object('status', p_status),
    nullif(left(coalesce(p_note,''),1000),'')
  );
  return result;
end $$;

create or replace function public.affiliate_review_payout(
  p_request_id uuid, p_admin_user_id uuid, p_status text, p_note text default null
) returns public.affiliate_payout_requests
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare result public.affiliate_payout_requests; old_status text; remaining numeric; row_record record;
begin
  if p_status not in ('approved','paid','rejected') then raise exception 'INVALID_PAYOUT_STATUS'; end if;
  if p_status = 'rejected' and nullif(btrim(coalesce(p_note,'')), '') is null then
    raise exception 'ADMIN_NOTE_REQUIRED';
  end if;
  select * into result from public.affiliate_payout_requests where id = p_request_id for update;
  if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;
  old_status := result.status;
  if (old_status = 'requested' and p_status not in ('approved','rejected')) or
     (old_status = 'approved' and p_status not in ('paid','rejected')) or
     old_status in ('paid','rejected') then raise exception 'INVALID_PAYOUT_TRANSITION'; end if;
  if p_status = 'paid' then
    remaining := result.amount;
    for row_record in select id, commission_amount from public.affiliate_commissions
      where affiliate_id = result.affiliate_id and status = 'available'
      order by hold_until, created_at for update
    loop
      exit when remaining <= 0;
      if row_record.commission_amount > remaining then raise exception 'PAYOUT_ALLOCATION_MISMATCH'; end if;
      update public.affiliate_commissions set status = 'paid', updated_at = now() where id = row_record.id;
      remaining := remaining - row_record.commission_amount;
    end loop;
    if remaining <> 0 then raise exception 'PAYOUT_ALLOCATION_MISMATCH'; end if;
  end if;
  update public.affiliate_payout_requests set status = p_status, reviewed_at = now(),
    paid_at = case when p_status = 'paid' then now() else paid_at end,
    admin_note = nullif(left(coalesce(p_note,''), 1000), '') where id = p_request_id returning * into result;
  insert into public.affiliate_payout_audit_logs(payout_request_id, actor_user_id, from_status, to_status, note)
    values (p_request_id, p_admin_user_id, old_status, p_status, nullif(left(coalesce(p_note,''),1000),''));
  insert into public.affiliate_admin_audit_logs(
    admin_user_id, action, target_type, target_id, previous_state, new_state, note
  ) values (
    p_admin_user_id,
    case p_status when 'approved' then 'approve_payout' when 'rejected' then 'reject_payout' else 'mark_payout_paid' end,
    'payout_request', p_request_id,
    jsonb_build_object('status', old_status, 'amount', result.amount, 'currency', result.currency),
    jsonb_build_object('status', p_status, 'amount', result.amount, 'currency', result.currency),
    nullif(left(coalesce(p_note,''),1000),'')
  );
  return result;
end $$;

revoke all on function public.affiliate_join(uuid) from public, anon, authenticated;
revoke all on function public.affiliate_attribute(uuid,text,timestamptz,text) from public, anon, authenticated;
revoke all on function public.affiliate_create_commission(uuid,text,text,text,text,numeric,timestamptz) from public, anon, authenticated;
revoke all on function public.affiliate_reverse_commission(text,text) from public, anon, authenticated;
revoke all on function public.affiliate_release_commissions(uuid) from public, anon, authenticated;
revoke all on function public.affiliate_request_payout(uuid,numeric) from public, anon, authenticated;
revoke all on function public.affiliate_set_account_status(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.affiliate_review_payout(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.affiliate_join(uuid) to service_role;
grant execute on function public.affiliate_attribute(uuid,text,timestamptz,text) to service_role;
grant execute on function public.affiliate_create_commission(uuid,text,text,text,text,numeric,timestamptz) to service_role;
grant execute on function public.affiliate_reverse_commission(text,text) to service_role;
grant execute on function public.affiliate_release_commissions(uuid) to service_role;
grant execute on function public.affiliate_request_payout(uuid,numeric) to service_role;
grant execute on function public.affiliate_set_account_status(uuid,uuid,text,text) to service_role;
grant execute on function public.affiliate_review_payout(uuid,uuid,text,text) to service_role;
