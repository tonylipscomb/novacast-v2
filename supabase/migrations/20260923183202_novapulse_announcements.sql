begin;

create table public.novapulse_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  description text not null default '',
  secondary_text text,
  badge text,
  kind text not null default 'general' check (kind in ('general', 'update', 'service_alert', 'provider_alert')),
  importance text not null default 'normal' check (importance in ('normal', 'important', 'critical')),
  artwork_path text,
  status text not null default 'draft' check (status in ('draft', 'published', 'disabled', 'archived')),
  priority integer not null default 0 check (priority between 0 and 100),
  starts_at timestamptz,
  ends_at timestamptz,
  published_at timestamptz,
  disabled_at timestamptz,
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  constraint novapulse_announcements_title_length check (char_length(title) <= 120),
  constraint novapulse_announcements_description_length check (char_length(description) <= 500),
  constraint novapulse_announcements_secondary_length check (secondary_text is null or char_length(secondary_text) <= 80),
  constraint novapulse_announcements_badge_length check (badge is null or char_length(badge) <= 32),
  constraint novapulse_announcements_schedule_order check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint novapulse_announcements_published_content check (status <> 'published' or (char_length(btrim(title)) > 0 and char_length(btrim(description)) > 0))
);

create index novapulse_announcements_feed_idx
  on public.novapulse_announcements (importance, priority desc, starts_at desc, id);
create index novapulse_announcements_status_deleted_idx
  on public.novapulse_announcements (status, deleted_at, disabled_at);
create index novapulse_announcements_schedule_idx
  on public.novapulse_announcements (starts_at, ends_at);

create or replace function public.novapulse_announcements_set_timestamps()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at = coalesce(new.created_at, now());
    new.updated_at = coalesce(new.updated_at, new.created_at);
    new.revision = greatest(coalesce(new.revision, 1), 1);
  else
    new.updated_at = now();
    new.revision = old.revision + 1;
  end if;
  return new;
end;
$$;

create trigger novapulse_announcements_timestamps
before insert or update on public.novapulse_announcements
for each row execute function public.novapulse_announcements_set_timestamps();

alter table public.novapulse_announcements enable row level security;
revoke all on table public.novapulse_announcements from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'novapulse-announcement-artwork',
  'novapulse-announcement-artwork',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
