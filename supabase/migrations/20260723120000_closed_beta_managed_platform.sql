-- NovaCast Closed Beta / Managed Device Platform
-- Evolves device registration without replacing pairing architecture.

-- Managed provider packages (credentials encrypted at rest; never returned to admin UI in plaintext).
create table if not exists public.managed_providers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  credentials_ciphertext text not null,
  credentials_iv text not null,
  content_policy text not null default 'us_only',
  notes text,
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enrich invitations for closed-beta assignment metadata.
alter table public.beta_invites
  add column if not exists managed_provider_id uuid references public.managed_providers(id) on delete set null,
  add column if not exists content_policy text not null default 'us_only',
  add column if not exists assigned_email text,
  add column if not exists assigned_name text,
  add column if not exists notes text,
  add column if not exists activation_duration_hours integer check (activation_duration_hours is null or activation_duration_hours between 1 and 8760);

-- Durable provider assignment per device (managed beta path).
create table if not exists public.device_provider_assignments (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  managed_provider_id uuid not null references public.managed_providers(id) on delete restrict,
  content_policy text not null default 'us_only',
  status text not null default 'active' check (status in ('active', 'revoked', 'superseded')),
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists device_provider_assignments_one_active_idx
  on public.device_provider_assignments(device_id) where status = 'active';
create index if not exists device_provider_assignments_provider_idx
  on public.device_provider_assignments(managed_provider_id, status);

-- Remote command queue acknowledged on heartbeat.
create table if not exists public.device_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  command text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'acked', 'completed', 'failed', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  acked_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists device_commands_pending_idx
  on public.device_commands(device_id, created_at) where status = 'pending';

-- Device diagnostics snapshot (last report from TV).
alter table public.devices
  add column if not exists content_policy text,
  add column if not exists managed_provider_id uuid references public.managed_providers(id) on delete set null,
  add column if not exists assigned_tester_name text,
  add column if not exists assigned_tester_email text,
  add column if not exists last_diagnostics jsonb,
  add column if not exists current_route text,
  add column if not exists app_focus text;

alter table public.device_activations
  add column if not exists content_policy text,
  add column if not exists managed_provider_id uuid references public.managed_providers(id) on delete set null,
  add column if not exists activation_source text not null default 'invite';

alter table public.managed_providers enable row level security;
alter table public.device_provider_assignments enable row level security;
alter table public.device_commands enable row level security;

create policy managed_providers_no_client_access on public.managed_providers for all to anon, authenticated using (false) with check (false);
create policy device_provider_assignments_no_client_access on public.device_provider_assignments for all to anon, authenticated using (false) with check (false);
create policy device_commands_no_client_access on public.device_commands for all to anon, authenticated using (false) with check (false);

revoke all on public.managed_providers, public.device_provider_assignments, public.device_commands from anon, authenticated;

-- Activation uses server time for expiry. Prefer invite duration hours, then invite expires_at.
create or replace function public.activate_device_with_invite(
  p_public_device_code text,
  p_code_hash text,
  p_friendly_name text default null
) returns table(
  device_id uuid,
  activation_status text,
  expires_at timestamptz,
  managed_provider_id uuid,
  content_policy text,
  provider_assigned boolean
)
language plpgsql security definer set search_path = public
as $$
declare
  target public.devices%rowtype;
  invitation public.beta_invites%rowtype;
  activation_expiry timestamptz;
  existing_expiry timestamptz;
  existing_provider uuid;
  existing_policy text;
begin
  select * into target from public.devices where public_device_code = upper(trim(p_public_device_code)) for update;
  if target.id is null or target.status in ('revoked', 'blocked') then
    raise exception 'activation_unavailable';
  end if;

  select * into invitation from public.beta_invites where code_hash = p_code_hash for update;
  if invitation.id is null
     or invitation.status <> 'active'
     or (invitation.starts_at is not null and invitation.starts_at > now())
     or (invitation.expires_at is not null and invitation.expires_at <= now())
     or invitation.redeemed_count >= invitation.maximum_devices then
    raise exception 'activation_unavailable';
  end if;

  select da.expires_at, da.managed_provider_id, da.content_policy
    into existing_expiry, existing_provider, existing_policy
  from public.device_activations da
  where da.device_id = target.id and da.status = 'active'
  order by da.created_at desc
  limit 1;

  if existing_expiry is not null and (existing_expiry > now()) then
    return query select
      target.id,
      'active'::text,
      existing_expiry,
      coalesce(existing_provider, invitation.managed_provider_id),
      coalesce(existing_policy, invitation.content_policy, 'us_only'),
      exists(
        select 1 from public.device_provider_assignments dpa
        where dpa.device_id = target.id and dpa.status = 'active'
      );
    return;
  end if;

  if invitation.activation_duration_hours is not null then
    activation_expiry := now() + make_interval(hours => invitation.activation_duration_hours);
  else
    activation_expiry := invitation.expires_at;
  end if;

  -- Supersede any prior active activation.
  update public.device_activations
    set status = 'revoked', revoked_at = now(), revoked_reason = 'replaced_by_invite', updated_at = now()
  where device_id = target.id and status = 'active';

  insert into public.device_activations(
    device_id, beta_invite_id, status, expires_at, content_policy, managed_provider_id, activation_source
  ) values (
    target.id,
    invitation.id,
    'active',
    activation_expiry,
    coalesce(invitation.content_policy, 'us_only'),
    invitation.managed_provider_id,
    'invite'
  );

  if invitation.managed_provider_id is not null then
    update public.device_provider_assignments
      set status = 'superseded', revoked_at = now(), updated_at = now()
    where device_id = target.id and status = 'active';

    insert into public.device_provider_assignments(
      device_id, managed_provider_id, content_policy, status
    ) values (
      target.id,
      invitation.managed_provider_id,
      coalesce(invitation.content_policy, 'us_only'),
      'active'
    );
  end if;

  update public.beta_invites
    set redeemed_count = redeemed_count + 1,
        status = case when redeemed_count + 1 >= maximum_devices then 'exhausted' else status end,
        updated_at = now()
  where id = invitation.id;

  update public.devices set
    activation_status = 'active',
    status = 'active',
    friendly_name = coalesce(nullif(left(trim(p_friendly_name), 80), ''), friendly_name),
    content_policy = coalesce(invitation.content_policy, 'us_only'),
    managed_provider_id = invitation.managed_provider_id,
    assigned_tester_name = invitation.assigned_name,
    assigned_tester_email = invitation.assigned_email,
    updated_at = now()
  where id = target.id;

  return query select
    target.id,
    'active'::text,
    activation_expiry,
    invitation.managed_provider_id,
    coalesce(invitation.content_policy, 'us_only'),
    invitation.managed_provider_id is not null;
end;
$$;

revoke execute on function public.activate_device_with_invite(text, text, text) from public, anon, authenticated;
grant execute on function public.activate_device_with_invite(text, text, text) to service_role;

-- Admin extension of beta access (server timestamps only).
create or replace function public.extend_device_activation(
  p_device_id uuid,
  p_hours integer
) returns table(device_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  next_expiry timestamptz;
begin
  if p_hours is null or p_hours < 1 or p_hours > 8760 then
    raise exception 'invalid_extension';
  end if;

  update public.device_activations
    set expires_at = case
          when expires_at is null or expires_at < now() then now() + make_interval(hours => p_hours)
          else expires_at + make_interval(hours => p_hours)
        end,
        status = 'active',
        updated_at = now()
    where id = (
      select da.id from public.device_activations da
      where da.device_id = p_device_id
      order by da.created_at desc
      limit 1
    )
  returning public.device_activations.expires_at into next_expiry;

  if next_expiry is null then
    raise exception 'activation_missing';
  end if;

  update public.devices
    set activation_status = 'active', status = 'active', updated_at = now()
  where id = p_device_id;

  return query select p_device_id, next_expiry;
end;
$$;

revoke execute on function public.extend_device_activation(uuid, integer) from public, anon, authenticated;
grant execute on function public.extend_device_activation(uuid, integer) to service_role;

comment on table public.managed_providers is 'Encrypted provider packages assigned to beta devices. Credentials never exposed to clients except via authenticated device download.';
comment on table public.device_provider_assignments is 'Active managed provider assignment per device.';
comment on table public.device_commands is 'Remote command queue delivered on device heartbeat.';
