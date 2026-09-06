alter table public.managed_provider_epg_catalog_snapshot
  add column if not exists snapshot_expected_rows integer;

alter table public.managed_provider_epg_catalog_snapshot
  add column if not exists snapshot_complete boolean not null default false;
