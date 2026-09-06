create table public.managed_provider_epg_catalog_snapshot (
  id uuid primary key default gen_random_uuid(),
  managed_provider_id uuid not null references public.managed_providers(id) on delete cascade,
  provider_stream_id text not null,
  channel_name text not null,
  epg_channel_id text,
  category_id text,
  category_name text,
  canonical_name text,
  captured_at timestamptz not null default now(),
  snapshot_generation uuid not null,
  is_active boolean not null default false
);

create index managed_provider_epg_catalog_snapshot_provider_idx
  on public.managed_provider_epg_catalog_snapshot (managed_provider_id);
create index managed_provider_epg_catalog_snapshot_generation_idx
  on public.managed_provider_epg_catalog_snapshot (managed_provider_id, snapshot_generation);
create index managed_provider_epg_catalog_snapshot_stream_idx
  on public.managed_provider_epg_catalog_snapshot (provider_stream_id);
create index managed_provider_epg_catalog_snapshot_canonical_idx
  on public.managed_provider_epg_catalog_snapshot (managed_provider_id, canonical_name);
create index managed_provider_epg_catalog_snapshot_epg_id_idx
  on public.managed_provider_epg_catalog_snapshot (managed_provider_id, epg_channel_id);
create unique index managed_provider_epg_catalog_snapshot_identity_idx
  on public.managed_provider_epg_catalog_snapshot (managed_provider_id, snapshot_generation, provider_stream_id);
create index managed_provider_epg_catalog_snapshot_active_idx
  on public.managed_provider_epg_catalog_snapshot (managed_provider_id, is_active, captured_at desc);

alter table public.managed_provider_epg_catalog_snapshot enable row level security;
revoke all on table public.managed_provider_epg_catalog_snapshot from anon, authenticated;
