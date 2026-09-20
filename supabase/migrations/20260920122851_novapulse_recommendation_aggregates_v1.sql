create table if not exists public.novapulse_content_trends (
  content_fingerprint_ref text not null,
  content_type text not null check (content_type in ('movie', 'series', 'episode', 'live')),
  scope text not null check (scope in ('global', 'provider')),
  scope_ref text not null default '',
  window_key text not null check (window_key in ('24h', '7d')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  starts bigint not null default 0,
  meaningful_views bigint not null default 0,
  completions bigint not null default 0,
  repeat_views bigint not null default 0,
  favorite_adds bigint not null default 0,
  favorite_removes bigint not null default 0,
  watchlist_adds bigint not null default 0,
  watchlist_removes bigint not null default 0,
  unique_viewers bigint not null default 0,
  meaningful_minutes numeric not null default 0,
  trend_score numeric not null default 0,
  trend_velocity numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint novapulse_content_trends_scope_ref_length check (char_length(scope_ref) <= 96),
  primary key (content_fingerprint_ref, content_type, scope, scope_ref, window_key)
);

create index if not exists novapulse_content_trends_read_idx
  on public.novapulse_content_trends (scope, scope_ref, window_key, trend_score desc, unique_viewers desc, content_fingerprint_ref);

create table if not exists public.novapulse_content_affinity (
  source_fingerprint_ref text not null,
  target_fingerprint_ref text not null,
  source_type text not null check (source_type in ('movie', 'series', 'episode', 'live')),
  target_type text not null check (target_type in ('movie', 'series', 'episode', 'live')),
  scope text not null check (scope in ('global', 'provider')),
  scope_ref text not null default '',
  co_watch_count bigint not null default 0,
  unique_viewers bigint not null default 0,
  weighted_score numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint novapulse_content_affinity_not_self check (source_fingerprint_ref <> target_fingerprint_ref),
  constraint novapulse_content_affinity_scope_ref_length check (char_length(scope_ref) <= 96),
  primary key (source_fingerprint_ref, target_fingerprint_ref, source_type, target_type, scope, scope_ref)
);

create index if not exists novapulse_content_affinity_read_idx
  on public.novapulse_content_affinity (scope, scope_ref, source_fingerprint_ref, weighted_score desc, unique_viewers desc, target_fingerprint_ref);

alter table public.novapulse_content_trends enable row level security;
alter table public.novapulse_content_affinity enable row level security;
revoke all on table public.novapulse_content_trends from anon, authenticated;
revoke all on table public.novapulse_content_affinity from anon, authenticated;
grant all on table public.novapulse_content_trends to service_role;
grant all on table public.novapulse_content_affinity to service_role;

create or replace function public.rebuild_novapulse_recommendation_aggregates(
  p_now timestamptz default now(),
  p_retention_days integer default 90
)
returns jsonb
language plpgsql
as $$
declare
  trend_count bigint;
  affinity_count bigint;
  event_count bigint;
begin
  if p_retention_days < 7 or p_retention_days > 365 then
    raise exception 'invalid_retention_days';
  end if;

  select count(*) into event_count
  from public.recommendation_events
  where occurred_at >= p_now - make_interval(days => p_retention_days)
    and occurred_at <= p_now;

  delete from public.novapulse_content_trends where window_key in ('24h', '7d');
  delete from public.novapulse_content_affinity;

  with windows(window_key, window_start, window_end) as (
    values
      ('24h', p_now - interval '24 hours', p_now),
      ('7d', p_now - interval '7 days', p_now)
  ),
  source_events as (
    select e.device_id, e.provider_ref, e.content_fingerprint_ref, e.content_type,
      e.event_type, e.occurred_at, e.watch_duration_ms
    from public.recommendation_events e
    where e.occurred_at >= p_now - make_interval(days => p_retention_days)
      and e.occurred_at <= p_now
  ),
  scoped_events as (
    select 'global'::text as scope, ''::text as scope_ref, s.* from source_events s
    union all
    select 'provider'::text, s.provider_ref, s.* from source_events s
    where s.provider_ref is not null and s.provider_ref <> ''
  ),
  aggregate_rows as (
    select s.content_fingerprint_ref, s.content_type, s.scope, s.scope_ref,
      w.window_key, w.window_start, w.window_end,
      count(*) filter (where s.event_type = 'play_start') as starts,
      count(*) filter (where s.event_type = 'meaningful_watch') as meaningful_views,
      count(*) filter (where s.event_type = 'complete') as completions,
      count(*) filter (where s.event_type = 'repeat_watch') as repeat_views,
      count(*) filter (where s.event_type = 'favorite_add') as favorite_adds,
      count(*) filter (where s.event_type = 'favorite_remove') as favorite_removes,
      count(*) filter (where s.event_type = 'watchlist_add') as watchlist_adds,
      count(*) filter (where s.event_type = 'watchlist_remove') as watchlist_removes,
      count(distinct s.device_id) filter (where s.event_type in ('meaningful_watch', 'complete', 'repeat_watch', 'favorite_add', 'watchlist_add')) as unique_viewers,
      coalesce(sum(s.watch_duration_ms) filter (where s.event_type = 'meaningful_watch'), 0)::numeric / 60000 as meaningful_minutes
    from scoped_events s
    cross join windows w
    where s.occurred_at >= w.window_start and s.occurred_at <= w.window_end
    group by s.content_fingerprint_ref, s.content_type, s.scope, s.scope_ref, w.window_key, w.window_start, w.window_end
  )
  insert into public.novapulse_content_trends (
    content_fingerprint_ref, content_type, scope, scope_ref, window_key, window_start, window_end,
    starts, meaningful_views, completions, repeat_views, favorite_adds, favorite_removes,
    watchlist_adds, watchlist_removes, unique_viewers, meaningful_minutes, trend_score, trend_velocity, updated_at
  )
  select content_fingerprint_ref, content_type, scope, scope_ref, window_key, window_start, window_end,
    starts, meaningful_views, completions, repeat_views, favorite_adds, favorite_removes,
    watchlist_adds, watchlist_removes, unique_viewers, meaningful_minutes,
    (unique_viewers * 10) + (meaningful_views * 5) + (completions * 3) + (repeat_views * 2)
      + (greatest(0, favorite_adds - favorite_removes) * 2)
      + (greatest(0, watchlist_adds - watchlist_removes) * 2)
      + (starts * 0.25),
    0,
    p_now
  from aggregate_rows;

  update public.novapulse_content_trends current_row
  set trend_velocity = round((current_row.trend_score - (baseline.trend_score / 7)) / greatest((baseline.trend_score / 7), 1), 6)
  from public.novapulse_content_trends baseline
  where current_row.window_key = '24h'
    and baseline.window_key = '7d'
    and baseline.content_fingerprint_ref = current_row.content_fingerprint_ref
    and baseline.content_type = current_row.content_type
    and baseline.scope = current_row.scope
    and baseline.scope_ref = current_row.scope_ref;

  with meaningful_events as (
    select e.device_id, e.provider_ref, e.content_fingerprint_ref, e.content_type, e.occurred_at,
      case e.event_type
        when 'meaningful_watch' then 3
        when 'complete' then 4
        when 'repeat_watch' then 5
        when 'favorite_add' then 4
        when 'watchlist_add' then 4
        else 0
      end as event_weight
    from public.recommendation_events e
    where e.event_type in ('meaningful_watch', 'complete', 'repeat_watch', 'favorite_add', 'watchlist_add')
      and e.occurred_at >= p_now - interval '7 days'
      and e.occurred_at <= p_now
  ),
  viewer_content as (
    select device_id, provider_ref, content_fingerprint_ref, content_type,
      max(event_weight) as content_weight
    from meaningful_events
    group by device_id, provider_ref, content_fingerprint_ref, content_type
  ),
  global_viewer_content as (
    select device_id, content_fingerprint_ref, content_type, max(content_weight) as content_weight
    from viewer_content
    group by device_id, content_fingerprint_ref, content_type
  ),
  global_pair_rows as (
    select
      case when (a.content_fingerprint_ref, a.content_type) < (b.content_fingerprint_ref, b.content_type) then a.content_fingerprint_ref else b.content_fingerprint_ref end as source_fingerprint_ref,
      case when (a.content_fingerprint_ref, a.content_type) < (b.content_fingerprint_ref, b.content_type) then b.content_fingerprint_ref else a.content_fingerprint_ref end as target_fingerprint_ref,
      case when (a.content_fingerprint_ref, a.content_type) < (b.content_fingerprint_ref, b.content_type) then a.content_type else b.content_type end as source_type,
      case when (a.content_fingerprint_ref, a.content_type) < (b.content_fingerprint_ref, b.content_type) then b.content_type else a.content_type end as target_type,
      null::text as provider_ref,
      least(5, a.content_weight + b.content_weight) as viewer_pair_weight
    from global_viewer_content a
    join global_viewer_content b on b.device_id = a.device_id
      and (a.content_fingerprint_ref, a.content_type) < (b.content_fingerprint_ref, b.content_type)
  ),
  provider_pair_rows as (
    select
      case when (a.content_fingerprint_ref, a.content_type) < (b.content_fingerprint_ref, b.content_type) then a.content_fingerprint_ref else b.content_fingerprint_ref end as source_fingerprint_ref,
      case when (a.content_fingerprint_ref, a.content_type) < (b.content_fingerprint_ref, b.content_type) then b.content_fingerprint_ref else a.content_fingerprint_ref end as target_fingerprint_ref,
      case when (a.content_fingerprint_ref, a.content_type) < (b.content_fingerprint_ref, b.content_type) then a.content_type else b.content_type end as source_type,
      case when (a.content_fingerprint_ref, a.content_type) < (b.content_fingerprint_ref, b.content_type) then b.content_type else a.content_type end as target_type,
      a.provider_ref,
      least(5, a.content_weight + b.content_weight) as viewer_pair_weight
    from viewer_content a
    join viewer_content b on b.device_id = a.device_id
      and b.provider_ref = a.provider_ref
      and (a.content_fingerprint_ref, a.content_type) < (b.content_fingerprint_ref, b.content_type)
  ),
  scoped_pairs as (
    select 'global'::text as scope, ''::text as scope_ref, p.* from global_pair_rows p
    union all
    select 'provider'::text, p.provider_ref, p.* from provider_pair_rows p
    where p.provider_ref is not null and p.provider_ref <> ''
  )
  insert into public.novapulse_content_affinity (
    source_fingerprint_ref, target_fingerprint_ref, source_type, target_type, scope, scope_ref,
    co_watch_count, unique_viewers, weighted_score, updated_at
  )
  select source_fingerprint_ref, target_fingerprint_ref, source_type, target_type, scope, scope_ref,
    count(*) as co_watch_count, count(*) as unique_viewers, sum(viewer_pair_weight), p_now
  from scoped_pairs
  group by source_fingerprint_ref, target_fingerprint_ref, source_type, target_type, scope, scope_ref;

  select count(*) into trend_count from public.novapulse_content_trends;
  select count(*) into affinity_count from public.novapulse_content_affinity;
  return jsonb_build_object(
    'eventRowsRead', event_count,
    'trendRowsWritten', trend_count,
    'affinityRowsWritten', affinity_count,
    'suppressedTrendRows', 0,
    'suppressedAffinityRows', 0,
    'window', '24h+7d',
    'retentionDays', p_retention_days
  );
end;
$$;

create or replace function public.get_novapulse_top_trends(
  p_scope text default 'global',
  p_scope_ref text default '',
  p_window_key text default '24h',
  p_limit integer default 100,
  p_min_unique_viewers integer default 3
)
returns table (
  content_fingerprint_ref text,
  content_type text,
  scope text,
  scope_ref text,
  window_key text,
  window_start timestamptz,
  window_end timestamptz,
  starts bigint,
  meaningful_views bigint,
  completions bigint,
  repeat_views bigint,
  favorite_adds bigint,
  watchlist_adds bigint,
  unique_viewers bigint,
  meaningful_minutes numeric,
  trend_score numeric,
  trend_velocity numeric
)
language sql
stable
as $$
  select t.content_fingerprint_ref, t.content_type, t.scope, t.scope_ref, t.window_key,
    t.window_start, t.window_end, t.starts, t.meaningful_views, t.completions, t.repeat_views,
    greatest(0, t.favorite_adds - t.favorite_removes), greatest(0, t.watchlist_adds - t.watchlist_removes),
    t.unique_viewers, t.meaningful_minutes, t.trend_score, t.trend_velocity
  from public.novapulse_content_trends t
  where t.scope = p_scope and t.scope_ref = coalesce(p_scope_ref, '') and t.window_key = p_window_key
    and t.unique_viewers >= greatest(1, p_min_unique_viewers)
  order by t.trend_score desc, t.unique_viewers desc, t.content_fingerprint_ref asc
  limit least(greatest(coalesce(p_limit, 1), 1), 100);
$$;

create or replace function public.get_novapulse_affinity(
  p_source_fingerprint_ref text,
  p_scope text default 'global',
  p_scope_ref text default '',
  p_limit integer default 50,
  p_min_unique_viewers integer default 2,
  p_min_co_watch_count integer default 2
)
returns table (
  source_fingerprint_ref text,
  target_fingerprint_ref text,
  source_type text,
  target_type text,
  scope text,
  scope_ref text,
  co_watch_count bigint,
  unique_viewers bigint,
  weighted_score numeric
)
language sql
stable
as $$
  select a.source_fingerprint_ref, a.target_fingerprint_ref, a.source_type, a.target_type,
    a.scope, a.scope_ref, a.co_watch_count, a.unique_viewers, a.weighted_score
  from public.novapulse_content_affinity a
  where a.source_fingerprint_ref = p_source_fingerprint_ref
    and a.scope = p_scope and a.scope_ref = coalesce(p_scope_ref, '')
    and a.unique_viewers >= greatest(1, p_min_unique_viewers)
    and a.co_watch_count >= greatest(1, p_min_co_watch_count)
  order by a.weighted_score desc, a.unique_viewers desc, a.target_fingerprint_ref asc
  limit least(greatest(coalesce(p_limit, 1), 1), 50);
$$;

revoke all on function public.rebuild_novapulse_recommendation_aggregates(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.get_novapulse_top_trends(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.get_novapulse_affinity(text, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.rebuild_novapulse_recommendation_aggregates(timestamptz, integer) to service_role;
grant execute on function public.get_novapulse_top_trends(text, text, text, integer, integer) to service_role;
grant execute on function public.get_novapulse_affinity(text, text, text, integer, integer, integer) to service_role;

comment on table public.novapulse_content_trends is 'Privacy-safe trend aggregates; client visibility requires the read helper support threshold.';
comment on table public.novapulse_content_affinity is 'Privacy-safe symmetric co-watch aggregates; viewer/device references are never persisted.';
