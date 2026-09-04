-- Wave B: Master company usage + health counts
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
