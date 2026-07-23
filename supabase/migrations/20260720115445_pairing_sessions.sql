create extension if not exists pgcrypto;

create table if not exists public.pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  installation_hash text not null,
  state text not null default 'pending' check (state in ('pending', 'claiming', 'validating', 'completed', 'expired', 'cancelled', 'failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  failure_category text,
  validation_attempts integer not null default 0 check (validation_attempts >= 0),
  provider_record_id uuid,
  redemption_hash text,
  redemption_ciphertext text,
  redemption_iv text,
  redemption_expires_at timestamptz,
  redemption_consumed_at timestamptz
);

create index if not exists pairing_sessions_installation_idx on public.pairing_sessions (installation_hash, state, expires_at);
create index if not exists pairing_sessions_expiration_idx on public.pairing_sessions (expires_at);

create table if not exists public.pairing_provider_records (
  id uuid primary key default gen_random_uuid(),
  pairing_session_id uuid not null unique references public.pairing_sessions(id) on delete cascade,
  installation_hash text not null,
  provider_name text not null check (char_length(provider_name) between 1 and 120),
  server_id text not null,
  credentials_ciphertext text not null,
  credentials_iv text not null,
  encryption_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pairing_provider_records_installation_idx on public.pairing_provider_records (installation_hash, created_at desc);
alter table public.pairing_sessions add constraint pairing_sessions_provider_record_fk foreign key (provider_record_id) references public.pairing_provider_records(id) on delete set null;

create table if not exists public.pairing_rate_limits (
  request_key_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0)
);

alter table public.pairing_sessions enable row level security;
alter table public.pairing_provider_records enable row level security;
alter table public.pairing_rate_limits enable row level security;

create policy pairing_sessions_no_client_access on public.pairing_sessions
  for all to anon, authenticated using (false) with check (false);
create policy pairing_provider_records_no_client_access on public.pairing_provider_records
  for all to anon, authenticated using (false) with check (false);
create policy pairing_rate_limits_no_client_access on public.pairing_rate_limits
  for all to anon, authenticated using (false) with check (false);

revoke all on public.pairing_sessions from anon, authenticated;
revoke all on public.pairing_provider_records from anon, authenticated;
revoke all on public.pairing_rate_limits from anon, authenticated;

create or replace function public.consume_pairing_rate_limit(
  p_request_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  insert into public.pairing_rate_limits (request_key_hash, window_started_at, attempt_count)
  values (p_request_key_hash, now(), 1)
  on conflict (request_key_hash) do update
  set
    window_started_at = case
      when now() - pairing_rate_limits.window_started_at >= make_interval(secs => p_window_seconds)
      then now()
      else pairing_rate_limits.window_started_at
    end,
    attempt_count = case
      when now() - pairing_rate_limits.window_started_at >= make_interval(secs => p_window_seconds)
      then 1
      else pairing_rate_limits.attempt_count + 1
    end
  returning attempt_count into next_count;

  return next_count <= p_limit;
end;
$$;

revoke execute on function public.consume_pairing_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_pairing_rate_limit(text, integer, integer) to service_role;

create or replace function public.cleanup_pairing_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.pairing_sessions
  where (expires_at < now() - interval '1 day')
     or (state in ('completed', 'cancelled', 'failed') and coalesce(completed_at, created_at) < now() - interval '7 days');
  get diagnostics removed = row_count;
  delete from public.pairing_rate_limits where window_started_at < now() - interval '1 day';
  return removed;
end;
$$;

revoke execute on function public.cleanup_pairing_sessions() from public, anon, authenticated;
grant execute on function public.cleanup_pairing_sessions() to service_role;

comment on table public.pairing_sessions is 'Private, server-managed pairing state. Clients access it only through Edge Functions.';
comment on table public.pairing_provider_records is 'Encrypted provider credentials. No anonymous or authenticated client read policy exists.';
comment on function public.consume_pairing_rate_limit is 'Atomic service-role-only counter used to slow code enumeration and validation abuse.';
