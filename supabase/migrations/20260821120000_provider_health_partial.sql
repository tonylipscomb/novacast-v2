-- Bounded diagnostic catalog scans are not provider failures.
-- `partial` means the provider is reachable and authenticated, but the
-- admin health check intentionally stopped counting at the scan limit.

alter table public.managed_providers
  drop constraint if exists managed_providers_health_status_check;

alter table public.managed_providers
  add constraint managed_providers_health_status_check
  check (health_status in ('unvalidated', 'testing', 'healthy', 'partial', 'degraded', 'failed'));
