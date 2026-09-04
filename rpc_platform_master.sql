-- Master Control Panel: platform admins + company entitlements
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
