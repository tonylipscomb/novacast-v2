create table if not exists public.gold_admin_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  action text not null,
  status text not null default 'success',
  gold_account_id uuid references public.gold_panel_accounts(id) on delete set null,
  managed_provider_id uuid references public.managed_providers(id) on delete set null,
  gold_user_id text,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint gold_admin_events_action_check check (action in ('account_imported','account_created','account_synced','account_renewed','account_enabled','account_disabled','diagnostics_run','recovery_completed','credentials_accessed','provider_assigned')),
  constraint gold_admin_events_status_check check (status in ('success','failure'))
);

create index if not exists gold_admin_events_created_at_idx on public.gold_admin_events(created_at desc);
create index if not exists gold_admin_events_account_idx on public.gold_admin_events(gold_account_id, created_at desc);
alter table public.gold_admin_events enable row level security;
create policy gold_admin_events_no_client_access on public.gold_admin_events for all to anon, authenticated using (false) with check (false);
revoke all on public.gold_admin_events from anon, authenticated;
grant all on public.gold_admin_events to service_role;
