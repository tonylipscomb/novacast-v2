begin;

alter table public.novapulse_sports_events
  rename column provider to source;
alter table public.novapulse_sports_events
  rename column provider_event_id to source_event_id;
alter table public.novapulse_sports_events
  rename column event_title to event_name;
alter table public.novapulse_sports_events
  rename column event_status to status;
alter table public.novapulse_sports_events
  rename column start_time to starts_at;
alter table public.novapulse_sports_events
  rename column artwork_url to event_artwork_url;
alter table public.novapulse_sports_events
  rename column raw_updated_at to source_updated_at;
alter table public.novapulse_sports_events
  rename column league to league_name;

alter table public.novapulse_sports_events
  drop constraint if exists novapulse_sports_events_event_status_check;
update public.novapulse_sports_events
set status = case status
  when 'upcoming' then 'scheduled'
  when 'unknown' then 'scheduled'
  else status
end;
alter table public.novapulse_sports_events
  add constraint novapulse_sports_events_status_check
  check (status in ('scheduled', 'starting_soon', 'live', 'final', 'postponed', 'cancelled'));

alter table public.novapulse_sports_events
  add column if not exists league_id text,
  add column if not exists status_detail text,
  add column if not exists home_team_id text,
  add column if not exists home_team_logo_url text,
  add column if not exists away_team_id text,
  add column if not exists away_team_logo_url text,
  add column if not exists period text,
  add column if not exists clock text,
  add column if not exists expires_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists novapulse_sports_events_status_starts_at_idx
  on public.novapulse_sports_events (status, starts_at);
create index if not exists novapulse_sports_events_expires_at_idx
  on public.novapulse_sports_events (expires_at);

-- B2 serves this cache through the curated Edge Function only. Keep the
-- table protected even though the original prototype granted direct reads.
revoke all on table public.novapulse_sports_events from anon, authenticated;
drop policy if exists novapulse_sports_events_public_read on public.novapulse_sports_events;

update public.novapulse_sports_events
set expires_at = coalesce(expires_at, case
  when status = 'final' then coalesce(completed_at, starts_at) + interval '18 hours'
  when starts_at is not null then starts_at + interval '8 days'
  else now() + interval '1 day'
end);

commit;
