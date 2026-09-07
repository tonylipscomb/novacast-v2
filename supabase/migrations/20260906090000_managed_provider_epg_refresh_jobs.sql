create table public.managed_provider_epg_refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  managed_provider_id uuid not null references public.managed_providers(id) on delete cascade,
  source_id uuid not null references public.managed_provider_epg_sources(id) on delete cascade,
  generation uuid not null,
  status text not null check (status in ('queued', 'fetching', 'processing', 'finalizing', 'complete', 'failed')),
  stage text,
  processed_channels integer not null default 0,
  processed_programmes integer not null default 0,
  processed_mappings integer not null default 0,
  total_channels integer,
  total_programmes integer,
  progress_percent numeric,
  checkpoint jsonb,
  failure_code text,
  failure_message text,
  artifact_path text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index managed_provider_epg_refresh_jobs_source_idx
  on public.managed_provider_epg_refresh_jobs (source_id, created_at desc);
create index managed_provider_epg_refresh_jobs_status_idx
  on public.managed_provider_epg_refresh_jobs (status, created_at);
create unique index managed_provider_epg_refresh_jobs_one_active_idx
  on public.managed_provider_epg_refresh_jobs (source_id)
  where status in ('queued', 'fetching', 'processing', 'finalizing');

create unique index managed_provider_epg_source_programmes_identity_idx
  on public.managed_provider_epg_source_programmes (source_id, cache_generation, xmltv_channel_id, start_at, stop_at, title);

insert into storage.buckets (id, name, public)
values ('epg-refresh-artifacts', 'epg-refresh-artifacts', false)
on conflict (id) do update set public = false;

alter table public.managed_provider_epg_refresh_jobs enable row level security;
revoke all on table public.managed_provider_epg_refresh_jobs from anon, authenticated;
