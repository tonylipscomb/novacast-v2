-- Inventory Telemetry V1: exact counts from completed device-local catalog syncs.
-- Diagnostic count columns remain unchanged and continue to represent health scans.
alter table public.managed_providers
  add column if not exists inventory_live_count integer,
  add column if not exists inventory_movie_count integer,
  add column if not exists inventory_series_count integer,
  add column if not exists inventory_live_generation integer,
  add column if not exists inventory_movie_generation integer,
  add column if not exists inventory_series_generation integer,
  add column if not exists inventory_live_counted_at timestamptz,
  add column if not exists inventory_movie_counted_at timestamptz,
  add column if not exists inventory_series_counted_at timestamptz,
  add column if not exists inventory_live_source_device_id uuid references public.devices(id) on delete set null,
  add column if not exists inventory_movie_source_device_id uuid references public.devices(id) on delete set null,
  add column if not exists inventory_series_source_device_id uuid references public.devices(id) on delete set null,
  add column if not exists inventory_count_source text;

alter table public.managed_providers
  add constraint managed_providers_inventory_live_count_check check (inventory_live_count is null or inventory_live_count >= 0),
  add constraint managed_providers_inventory_movie_count_check check (inventory_movie_count is null or inventory_movie_count >= 0),
  add constraint managed_providers_inventory_series_count_check check (inventory_series_count is null or inventory_series_count >= 0);
