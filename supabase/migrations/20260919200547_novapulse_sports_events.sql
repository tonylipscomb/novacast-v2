create table public.novapulse_sports_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  sport text,
  league text,
  event_title text not null,
  event_stage text,
  event_status text not null check (event_status in ('upcoming', 'live', 'final', 'unknown')),
  competitor_a text,
  competitor_b text,
  home_name text,
  away_name text,
  home_score text,
  away_score text,
  winner_name text,
  winner_id text,
  loser_name text,
  result_method text,
  decision_type text,
  result_round text,
  result_time text,
  period_detail text,
  went_overtime boolean not null default false,
  shootout boolean not null default false,
  is_draw boolean not null default false,
  is_no_contest boolean not null default false,
  start_time timestamptz,
  completed_at timestamptz,
  network text,
  venue text,
  artwork_url text,
  raw_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint novapulse_sports_events_provider_event_key unique (provider, provider_event_id)
);

create index novapulse_sports_events_upcoming_idx
  on public.novapulse_sports_events (event_status, start_time);
create index novapulse_sports_events_recent_finals_idx
  on public.novapulse_sports_events (event_status, completed_at desc);

alter table public.novapulse_sports_events enable row level security;
revoke all on table public.novapulse_sports_events from anon, authenticated;
grant select on table public.novapulse_sports_events to anon, authenticated;
create policy novapulse_sports_events_public_read
  on public.novapulse_sports_events for select
  to anon, authenticated using (true);
