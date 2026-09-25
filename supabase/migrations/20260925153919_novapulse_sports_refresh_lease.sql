begin;

create table public.novapulse_sports_refresh_leases (
  lease_name text primary key check (lease_name = 'novapulse-sports-refresh'),
  owner_token uuid,
  acquired_at timestamptz,
  expires_at timestamptz,
  last_started_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.novapulse_sports_refresh_leases enable row level security;
revoke all on table public.novapulse_sports_refresh_leases from public, anon, authenticated;

create or replace function public.try_acquire_novapulse_sports_refresh_lease()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.novapulse_sports_refresh_leases%rowtype;
  v_owner_token uuid;
  v_retry_after integer;
begin
  insert into public.novapulse_sports_refresh_leases (lease_name)
  values ('novapulse-sports-refresh')
  on conflict (lease_name) do nothing;

  select * into v_row
    from public.novapulse_sports_refresh_leases
   where lease_name = 'novapulse-sports-refresh'
   for update;

  if v_row.owner_token is not null and v_row.expires_at > v_now then
    v_retry_after := greatest(1, least(600, ceil(extract(epoch from (v_row.expires_at - v_now)))::integer));
    return jsonb_build_object('status', 'refresh_in_progress', 'retry_after_seconds', v_retry_after);
  end if;

  if v_row.last_started_at is not null and v_row.last_started_at > v_now - interval '2 minutes' then
    v_retry_after := greatest(1, least(120, ceil(extract(epoch from ((v_row.last_started_at + interval '2 minutes') - v_now)))::integer));
    return jsonb_build_object('status', 'refresh_cooldown', 'retry_after_seconds', v_retry_after);
  end if;

  v_owner_token := gen_random_uuid();
  update public.novapulse_sports_refresh_leases
     set owner_token = v_owner_token,
         acquired_at = v_now,
         expires_at = v_now + interval '10 minutes',
         last_started_at = v_now,
         updated_at = v_now
   where lease_name = 'novapulse-sports-refresh';

  return jsonb_build_object(
    'status', 'acquired',
    'owner_token', v_owner_token,
    'expires_at', v_now + interval '10 minutes'
  );
end;
$$;

create or replace function public.release_novapulse_sports_refresh_lease(p_owner_token uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.novapulse_sports_refresh_leases
     set owner_token = null,
         acquired_at = null,
         expires_at = null,
         updated_at = clock_timestamp()
   where lease_name = 'novapulse-sports-refresh'
     and owner_token = p_owner_token
  returning true;
$$;

revoke all on function public.try_acquire_novapulse_sports_refresh_lease() from public, anon, authenticated;
revoke all on function public.release_novapulse_sports_refresh_lease(uuid) from public, anon, authenticated;
grant execute on function public.try_acquire_novapulse_sports_refresh_lease() to service_role;
grant execute on function public.release_novapulse_sports_refresh_lease(uuid) to service_role;

commit;
