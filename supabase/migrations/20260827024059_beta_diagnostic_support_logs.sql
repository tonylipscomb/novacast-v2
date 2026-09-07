create table if not exists public.diagnostic_logs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  logged_at timestamptz not null default now(),
  level text not null check (level in ('info', 'warning', 'error')),
  category text not null,
  event_code text not null,
  message text,
  context jsonb not null default '{}'::jsonb,
  capture_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists diagnostic_logs_device_time_idx on public.diagnostic_logs(device_id, logged_at desc);
create index if not exists diagnostic_logs_filter_idx on public.diagnostic_logs(device_id, category, level, logged_at desc);
create index if not exists diagnostic_logs_capture_idx on public.diagnostic_logs(capture_id, logged_at desc);

alter table public.diagnostic_logs enable row level security;
revoke all on public.diagnostic_logs from anon, authenticated;
grant all on public.diagnostic_logs to service_role;

comment on table public.diagnostic_logs is 'Bounded, sanitized beta support timeline; retain recent troubleshooting data only.';
