create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_settings(key, value)
values ('beta_diagnostics_enabled', 'true'::jsonb)
on conflict (key) do nothing;

create table if not exists public.diagnostic_sessions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  managed_provider_id uuid,
  provider_assignment_id uuid,
  content_type text,
  content_id text,
  content_title text,
  stream_host text,
  started_at timestamptz not null,
  first_frame_at timestamptz,
  ended_at timestamptz,
  time_to_first_frame_ms bigint,
  buffer_count integer not null default 0,
  total_buffer_duration_ms bigint not null default 0,
  longest_buffer_duration_ms bigint not null default 0,
  playback_duration_ms bigint,
  last_error_code text,
  last_native_error_code text,
  last_http_status integer,
  exit_reason text,
  diagnostic_status text not null default 'active',
  likely_cause text not null default 'UNKNOWN',
  likely_cause_explanation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.diagnostic_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.diagnostic_sessions(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  event_type text not null,
  event_at timestamptz not null,
  error_code text,
  native_error_code text,
  http_status integer,
  duration_ms bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.device_health (
  device_id uuid primary key references public.devices(id) on delete cascade,
  device_model text,
  manufacturer text,
  platform text,
  os_version text,
  app_version text,
  version_code text,
  managed_provider_id uuid,
  last_seen_at timestamptz,
  last_provider_latency_ms bigint,
  last_stream_latency_ms bigint,
  last_error_code text,
  health_status text not null default 'HEALTHY',
  likely_cause text not null default 'UNKNOWN',
  updated_at timestamptz not null default now()
);

create table if not exists public.provider_health (
  managed_provider_id uuid primary key,
  active_devices integer not null default 0,
  recent_play_attempts integer not null default 0,
  recent_play_failures integer not null default 0,
  average_api_latency_ms bigint,
  average_startup_latency_ms bigint,
  buffering_device_count integer not null default 0,
  health_status text not null default 'HEALTHY',
  likely_issue text,
  updated_at timestamptz not null default now()
);

create index if not exists diagnostic_sessions_device_idx on public.diagnostic_sessions(device_id, started_at desc);
create index if not exists diagnostic_sessions_provider_idx on public.diagnostic_sessions(managed_provider_id, started_at desc);
create index if not exists diagnostic_sessions_status_idx on public.diagnostic_sessions(diagnostic_status, started_at desc);
create index if not exists diagnostic_events_device_idx on public.diagnostic_events(device_id, event_at desc);
create index if not exists diagnostic_events_session_idx on public.diagnostic_events(session_id, event_at desc);
create index if not exists diagnostic_events_time_idx on public.diagnostic_events(event_at desc);

alter table public.app_settings enable row level security;
alter table public.diagnostic_sessions enable row level security;
alter table public.diagnostic_events enable row level security;
alter table public.device_health enable row level security;
alter table public.provider_health enable row level security;
revoke all on public.app_settings, public.diagnostic_sessions, public.diagnostic_events, public.device_health, public.provider_health from anon, authenticated;
grant all on public.app_settings, public.diagnostic_sessions, public.diagnostic_events, public.device_health, public.provider_health to service_role;

comment on table public.diagnostic_events is 'Sanitized NovaCast beta playback and provider telemetry; retain 14 days.';
comment on table public.diagnostic_sessions is 'Sanitized NovaCast beta playback sessions; retain 30 days.';
comment on table public.device_health is 'Current diagnostic-safe device health snapshot.';
