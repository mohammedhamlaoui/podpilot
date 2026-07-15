-- Secure admin affiliate workflows for databases that already applied
-- migration_affiliate_system.sql.

begin;

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

create index if not exists affiliate_admin_audit_target_idx
  on public.affiliate_admin_audit_logs(target_type, target_id, created_at desc);

alter table public.affiliate_admin_audit_logs enable row level security;
revoke all on public.affiliate_admin_audit_logs from anon, authenticated;

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

revoke all on function public.affiliate_set_account_status(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.affiliate_review_payout(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.affiliate_set_account_status(uuid,uuid,text,text) to service_role;
grant execute on function public.affiliate_review_payout(uuid,uuid,text,text) to service_role;

commit;
