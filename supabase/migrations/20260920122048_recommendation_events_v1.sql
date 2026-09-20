create table if not exists public.recommendation_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  session_ref text not null,
  provider_ref text not null,
  provider_content_ref text not null,
  content_fingerprint_ref text not null,
  content_type text not null check (content_type in ('movie', 'series', 'episode', 'live')),
  event_type text not null check (event_type in (
    'play_start', 'meaningful_watch', 'complete', 'abandon', 'repeat_watch',
    'favorite_add', 'favorite_remove', 'watchlist_add', 'watchlist_remove'
  )),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  watch_duration_ms bigint,
  content_duration_ms bigint,
  progress_bucket text check (progress_bucket is null or progress_bucket in ('started', 'meaningful', 'half', 'near_complete', 'complete')),
  idempotency_ref text not null,
  created_at timestamptz not null default now(),
  constraint recommendation_events_watch_duration_nonnegative check (watch_duration_ms is null or watch_duration_ms >= 0),
  constraint recommendation_events_content_duration_nonnegative check (content_duration_ms is null or content_duration_ms >= 0),
  constraint recommendation_events_reference_lengths check (
    char_length(session_ref) between 1 and 96 and
    char_length(provider_ref) between 1 and 96 and
    char_length(provider_content_ref) between 1 and 96 and
    char_length(content_fingerprint_ref) between 1 and 96 and
    char_length(idempotency_ref) between 1 and 96
  ),
  unique (device_id, idempotency_ref)
);

create index if not exists recommendation_events_occurred_at_idx
  on public.recommendation_events (occurred_at desc);
create index if not exists recommendation_events_type_time_idx
  on public.recommendation_events (event_type, occurred_at desc);
create index if not exists recommendation_events_fingerprint_time_idx
  on public.recommendation_events (content_fingerprint_ref, occurred_at desc);
create index if not exists recommendation_events_device_time_idx
  on public.recommendation_events (device_id, occurred_at desc);

alter table public.recommendation_events enable row level security;
revoke all on public.recommendation_events from anon, authenticated;
grant all on public.recommendation_events to service_role;

comment on table public.recommendation_events is 'Privacy-safe device recommendation behavior events; raw fingerprint/title data is never persisted.';
