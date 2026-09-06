alter table public.managed_provider_epg_sources
  add column if not exists active_cache_generation uuid;

create table public.managed_provider_epg_source_channels (
  source_id uuid not null references public.managed_provider_epg_sources(id) on delete cascade,
  managed_provider_id uuid not null references public.managed_providers(id) on delete cascade,
  cache_generation uuid not null,
  xmltv_channel_id text not null,
  display_name text not null,
  canonical_name text not null,
  alternate_names jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now(),
  primary key (source_id, cache_generation, xmltv_channel_id)
);

create index managed_provider_epg_source_channels_lookup_idx
  on public.managed_provider_epg_source_channels (source_id, cache_generation);
create index managed_provider_epg_source_channels_id_idx
  on public.managed_provider_epg_source_channels (source_id, xmltv_channel_id);
create index managed_provider_epg_source_channels_canonical_idx
  on public.managed_provider_epg_source_channels (source_id, canonical_name);

create table public.managed_provider_epg_source_programmes (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.managed_provider_epg_sources(id) on delete cascade,
  managed_provider_id uuid not null references public.managed_providers(id) on delete cascade,
  cache_generation uuid not null,
  xmltv_channel_id text not null,
  start_at timestamptz not null,
  stop_at timestamptz not null,
  title text not null,
  subtitle text,
  description text,
  category text,
  refreshed_at timestamptz not null default now(),
  check (stop_at > start_at)
);

create index managed_provider_epg_source_programmes_lookup_idx
  on public.managed_provider_epg_source_programmes (source_id, cache_generation, xmltv_channel_id, start_at);
create index managed_provider_epg_source_programmes_retention_idx
  on public.managed_provider_epg_source_programmes (source_id, cache_generation, stop_at);

create table public.managed_provider_epg_source_mappings (
  source_id uuid not null references public.managed_provider_epg_sources(id) on delete cascade,
  managed_provider_id uuid not null references public.managed_providers(id) on delete cascade,
  cache_generation uuid not null,
  provider_stream_id text not null,
  xmltv_channel_id text,
  match_type text not null check (match_type in ('direct_id', 'case_insensitive_id', 'exact_name', 'normalized_name', 'canonical', 'alias', 'local_affiliate', 'ambiguous', 'unmatched')),
  match_confidence_class text not null check (match_confidence_class in ('proven', 'ambiguous', 'unmatched')),
  provider_canonical text not null,
  xmltv_canonical text,
  mapped_at timestamptz not null default now(),
  primary key (source_id, cache_generation, provider_stream_id)
);

create index managed_provider_epg_source_mappings_lookup_idx
  on public.managed_provider_epg_source_mappings (source_id, cache_generation, match_confidence_class);

alter table public.managed_provider_epg_source_channels enable row level security;
alter table public.managed_provider_epg_source_programmes enable row level security;
alter table public.managed_provider_epg_source_mappings enable row level security;

revoke all on table public.managed_provider_epg_source_channels from anon, authenticated;
revoke all on table public.managed_provider_epg_source_programmes from anon, authenticated;
revoke all on table public.managed_provider_epg_source_mappings from anon, authenticated;
