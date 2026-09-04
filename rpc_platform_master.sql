-- Master Control Panel: platform admins + company entitlements + wipe
-- Applied live via Supabase; kept in repo for reference.

create schema if not exists private;

create table if not exists public.platform_admins (
  email text primary key,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

alter table public.companies
  add column if not exists entitlements jsonb not null default '{
    "segments": {"PACKAGE": true, "TICKET": true, "HOTEL": true, "VISA": true, "TRANSPORT": true, "MISC": true},
    "features": {"booking_adjustments": true, "statements": true, "pnl": true},
    "limits": {"bookings_per_segment": null, "parties": null, "vendors": null, "staff_users": null}
  }'::jsonb;

insert into public.platform_admins (email, full_name)
values ('ikram45504@gmail.com', 'Travel Hisab Master')
on conflict (email) do update set full_name = excluded.full_name;

create or replace function private.is_platform_master()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where lower(pa.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function private.is_platform_master() from public;

create or replace function public.master_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.is_platform_master();
$$;

revoke all on function public.master_is_platform_admin() from public;
grant execute on function public.master_is_platform_admin() to authenticated;

create or replace function public.master_list_companies()
returns table (
  id text,
  company_code text,
  name text,
  email text,
  phone text,
  status text,
  entitlements jsonb,
  created_at text,
  updated_at text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not private.is_platform_master() then
    raise exception 'Not authorized as Master';
  end if;

  return query
  select
    c.id,
    c.company_code,
    c.name,
    c.email,
    c.phone,
    c.status,
    c.entitlements,
    c.created_at,
    c.updated_at
  from public.companies c
  order by c.created_at desc;
end;
$$;

revoke all on function public.master_list_companies() from public;
grant execute on function public.master_list_companies() to authenticated;

create or replace function public.master_set_company_status(
  p_company_id text,
  p_status text
)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text := upper(trim(p_status));
  updated public.companies;
begin
  if not private.is_platform_master() then
    raise exception 'Not authorized as Master';
  end if;

  if cleaned not in ('ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED', 'INACTIVE') then
    raise exception 'Invalid company status';
  end if;

  update public.companies
  set status = cleaned,
      updated_at = to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  where id = p_company_id
  returning * into updated;

  if updated.id is null then
    raise exception 'Company not found';
  end if;

  return updated;
end;
$$;

revoke all on function public.master_set_company_status(text, text) from public;
grant execute on function public.master_set_company_status(text, text) to authenticated;

create or replace function public.master_set_company_entitlements(
  p_company_id text,
  p_entitlements jsonb
)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.companies;
begin
  if not private.is_platform_master() then
    raise exception 'Not authorized as Master';
  end if;

  if p_entitlements is null or jsonb_typeof(p_entitlements) <> 'object' then
    raise exception 'Entitlements must be a JSON object';
  end if;

  update public.companies
  set entitlements = p_entitlements,
      updated_at = to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  where id = p_company_id
  returning * into updated;

  if updated.id is null then
    raise exception 'Company not found';
  end if;

  return updated;
end;
$$;

revoke all on function public.master_set_company_entitlements(text, jsonb) from public;
grant execute on function public.master_set_company_entitlements(text, jsonb) to authenticated;

-- Agency clients cannot self-approve or edit capacity.
create or replace function public.protect_company_control_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not private.is_platform_master() then
      new.status := 'PENDING_APPROVAL';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (new.status is distinct from old.status
        or new.entitlements is distinct from old.entitlements)
       and not private.is_platform_master() then
      raise exception 'Only Master can change company status or entitlements';
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_company_control_fields on public.companies;
create trigger trg_protect_company_control_fields
  before insert or update on public.companies
  for each row
  execute function public.protect_company_control_fields();

revoke all on function public.protect_company_control_fields() from public;

-- Master wipe: all company data + public users + auth users
create or replace function public.master_wipe_company(p_company_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_code text;
  v_name text;
  v_user_ids text[];
  v_auth_deleted int := 0;
  uid text;
  v_email text;
begin
  if not private.is_platform_master() then
    raise exception 'Not authorized as Master';
  end if;

  if p_company_id is null or length(trim(p_company_id)) = 0 then
    raise exception 'Company id is required';
  end if;

  select company_code, name into v_code, v_name
  from public.companies
  where id = p_company_id;

  if v_code is null then
    raise exception 'Company not found';
  end if;

  select coalesce(array_agg(id), '{}') into v_user_ids
  from public.users
  where company_id = p_company_id;

  delete from public.package_booking_lines where booking_id in (select id from public.package_bookings where company_id = p_company_id);
  delete from public.package_operational_flight_stopovers where company_id = p_company_id;
  delete from public.package_operational_flights where company_id = p_company_id;
  delete from public.package_operational_hotels where company_id = p_company_id;
  delete from public.package_operational_passengers where company_id = p_company_id;
  delete from public.package_operational_meta where company_id = p_company_id;
  delete from public.package_movement_events where company_id = p_company_id;
  delete from public.package_booking_adjustments where company_id = p_company_id;
  delete from public.package_bookings where company_id = p_company_id;

  delete from public.ticket_booking_lines where booking_id in (select id from public.ticket_bookings where company_id = p_company_id);
  delete from public.ticket_operational_flights where company_id = p_company_id;
  delete from public.ticket_operational_passengers where company_id = p_company_id;
  delete from public.ticket_operational_meta where company_id = p_company_id;
  delete from public.ticket_booking_adjustments where company_id = p_company_id;
  delete from public.ticket_bookings where company_id = p_company_id;

  delete from public.hotel_booking_lines where booking_id in (select id from public.hotel_bookings where company_id = p_company_id);
  delete from public.hotel_commercial_guest_refs where company_id = p_company_id;
  delete from public.hotel_operational_guests where company_id = p_company_id;
  delete from public.hotel_operational_reservations where company_id = p_company_id;
  delete from public.hotel_operational_meta where company_id = p_company_id;
  delete from public.hotel_booking_adjustments where company_id = p_company_id;
  delete from public.hotel_bookings where company_id = p_company_id;

  delete from public.visa_booking_lines where booking_id in (select id from public.visa_bookings where company_id = p_company_id);
  delete from public.visa_passport_details where booking_id in (select id from public.visa_bookings where company_id = p_company_id);
  delete from public.visa_transport_fleet where booking_id in (select id from public.visa_bookings where company_id = p_company_id);
  delete from public.visa_operational_passengers where company_id = p_company_id;
  delete from public.visa_operational_meta where company_id = p_company_id;
  delete from public.visa_booking_adjustments where company_id = p_company_id;
  delete from public.visa_bookings where company_id = p_company_id;

  delete from public.transport_booking_lines where booking_id in (select id from public.transport_bookings where company_id = p_company_id);
  delete from public.transport_operational_sectors where company_id = p_company_id;
  delete from public.transport_operational_meta where company_id = p_company_id;
  delete from public.transport_booking_adjustments where company_id = p_company_id;
  delete from public.transport_bookings where company_id = p_company_id;

  delete from public.misc_booking_lines where booking_id in (select id from public.misc_bookings where company_id = p_company_id);
  delete from public.misc_commercial_family_refs where company_id = p_company_id;
  delete from public.misc_operational_services where company_id = p_company_id;
  delete from public.misc_operational_meta where company_id = p_company_id;
  delete from public.misc_booking_adjustments where company_id = p_company_id;
  delete from public.misc_bookings where company_id = p_company_id;

  delete from public.payment_corrections where company_id = p_company_id;
  delete from public.payment_entries where company_id = p_company_id;
  delete from public.payment_v2_meta where company_id = p_company_id;
  delete from public.parties where company_id = p_company_id;
  delete from public.vendors where company_id = p_company_id;
  delete from public.unassigned_accounts where company_id = p_company_id;
  delete from public.remembered_sessions where company_id = p_company_id;
  delete from public.audit_logs where company_id = p_company_id;
  delete from public.users where company_id = p_company_id;
  delete from public.companies where id = p_company_id;

  foreach uid in array v_user_ids loop
    begin
      select email into v_email from auth.users where id = uid::uuid;
      -- Never delete Master Control Panel login accounts.
      if v_email is not null and exists (
        select 1 from public.platform_admins pa where lower(pa.email) = lower(v_email)
      ) then
        continue;
      end if;
      delete from auth.users where id = uid::uuid;
      v_auth_deleted := v_auth_deleted + 1;
    exception when others then
      null;
    end;
  end loop;

  return jsonb_build_object(
    'company_id', p_company_id,
    'company_code', v_code,
    'company_name', v_name,
    'users_removed', coalesce(array_length(v_user_ids, 1), 0),
    'auth_users_removed', v_auth_deleted
  );
end;
$$;

revoke all on function public.master_wipe_company(text) from public;
grant execute on function public.master_wipe_company(text) to authenticated;

create or replace function public.is_reserved_platform_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where lower(pa.email) = lower(trim(coalesce(p_email, '')))
  );
$$;

revoke all on function public.is_reserved_platform_email(text) from public;
grant execute on function public.is_reserved_platform_email(text) to authenticated;

-- Wave B: company usage + health (also in rpc_master_company_usage.sql)
create or replace function public.master_company_usage(p_company_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not private.is_platform_master() then
    raise exception 'Not authorized as Master';
  end if;

  if p_company_id is null or length(trim(p_company_id)) = 0 then
    raise exception 'Company id is required';
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'Company not found';
  end if;

  select jsonb_build_object(
    'parties', (select count(*)::int from public.parties p where p.company_id = p_company_id),
    'vendors', (select count(*)::int from public.vendors v where v.company_id = p_company_id),
    'staff_users', (select count(*)::int from public.users u where u.company_id = p_company_id),
    'payments_active', (
      select count(*)::int from public.payment_entries pe
      where pe.company_id = p_company_id and upper(coalesce(pe.status, '')) = 'ACTIVE'
    ),
    'bookings_by_segment', jsonb_build_object(
      'PACKAGE', (
        select count(*)::int from public.package_bookings b
        where b.company_id = p_company_id and upper(coalesce(b.status, '')) = 'ACTIVE'
      ),
      'TICKET', (
        select count(*)::int from public.ticket_bookings b
        where b.company_id = p_company_id and upper(coalesce(b.status, '')) = 'ACTIVE'
      ),
      'HOTEL', (
        select count(*)::int from public.hotel_bookings b
        where b.company_id = p_company_id and upper(coalesce(b.status, '')) = 'ACTIVE'
      ),
      'VISA', (
        select count(*)::int from public.visa_bookings b
        where b.company_id = p_company_id and upper(coalesce(b.status, '')) = 'ACTIVE'
      ),
      'TRANSPORT', (
        select count(*)::int from public.transport_bookings b
        where b.company_id = p_company_id and upper(coalesce(b.status, '')) = 'ACTIVE'
      ),
      'MISC', (
        select count(*)::int from public.misc_bookings b
        where b.company_id = p_company_id and upper(coalesce(b.status, '')) = 'ACTIVE'
      )
    ),
    'last_user_login_at', (
      select nullif(trim(u.last_login_at), '')
      from public.users u
      where u.company_id = p_company_id
        and nullif(trim(u.last_login_at), '') is not null
      order by u.last_login_at desc
      limit 1
    )
  )
  into result;

  result := result || jsonb_build_object(
    'bookings_active_total',
    coalesce((result -> 'bookings_by_segment' ->> 'PACKAGE')::int, 0)
      + coalesce((result -> 'bookings_by_segment' ->> 'TICKET')::int, 0)
      + coalesce((result -> 'bookings_by_segment' ->> 'HOTEL')::int, 0)
      + coalesce((result -> 'bookings_by_segment' ->> 'VISA')::int, 0)
      + coalesce((result -> 'bookings_by_segment' ->> 'TRANSPORT')::int, 0)
      + coalesce((result -> 'bookings_by_segment' ->> 'MISC')::int, 0)
  );

  return result;
end;
$$;

revoke all on function public.master_company_usage(text) from public;
grant execute on function public.master_company_usage(text) to authenticated;

-- Wave C (audit + trial): see rpc_master_audit_trial.sql
-- Adds companies.access_ends_at, platform_audit_logs, extend/set access RPCs,
-- master_list_company_audit, apply_company_access_expiry, and audit writes on Master actions.
