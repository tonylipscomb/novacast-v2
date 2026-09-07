alter table public.device_health
  add column if not exists network_connected boolean,
  add column if not exists connection_type text,
  add column if not exists internet_reachable boolean,
  add column if not exists network_latency_ms bigint;

comment on column public.device_health.network_connected is 'Safe connectivity state; no SSID, BSSID, IP, or location.';
comment on column public.device_health.connection_type is 'Coarse connection type only: wifi, ethernet, cellular, or unknown.';
comment on column public.device_health.internet_reachable is 'Whether NovaCast observed a successful diagnostics request.';
comment on column public.device_health.network_latency_ms is 'NovaCast-observed request latency in milliseconds.';
