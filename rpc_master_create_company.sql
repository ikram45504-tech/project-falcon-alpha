-- Wave E: Master creates a company + owner login (username/password, no SMTP)

create or replace function public.master_create_company(
  p_company_name text,
  p_owner_username text,
  p_owner_password text,
  p_company_code text default null,
  p_phone text default '',
  p_email text default '',
  p_entitlements jsonb default null,
  p_status text default 'ACTIVE',
  p_trial_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_name text := trim(coalesce(p_company_name, ''));
  v_username text := trim(coalesce(p_owner_username, ''));
  v_password text := coalesce(p_owner_password, '');
  v_phone text := trim(coalesce(p_phone, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_code text := upper(trim(coalesce(p_company_code, '')));
  v_status text := upper(trim(coalesce(p_status, 'ACTIVE')));
  v_entitlements jsonb := coalesce(p_entitlements, '{
    "segments": {"PACKAGE": true, "TICKET": true, "HOTEL": true, "VISA": true, "TRANSPORT": true, "MISC": true},
    "features": {"booking_adjustments": true, "statements": true, "pnl": true},
    "limits": {"bookings_per_segment": null, "parties": null, "vendors": null, "staff_users": null}
  }'::jsonb);
  v_company_id text := gen_random_uuid()::text;
  v_user_id uuid := gen_random_uuid();
  v_now text := to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_letters text;
  v_try int := 0;
  v_access_ends timestamptz := null;
  v_instance uuid := '00000000-0000-0000-0000-000000000000';
begin
  if not private.is_platform_master() then
    raise exception 'Not authorized as Master';
  end if;

  if length(v_name) < 2 then
    raise exception 'Company name is required';
  end if;

  if length(v_username) < 3 or v_username !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'Username must be at least 3 characters and use letters, numbers, dot, underscore or dash only';
  end if;

  if length(v_password) < 8
     or v_password !~ '[A-Z]'
     or v_password !~ '[a-z]'
     or v_password !~ '[0-9]'
     or v_password !~ '[!@#$%^&*]' then
    raise exception 'Password must be at least 8 characters and include upper, lower, number, and a special character';
  end if;

  if v_status not in ('ACTIVE', 'PENDING_APPROVAL') then
    raise exception 'New companies can start as Active or Pending approval';
  end if;

  if v_email <> '' and v_email !~ '^\S+@\S+\.\S+$' then
    raise exception 'Enter a valid email address';
  end if;

  if v_email <> '' and exists (
    select 1 from public.platform_admins pa where lower(pa.email) = v_email
  ) then
    raise exception 'This email is reserved for the Control Panel Master account';
  end if;

  if v_code <> '' then
    if v_code !~ '^[A-Z]{3}$' then
      raise exception 'Company code must be 3 letters, or leave blank to auto-generate';
    end if;
    if exists (select 1 from public.companies c where upper(c.company_code) = v_code) then
      raise exception 'Company code % is already in use', v_code;
    end if;
  else
    v_letters := regexp_replace(upper(v_name), '[^A-Z]', '', 'g');
    if length(v_letters) < 3 then
      v_letters := rpad(coalesce(nullif(v_letters, ''), 'ABC'), 3, 'X');
    end if;
    v_code := substr(v_letters, 1, 3);
    while exists (select 1 from public.companies c where upper(c.company_code) = v_code) loop
      v_try := v_try + 1;
      if v_try > 80 then
        raise exception 'Could not allocate a unique Company Code';
      end if;
      v_code := chr(65 + floor(random() * 26)::int)
        || chr(65 + floor(random() * 26)::int)
        || chr(65 + floor(random() * 26)::int);
    end loop;
  end if;

  if v_email = '' then
    v_email := lower(v_username) || '.' || lower(v_code) || '.owner@provisioned.travelhisab.local';
  end if;

  if exists (
    select 1 from auth.users au
    where lower(au.email) = v_email
      and au.deleted_at is null
  ) then
    raise exception 'This email is already registered';
  end if;

  if p_trial_days is not null and p_trial_days > 0 then
    v_access_ends := timezone('utc', now()) + make_interval(days => least(p_trial_days, 365));
  end if;

  insert into public.companies (
    id, company_code, name, dts_license, address, phone, whatsapp, email,
    base_currency, foreign_currency, status, entitlements, access_ends_at, created_at, updated_at
  ) values (
    v_company_id, v_code, v_name, '', '', v_phone, v_phone, v_email,
    'PKR', 'SAR', v_status, v_entitlements, v_access_ends, v_now, v_now
  );

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token,
    is_sso_user, is_anonymous
  ) values (
    v_instance,
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_password, gen_salt('bf')),
    timezone('utc', now()),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object(
      'company_id', v_company_id,
      'company_code', v_code,
      'company_name', v_name,
      'username', v_username,
      'full_name', v_username,
      'phone', v_phone,
      'role', 'OWNER'
    ),
    timezone('utc', now()),
    timezone('utc', now()),
    '',
    '',
    '',
    '',
    false,
    false
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at, email
  ) values (
    gen_random_uuid(),
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email',
    v_user_id::text,
    timezone('utc', now()),
    timezone('utc', now()),
    timezone('utc', now()),
    v_email
  );

  insert into public.users (
    id, company_id, full_name, username, email, phone, phone_normalized,
    password_hash, password_salt, password_iterations, role, status, created_at, updated_at, last_login_at
  ) values (
    v_user_id::text, v_company_id, v_username, v_username, v_email, v_phone, v_phone,
    'SUPABASE_AUTH', 'SUPABASE_AUTH', 0, 'OWNER', 'ACTIVE', v_now, v_now, ''
  );

  perform private.master_write_audit(
    'create_company',
    v_company_id,
    v_code,
    jsonb_build_object(
      'company_name', v_name,
      'owner_username', v_username,
      'status', v_status,
      'trial_days', p_trial_days
    )
  );

  return jsonb_build_object(
    'company_id', v_company_id,
    'company_code', v_code,
    'company_name', v_name,
    'owner_username', v_username,
    'owner_email', v_email,
    'status', v_status,
    'access_ends_at', v_access_ends
  );
exception
  when others then
    delete from public.users where id = v_user_id::text;
    delete from auth.identities where user_id = v_user_id;
    delete from auth.users where id = v_user_id;
    delete from public.companies where id = v_company_id;
    raise;
end;
$$;

revoke all on function public.master_create_company(text, text, text, text, text, text, jsonb, text, integer) from public;
grant execute on function public.master_create_company(text, text, text, text, text, text, jsonb, text, integer) to authenticated;
