create extension if not exists pgcrypto;

create table if not exists public.analytics_sessions (
  id uuid primary key default gen_random_uuid(),
  session_uuid uuid not null unique,
  device_id uuid not null references public.devices(id) on delete cascade,
  public_device_id text not null,
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  ended_at timestamptz,
  duration_ms bigint,
  app_version text not null,
  app_build text,
  manufacturer text,
  model text,
  platform_api_level integer,
  environment text not null default 'beta'
    check (environment in ('beta', 'production', 'development')),
  exit_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_sessions_duration_nonnegative
    check (duration_ms is null or duration_ms >= 0),
  constraint analytics_sessions_time_order
    check (ended_at is null or ended_at >= started_at),
  constraint analytics_sessions_public_device_id_length
    check (char_length(public_device_id) between 1 and 64),
  constraint analytics_sessions_app_version_length
    check (char_length(app_version) between 1 and 40),
  constraint analytics_sessions_app_build_length
    check (app_build is null or char_length(app_build) <= 40),
  constraint analytics_sessions_manufacturer_length
    check (manufacturer is null or char_length(manufacturer) <= 80),
  constraint analytics_sessions_model_length
    check (model is null or char_length(model) <= 120),
  constraint analytics_sessions_exit_reason_length
    check (exit_reason is null or char_length(exit_reason) <= 80)
);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  session_id uuid not null references public.analytics_sessions(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  public_device_id text not null,
  event_name text not null,
  event_category text not null,
  occurred_at timestamptz not null,
  route text,
  provider_ref text,
  content_ref text,
  content_type text,
  outcome text,
  duration_ms bigint,
  count_value bigint,
  metadata jsonb not null default '{}'::jsonb,
  app_version text not null,
  app_build text,
  created_at timestamptz not null default now(),
  constraint analytics_events_idempotency_length
    check (char_length(idempotency_key) between 1 and 160),
  constraint analytics_events_public_device_id_length
    check (char_length(public_device_id) between 1 and 64),
  constraint analytics_events_name_length
    check (char_length(event_name) between 1 and 48),
  constraint analytics_events_category_length
    check (char_length(event_category) between 1 and 32),
  constraint analytics_events_route_length
    check (route is null or char_length(route) <= 96),
  constraint analytics_events_provider_ref_length
    check (provider_ref is null or char_length(provider_ref) <= 96),
  constraint analytics_events_content_ref_length
    check (content_ref is null or char_length(content_ref) <= 96),
  constraint analytics_events_content_type_length
    check (content_type is null or char_length(content_type) <= 40),
  constraint analytics_events_outcome_length
    check (outcome is null or char_length(outcome) <= 48),
  constraint analytics_events_app_version_length
    check (char_length(app_version) between 1 and 40),
  constraint analytics_events_app_build_length
    check (app_build is null or char_length(app_build) <= 40),
  constraint analytics_events_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint analytics_events_metadata_size
    check (octet_length(metadata::text) <= 2048),
  constraint analytics_events_duration_nonnegative
    check (duration_ms is null or duration_ms >= 0),
  constraint analytics_events_count_nonnegative
    check (count_value is null or count_value >= 0),
  unique (device_id, idempotency_key)
);

create table if not exists public.analytics_device_state (
  device_id uuid primary key references public.devices(id) on delete cascade,
  public_device_id text not null,
  current_session_id uuid references public.analytics_sessions(id) on delete set null,
  last_seen_at timestamptz not null,
  current_route text,
  current_activity text,
  provider_state text,
  playback_state text,
  network_connected boolean,
  app_version text not null,
  app_build text,
  updated_at timestamptz not null default now(),
  constraint analytics_device_state_public_device_id_length
    check (char_length(public_device_id) between 1 and 64),
  constraint analytics_device_state_route_length
    check (current_route is null or char_length(current_route) <= 96),
  constraint analytics_device_state_activity_length
    check (current_activity is null or char_length(current_activity) <= 48),
  constraint analytics_device_state_provider_length
    check (provider_state is null or char_length(provider_state) <= 48),
  constraint analytics_device_state_playback_length
    check (playback_state is null or char_length(playback_state) <= 48),
  constraint analytics_device_state_app_version_length
    check (char_length(app_version) between 1 and 40),
  constraint analytics_device_state_app_build_length
    check (app_build is null or char_length(app_build) <= 40)
);

