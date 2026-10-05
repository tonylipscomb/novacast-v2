begin;

create table if not exists public.novacast_releases (
  id uuid primary key default gen_random_uuid(),
  version_name text not null,
  version_code integer not null check (version_code > 0),
  channel text not null check (channel in ('production', 'beta', 'dev', 'retired', 'other')),
  status text not null check (status in ('draft', 'candidate', 'active', 'retired')),
  package_name text not null,
  git_commit text,
  git_tag text,
  artifact_name text,
  artifact_url text,
  sha256 text,
  signing_cert_sha256 text,
  release_notes text,
  minimum_supported_version_code integer check (minimum_supported_version_code is null or minimum_supported_version_code > 0),
  created_at timestamptz not null default now(),
  promoted_at timestamptz,
  retired_at timestamptz,
  unique (package_name, version_name, version_code)
);

create unique index if not exists novacast_releases_one_active_production_idx
  on public.novacast_releases (package_name)
  where channel = 'production' and status = 'active';
create index if not exists novacast_releases_catalog_order_idx
  on public.novacast_releases (channel, status, version_code desc, created_at desc);

alter table public.novacast_releases enable row level security;
revoke all on public.novacast_releases from anon, authenticated;
grant all on public.novacast_releases to service_role;

insert into public.novacast_releases (
  version_name, version_code, channel, status, package_name, git_commit, git_tag,
  artifact_name, artifact_url, sha256, signing_cert_sha256, release_notes, promoted_at
)
values (
  '1.0.5', 25, 'production', 'active', 'com.novacast.novacastv2',
  '68921d90f725ec9555ac508255b0f092115ccaae', 'v1.0.5',
  'NovaCast-1.0.5.apk',
  'https://github.com/tonylipscomb/novacast-v2/releases/download/v1.0.5/NovaCast-1.0.5.apk',
  '59B868064A9AB7984974FE5CB4EC636334B42C82E91850FD452A4F9DF95A3E5F',
  'f0b4a1e55098c63a274d76e9c26ef00e239320de4666dd0d6a2fa43df557e595',
  'First public production release of NovaCast for Android TV.', now()
)
on conflict (package_name, version_name, version_code) do nothing;

commit;
