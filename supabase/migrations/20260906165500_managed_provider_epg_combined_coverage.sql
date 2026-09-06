create table public.managed_provider_epg_combined_coverage (
  id uuid primary key default gen_random_uuid(),
  managed_provider_id uuid not null references public.managed_providers(id) on delete cascade,
  snapshot_generation uuid not null,
  created_at timestamptz not null default now(),
  provider_rows integer not null default 0,
  resolved integer not null default 0,
  unresolved integer not null default 0,
  mapping_percent numeric not null default 0,
  enabled_source_count integer not null default 0,
  by_source jsonb not null default '{}'::jsonb,
  by_match jsonb not null default '{}'::jsonb,
  candidate_conflicts integer not null default 0,
  resolved_conflicts integer not null default 0,
  unresolved_conflicts integer not null default 0,
  duplicate_provider_variants integer not null default 0,
  current_programme_coverage integer,
  future_programme_coverage integer,
  source_generations jsonb not null default '{}'::jsonb,
  samples jsonb not null default '{}'::jsonb
);

create index managed_provider_epg_combined_coverage_latest_idx
  on public.managed_provider_epg_combined_coverage (managed_provider_id, created_at desc);

alter table public.managed_provider_epg_combined_coverage enable row level security;
revoke all on table public.managed_provider_epg_combined_coverage from anon, authenticated;