create table if not exists public.analytics_rate_limits (
  device_id uuid primary key references public.devices(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  event_count integer not null default 0 check (event_count >= 0)
);

create index if not exists analytics_events_occurred_at_idx
  on public.analytics_events (occurred_at desc);
create index if not exists analytics_events_name_time_idx
  on public.analytics_events (event_name, occurred_at desc);
create index if not exists analytics_events_device_time_idx
  on public.analytics_events (device_id, occurred_at desc);
create index if not exists analytics_events_public_device_time_idx
  on public.analytics_events (public_device_id, occurred_at desc);
create index if not exists analytics_events_session_time_idx
  on public.analytics_events (session_id, occurred_at desc);
create index if not exists analytics_events_outcome_time_idx
  on public.analytics_events (outcome, occurred_at desc);
create index if not exists analytics_sessions_last_seen_idx
  on public.analytics_sessions (last_seen_at desc);
create index if not exists analytics_sessions_device_started_idx
  on public.analytics_sessions (device_id, started_at desc);
create index if not exists analytics_device_state_last_seen_idx
  on public.analytics_device_state (last_seen_at desc);

alter table public.analytics_sessions enable row level security;
alter table public.analytics_events enable row level security;
alter table public.analytics_device_state enable row level security;
alter table public.analytics_rate_limits enable row level security;

revoke all on public.analytics_sessions from anon, authenticated;
revoke all on public.analytics_events from anon, authenticated;
revoke all on public.analytics_device_state from anon, authenticated;
revoke all on public.analytics_rate_limits from anon, authenticated;
grant all on public.analytics_sessions to service_role;
grant all on public.analytics_events to service_role;
grant all on public.analytics_device_state to service_role;
grant all on public.analytics_rate_limits to service_role;

create or replace function public.consume_analytics_rate_limit(
  p_device_id uuid,
  p_event_count integer,
  p_limit integer default 100,
  p_window_seconds integer default 3600
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  if p_event_count is null or p_event_count < 0 or p_event_count > 50
     or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  insert into public.analytics_rate_limits(device_id, window_started_at, event_count)
  values (p_device_id, now(), p_event_count)
  on conflict (device_id) do update
  set
    window_started_at = case
      when now() - analytics_rate_limits.window_started_at >= make_interval(secs => p_window_seconds)
      then now()
      else analytics_rate_limits.window_started_at
    end,
    event_count = case
      when now() - analytics_rate_limits.window_started_at >= make_interval(secs => p_window_seconds)
      then excluded.event_count
      else analytics_rate_limits.event_count + excluded.event_count
    end
  returning event_count into next_count;

  return next_count <= p_limit;
end;
$$;

revoke execute on function public.consume_analytics_rate_limit(uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_analytics_rate_limit(uuid, integer, integer, integer)
  to service_role;

create or replace function public.close_stale_analytics_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  closed_count integer;
begin
  update public.analytics_sessions
  set ended_at = last_seen_at + interval '45 minutes',
      duration_ms = greatest(0, floor(extract(epoch from ((last_seen_at + interval '45 minutes') - started_at)) * 1000)::bigint),
      exit_reason = coalesce(exit_reason, 'stale_timeout'),
      updated_at = now()
  where ended_at is null
    and last_seen_at < now() - interval '45 minutes';

  get diagnostics closed_count = row_count;
  return closed_count;
end;
$$;

revoke execute on function public.close_stale_analytics_sessions() from public, anon, authenticated;
grant execute on function public.close_stale_analytics_sessions() to service_role;

comment on table public.analytics_sessions is 'Server-ingested NovaCast beta sessions; target retention 90 days.';
comment on table public.analytics_events is 'Server-ingested allow-listed NovaCast beta events; target retention 60 days.';
comment on table public.analytics_device_state is 'Current server-ingested high-level state for admin analytics.';
comment on function public.consume_analytics_rate_limit is 'Dedicated analytics event counter; 100 accepted events per device per hour during beta.';
comment on function public.close_stale_analytics_sessions is 'Closes sessions with no heartbeat for 45 minutes; scheduling is intentionally external.';
