create table public.managed_provider_epg_refresh_requests (
  id uuid primary key default gen_random_uuid(),
  managed_provider_id uuid not null references public.managed_providers(id) on delete cascade,
  source_id uuid references public.managed_provider_epg_sources(id) on delete cascade,
  refresh_job_id uuid,
  status text not null check (status in ('pending', 'running', 'complete', 'failed')) default 'pending',
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  failure_message text
);

create index managed_provider_epg_refresh_requests_status_idx
  on public.managed_provider_epg_refresh_requests (status, requested_at);
create unique index managed_provider_epg_refresh_requests_one_active_idx
  on public.managed_provider_epg_refresh_requests (managed_provider_id, coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('pending', 'running');

alter table public.managed_provider_epg_refresh_requests enable row level security;
revoke all on table public.managed_provider_epg_refresh_requests from anon, authenticated;
