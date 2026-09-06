alter table public.managed_provider_epg_source_mappings
  drop constraint if exists managed_provider_epg_source_mappings_match_type_check;

alter table public.managed_provider_epg_source_mappings
  add constraint managed_provider_epg_source_mappings_match_type_check
  check (match_type in (
    'direct_id',
    'case_insensitive_id',
    'exact_name',
    'normalized_name',
    'canonical',
    'quality_variant',
    'alias',
    'local_affiliate',
    'ambiguous',
    'unmatched'
  ));
