-- Provider health validation metadata.
-- Activation (`status`) stays separate from latest health so retesting cannot
-- silently take an already-active beta provider offline.

alter table public.managed_providers
  alter column status set default 'draft';

alter table public.managed_providers
  drop constraint if exists managed_providers_status_check;

alter table public.managed_providers
  add constraint managed_providers_status_check
  check (status in ('draft', 'active', 'paused', 'revoked'));

alter table public.managed_providers
  add column if not exists health_status text not null default 'unvalidated';

alter table public.managed_providers
  drop constraint if exists managed_providers_health_status_check;

alter table public.managed_providers
  add constraint managed_providers_health_status_check
  check (health_status in ('unvalidated', 'testing', 'healthy', 'degraded', 'failed'));

alter table public.managed_providers
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_successful_test_at timestamptz,
  add column if not exists live_channel_count integer,
  add column if not exists movie_count integer,
  add column if not exists series_count integer,
  add column if not exists validation_stale boolean not null default true,
  add column if not exists last_health_summary jsonb;

comment on column public.managed_providers.health_status is
  'Latest validation result. Independent from status (draft/active/paused/revoked), which controls device delivery.';
comment on column public.managed_providers.last_health_summary is
  'Sanitized diagnostic summary. Must never contain passwords or credential-bearing URLs.';
