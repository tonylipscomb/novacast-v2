create table if not exists public.gold_panel_accounts (
  id uuid primary key default gen_random_uuid(),
  managed_provider_id uuid not null unique references public.managed_providers(id) on delete cascade,
  gold_user_id text not null,
  gold_package_id text,
  gold_package_name text,
  gold_country text,
  gold_expiration date,
  gold_enabled boolean,
  gold_notes text,
  gold_upstream_url text,
  route_mode text,
  route_domain text,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gold_panel_accounts_expiration_idx
  on public.gold_panel_accounts(gold_expiration);
create index if not exists gold_panel_accounts_status_idx
  on public.gold_panel_accounts(gold_enabled, updated_at desc);

alter table public.gold_panel_accounts enable row level security;
create policy gold_panel_accounts_no_client_access
  on public.gold_panel_accounts for all to anon, authenticated
  using (false) with check (false);
revoke all on public.gold_panel_accounts from anon, authenticated;
grant all on public.gold_panel_accounts to service_role;

comment on table public.gold_panel_accounts is
  'Server-side Gold reseller metadata linked to ordinary encrypted Xtream managed providers. Never stores Gold passwords.';

create table if not exists public.gold_panel_recoveries (
  id uuid primary key default gen_random_uuid(),
  gold_user_id text not null,
  credentials_ciphertext text not null,
  credentials_iv text not null,
  gold_package_id text,
  gold_package_name text,
  gold_country text,
  gold_notes text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists gold_panel_recoveries_pending_idx
  on public.gold_panel_recoveries(expires_at) where used_at is null;
alter table public.gold_panel_recoveries enable row level security;
create policy gold_panel_recoveries_no_client_access
  on public.gold_panel_recoveries for all to anon, authenticated
  using (false) with check (false);
revoke all on public.gold_panel_recoveries from anon, authenticated;
grant all on public.gold_panel_recoveries to service_role;
