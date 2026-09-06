alter table public.managed_providers
  add column if not exists epg_mode text not null default 'provider',
  add column if not exists custom_epg_url_ciphertext text,
  add column if not exists custom_epg_url_iv text,
  add column if not exists epg_last_refresh_at timestamptz,
  add column if not exists epg_last_refresh_status text,
  add column if not exists epg_last_refresh_summary jsonb;

alter table public.managed_providers
  drop constraint if exists managed_providers_epg_mode_check;

alter table public.managed_providers
  add constraint managed_providers_epg_mode_check
  check (epg_mode in ('provider', 'custom', 'provider_fallback_custom'));
