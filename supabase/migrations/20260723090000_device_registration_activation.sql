create extension if not exists pgcrypto;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  public_device_code text not null unique,
  installation_id_hash text not null unique,
  device_secret_hash text not null,
  friendly_name text,
  platform text,
  manufacturer text,
  model text,
  device_type text,
  os_version text,
  app_version text,
  app_build text,
  status text not null default 'registered' check (status in ('registered', 'active', 'inactive', 'revoked', 'blocked')),
  activation_status text not null default 'inactive' check (activation_status in ('inactive', 'active', 'expired', 'revoked', 'suspended')),
  last_seen_at timestamptz,
  last_ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.beta_invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  display_label text,
  status text not null default 'active' check (status in ('active', 'paused', 'exhausted', 'expired', 'revoked')),
  maximum_devices integer not null default 1 check (maximum_devices between 1 and 10000),
  redeemed_count integer not null default 0 check (redeemed_count >= 0),
  starts_at timestamptz,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.device_activations (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  beta_invite_id uuid references public.beta_invites(id),
  status text not null default 'active' check (status in ('active', 'expired', 'revoked', 'suspended')),
  activated_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists device_activations_one_active_idx on public.device_activations(device_id) where status = 'active';
create index if not exists devices_public_code_idx on public.devices(public_device_code);
create index if not exists devices_activation_status_idx on public.devices(activation_status);
create index if not exists devices_last_seen_idx on public.devices(last_seen_at desc);
create index if not exists beta_invites_status_expiry_idx on public.beta_invites(status, expires_at);
create index if not exists device_activations_device_idx on public.device_activations(device_id, created_at desc);

alter table public.pairing_sessions add column if not exists device_id uuid references public.devices(id) on delete set null;
create index if not exists pairing_sessions_device_idx on public.pairing_sessions(device_id, state, expires_at);

alter table public.devices enable row level security;
alter table public.beta_invites enable row level security;
alter table public.device_activations enable row level security;
create policy devices_no_client_access on public.devices for all to anon, authenticated using (false) with check (false);
create policy beta_invites_no_client_access on public.beta_invites for all to anon, authenticated using (false) with check (false);
create policy device_activations_no_client_access on public.device_activations for all to anon, authenticated using (false) with check (false);
revoke all on public.devices, public.beta_invites, public.device_activations from anon, authenticated;

create or replace function public.activate_device_with_invite(
  p_public_device_code text,
  p_code_hash text,
  p_friendly_name text default null
) returns table(device_id uuid, activation_status text, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  target public.devices%rowtype;
  invitation public.beta_invites%rowtype;
  activation_expiry timestamptz;
begin
  select * into target from public.devices where public_device_code = upper(trim(p_public_device_code)) for update;
  if target.id is null or target.status in ('revoked', 'blocked') then raise exception 'activation_unavailable'; end if;
  select * into invitation from public.beta_invites where code_hash = p_code_hash for update;
  if invitation.id is null or invitation.status <> 'active' or (invitation.starts_at is not null and invitation.starts_at > now()) or (invitation.expires_at is not null and invitation.expires_at <= now()) or invitation.redeemed_count >= invitation.maximum_devices then raise exception 'activation_unavailable'; end if;
  select da.expires_at into activation_expiry from public.device_activations da where da.device_id = target.id and da.status = 'active' order by da.created_at desc limit 1;
  if activation_expiry is not null then
    return query select target.id, 'active'::text, activation_expiry;
    return;
  end if;
  activation_expiry := invitation.expires_at;
  insert into public.device_activations(device_id, beta_invite_id, status, expires_at) values (target.id, invitation.id, 'active', activation_expiry);
  update public.beta_invites set redeemed_count = redeemed_count + 1, status = case when redeemed_count + 1 >= maximum_devices then 'exhausted' else status end, updated_at = now() where id = invitation.id;
  update public.devices set activation_status = 'active', status = 'active', friendly_name = coalesce(nullif(left(trim(p_friendly_name), 80), ''), friendly_name), updated_at = now() where id = target.id;
  return query select target.id, 'active'::text, activation_expiry;
end;
$$;
revoke execute on function public.activate_device_with_invite(text, text, text) from public, anon, authenticated;
grant execute on function public.activate_device_with_invite(text, text, text) to service_role;

comment on table public.devices is 'Registered NovaCast installations. Secret hashes only; clients access through Edge Functions.';
comment on table public.beta_invites is 'Hashed, limited-use beta activation invitations.';
