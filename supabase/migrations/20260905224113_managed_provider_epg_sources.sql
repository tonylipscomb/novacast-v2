create table public.managed_provider_epg_sources (
  id uuid primary key default gen_random_uuid(),
  managed_provider_id uuid not null references public.managed_providers(id) on delete cascade,
  source_kind text not null check (source_kind in ('national', 'local', 'sports', 'fallback')),
  safe_label text not null check (char_length(btrim(safe_label)) between 1 and 120),
  priority integer not null default 100 check (priority between 0 and 1000000),
  enabled boolean not null default true,
  url_ciphertext text not null,
  url_iv text not null,
  last_refresh_at timestamptz,
  last_refresh_status text,
  channel_count integer,
  programme_count integer,
  diagnostic_summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (managed_provider_id, source_kind, safe_label)
);

create index managed_provider_epg_sources_provider_enabled_priority_idx
  on public.managed_provider_epg_sources (managed_provider_id, enabled desc, priority asc, created_at asc);

alter table public.managed_provider_epg_sources enable row level security;

revoke all on table public.managed_provider_epg_sources from anon, authenticated;
