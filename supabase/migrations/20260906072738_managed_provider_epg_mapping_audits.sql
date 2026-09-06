create table public.managed_provider_epg_mapping_audits (
  id uuid primary key default gen_random_uuid(),
  managed_provider_id uuid not null references public.managed_providers(id) on delete cascade,
  source_id uuid not null references public.managed_provider_epg_sources(id) on delete cascade,
  snapshot_generation uuid not null,
  epg_generation uuid,
  created_at timestamptz not null default now(),
  provider_rows integer not null,
  unique_provider_canonical_names integer not null,
  provider_rows_with_epg_id integer not null,
  provider_rows_without_epg_id integer not null,
  xmltv_channels integer not null,
  current_mapped integer not null,
  snapshot_expected_rows integer,
  snapshot_stored_rows integer not null,
  snapshot_complete boolean not null,
  snapshot_page_count integer,
  direct_id_potential integer not null,
  case_insensitive_id_potential integer not null,
  exact_name_potential integer not null,
  normalized_name_potential integer not null,
  canonical_potential integer not null,
  ambiguous_potential integer not null,
  additional_deterministic_potential integer not null,
  projected_mapped_total integer not null,
  us_relevant_rows integer not null,
  us_current_mapped integer not null,
  us_additional_potential integer not null,
  us_projected_mapped integer not null,
  us_projected_mapping_percent numeric not null,
  groups jsonb not null default '{}'::jsonb,
  many_to_one jsonb not null default '{}'::jsonb,
  samples jsonb not null default '{}'::jsonb
);

create index managed_provider_epg_mapping_audits_provider_source_idx
  on public.managed_provider_epg_mapping_audits (managed_provider_id, source_id, created_at desc);
create index managed_provider_epg_mapping_audits_snapshot_idx
  on public.managed_provider_epg_mapping_audits (snapshot_generation);

alter table public.managed_provider_epg_mapping_audits enable row level security;
revoke all on table public.managed_provider_epg_mapping_audits from anon, authenticated;
