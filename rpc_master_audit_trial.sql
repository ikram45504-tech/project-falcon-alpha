-- Wave C: Master audit trail + company trial expiry (access_ends_at)

alter table public.companies
  add column if not exists access_ends_at timestamptz;

create table if not exists public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null default '',
  action text not null,
  company_id text,
  company_code text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_audit_logs_company_created
  on public.platform_audit_logs (company_id, created_at desc);

create index if not exists idx_platform_audit_logs_created
  on public.platform_audit_logs (created_at desc);

alter table public.platform_audit_logs enable row level security;

create or replace function private.master_write_audit(
  p_action text,
  p_company_id text,
  p_company_code text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.platform_audit_logs (actor_email, action, company_id, company_code, details)
  values (
    lower(coalesce(auth.jwt() ->> 'email', '')),
    trim(coalesce(p_action, '')),
    nullif(trim(coalesce(p_company_id, '')), ''),
    coalesce(nullif(trim(coalesce(p_company_code, '')), ''), ''),
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke all on function private.master_write_audit(text, text, text, jsonb) from public;

-- Agency clients cannot self-edit status / entitlements / access_ends_at.
-- Exception: auto-suspend when access_ends_at has passed.
create or replace function public.protect_company_control_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  expiry_passed boolean := false;
begin
  if tg_op = 'INSERT' then
    if not private.is_platform_master() then
      new.status := 'PENDING_APPROVAL';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    expiry_passed :=
      old.access_ends_at is not null
      and old.access_ends_at <= timezone('utc', now());

    if (new.status is distinct from old.status
        or new.entitlements is distinct from old.entitlements
        or new.access_ends_at is distinct from old.access_ends_at)
       and not private.is_platform_master() then
      if not (
        expiry_passed
        and upper(old.status) = 'ACTIVE'
        and upper(new.status) = 'SUSPENDED'
        and new.entitlements is not distinct from old.entitlements
        and new.access_ends_at is not distinct from old.access_ends_at
      ) then
        raise exception 'Only Master can change company status, entitlements, or access end date';
      end if;
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

drop function if exists public.master_list_companies();

create or replace function public.master_list_companies()
returns table (
  id text,
  company_code text,
  name text,
  email text,
  phone text,
  status text,
  entitlements jsonb,
  access_ends_at timestamptz,
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
    c.access_ends_at,
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
  prev_status text;
begin
  if not private.is_platform_master() then
    raise exception 'Not authorized as Master';
  end if;

  if cleaned not in ('ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED', 'INACTIVE', 'REVOKED') then
    raise exception 'Invalid company status';
  end if;

  select c.status into prev_status from public.companies c where c.id = p_company_id;

  update public.companies
  set status = cleaned,
      updated_at = to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  where id = p_company_id
  returning * into updated;

  if updated.id is null then
    raise exception 'Company not found';
  end if;

  perform private.master_write_audit(
    'set_status',
    updated.id,
    updated.company_code,
    jsonb_build_object('from', prev_status, 'to', cleaned)
  );

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

  perform private.master_write_audit(
    'set_entitlements',
    updated.id,
    updated.company_code,
    jsonb_build_object('entitlements', p_entitlements)
  );

  return updated;
end;
$$;

revoke all on function public.master_set_company_entitlements(text, jsonb) from public;
grant execute on function public.master_set_company_entitlements(text, jsonb) to authenticated;

create or replace function public.master_set_company_access_ends_at(
  p_company_id text,
  p_access_ends_at timestamptz
)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.companies;
  prev timestamptz;
begin
  if not private.is_platform_master() then
    raise exception 'Not authorized as Master';
  end if;

  select c.access_ends_at into prev from public.companies c where c.id = p_company_id;

  update public.companies
  set access_ends_at = p_access_ends_at,
      updated_at = to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  where id = p_company_id
  returning * into updated;

  if updated.id is null then
    raise exception 'Company not found';
  end if;

  perform private.master_write_audit(
    'set_access_ends_at',
    updated.id,
    updated.company_code,
    jsonb_build_object(
      'from', prev,
      'to', p_access_ends_at
    )
  );

  return updated;
end;
$$;

revoke all on function public.master_set_company_access_ends_at(text, timestamptz) from public;
grant execute on function public.master_set_company_access_ends_at(text, timestamptz) to authenticated;

create or replace function public.master_extend_company_access(
  p_company_id text,
  p_days integer
)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_days int := greatest(1, coalesce(p_days, 30));
  updated public.companies;
  prev timestamptz;
  base_ts timestamptz;
  next_ts timestamptz;
  prev_status text;
begin
  if not private.is_platform_master() then
    raise exception 'Not authorized as Master';
  end if;

  select c.access_ends_at, c.status into prev, prev_status
  from public.companies c
  where c.id = p_company_id;

  if not found then
    raise exception 'Company not found';
  end if;

  base_ts := greatest(timezone('utc', now()), coalesce(prev, timezone('utc', now())));
  next_ts := base_ts + make_interval(days => cleaned_days);

  update public.companies
  set access_ends_at = next_ts,
      status = case
        when upper(status) = 'SUSPENDED' then 'ACTIVE'
        else status
      end,
      updated_at = to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  where id = p_company_id
  returning * into updated;

  perform private.master_write_audit(
    'extend_access',
    updated.id,
    updated.company_code,
    jsonb_build_object(
      'days', cleaned_days,
      'from', prev,
      'to', next_ts,
      'status_from', prev_status,
      'status_to', updated.status
    )
  );

  return updated;
end;
$$;

revoke all on function public.master_extend_company_access(text, integer) from public;
grant execute on function public.master_extend_company_access(text, integer) to authenticated;

create or replace function public.master_list_company_audit(
  p_company_id text,
  p_limit integer default 40
)
returns table (
  id uuid,
  actor_email text,
  action text,
  company_id text,
  company_code text,
  details jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lim int := least(200, greatest(1, coalesce(p_limit, 40)));
begin
  if not private.is_platform_master() then
    raise exception 'Not authorized as Master';
  end if;

  return query
  select
    a.id,
    a.actor_email,
    a.action,
    a.company_id,
    a.company_code,
    a.details,
    a.created_at
  from public.platform_audit_logs a
  where a.company_id = p_company_id
  order by a.created_at desc
  limit lim;
end;
$$;

revoke all on function public.master_list_company_audit(text, integer) from public;
grant execute on function public.master_list_company_audit(text, integer) to authenticated;

-- Agency (or Master): suspend when trial/access end date has passed.
create or replace function public.apply_company_access_expiry(p_company_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_company public.companies;
  is_member boolean := false;
begin
  if p_company_id is null or length(trim(p_company_id)) = 0 then
    raise exception 'Company id is required';
  end if;

  select * into row_company from public.companies c where c.id = p_company_id;
  if row_company.id is null then
    raise exception 'Company not found';
  end if;

  if private.is_platform_master() then
    is_member := true;
  else
    select exists (
      select 1
      from public.users u
      where u.company_id = p_company_id
        and (
          lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          or u.id = coalesce(auth.jwt() ->> 'sub', '')
        )
    ) into is_member;
  end if;

  if not is_member then
    raise exception 'Not authorized for this company';
  end if;

  if row_company.access_ends_at is null
     or upper(row_company.status) <> 'ACTIVE'
     or row_company.access_ends_at > timezone('utc', now()) then
    return jsonb_build_object(
      'changed', false,
      'status', row_company.status,
      'access_ends_at', row_company.access_ends_at
    );
  end if;

  update public.companies
  set status = 'SUSPENDED',
      updated_at = to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  where id = p_company_id
  returning * into row_company;

  insert into public.platform_audit_logs (actor_email, action, company_id, company_code, details)
  values (
    lower(coalesce(auth.jwt() ->> 'email', 'system')),
    'auto_suspend_expired',
    row_company.id,
    row_company.company_code,
    jsonb_build_object('access_ends_at', row_company.access_ends_at)
  );

  return jsonb_build_object(
    'changed', true,
    'status', row_company.status,
    'access_ends_at', row_company.access_ends_at
  );
end;
$$;

revoke all on function public.apply_company_access_expiry(text) from public;
grant execute on function public.apply_company_access_expiry(text) to authenticated;

-- Keep wipe behavior, but record an audit row before company delete (platform_audit_logs retained).
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

  perform private.master_write_audit(
    'wipe_company',
    p_company_id,
    v_code,
    jsonb_build_object('company_name', v_name)
  );

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
