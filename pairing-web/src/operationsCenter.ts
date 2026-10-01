// Pure derivation logic for the Operations Center dashboard.
// Every value here comes from data already loaded by AdminCloud (devices,
// providers, invitations, the admin-dashboard payload, and the lightweight
// Gold summary). Nothing is invented: if a real signal is missing the
// derivation returns null/neutral so the UI can omit it.
import { displayHealthLabel, healthTone } from './providerHealthDisplay.ts';

export type Row = Record<string, unknown>;
export type StatusTone = 'healthy' | 'warning' | 'critical' | 'neutral';

const ONLINE_WINDOW_MS = 30 * 60 * 1000;
const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Ops thresholds for reseller credit capacity. These describe presentation
// tone only; the underlying credit count is always the real reseller value.
export const GOLD_CREDITS_LOW = 5;

function num(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTime(value: unknown): number | null {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? time : null;
}

/**
 * admin-dashboard returns `{ serverTime, dashboard: {...} }`. Older callers
 * passed the outer object by mistake, so accept either shape.
 */
export function readDashboardCore(data: Row | null | undefined): Row {
  if (!data || typeof data !== 'object') return {};
  const inner = (data as Row).dashboard;
  if (inner && typeof inner === 'object') return inner as Row;
  return data as Row;
}

export type GoldSummary = {
  credits: number | null;
  resellerEnabled: boolean | null;
  total: number;
  active: number;
  disabled: number;
  expired: number;
  expiringSoon: number;
  routeAlerts: number;
  routeAlertsReliable: boolean;
  unassignedProvider: number;
  unassignedDevice: number;
};

export function deriveGoldSummary(
  accounts: Row[],
  reseller: Row | null,
  now: number = Date.now(),
): GoldSummary {
  let active = 0;
  let disabled = 0;
  let expired = 0;
  let expiringSoon = 0;
  let routeAlerts = 0;
  let unassignedProvider = 0;
  let unassignedDevice = 0;

  for (const account of accounts) {
    const enabled = account.gold_enabled !== false;
    const expiresAt = parseTime(account.gold_expiration);
    if (!enabled) {
      disabled += 1;
    } else if (expiresAt !== null && expiresAt < now) {
      expired += 1;
    } else {
      active += 1;
      if (expiresAt !== null && expiresAt <= now + EXPIRING_WINDOW_MS) {
        expiringSoon += 1;
      }
    }
    const route = account.route_health as { reachable?: boolean } | undefined;
    if (route?.reachable === false) routeAlerts += 1;
    if (!account.managed_provider_id || account.provider == null) unassignedProvider += 1;
    if (account.assignedDevice == null) unassignedDevice += 1;
  }

  return {
    credits: num(reseller?.credits),
    resellerEnabled: reseller ? reseller.enabled !== false : null,
    total: accounts.length,
    active,
    disabled,
    expired,
    expiringSoon,
    routeAlerts,
    // The list endpoint does not include per-account route health, so a zero
    // here means "not measured", not "all healthy".
    routeAlertsReliable: accounts.some((account) => 'route_health' in account),
    unassignedProvider,
    unassignedDevice,
  };
}

export function goldCreditsTone(credits: number | null): StatusTone {
  if (credits === null) return 'neutral';
  if (credits <= 0) return 'critical';
  if (credits <= GOLD_CREDITS_LOW) return 'warning';
  return 'healthy';
}

export type ProviderHealthSummary = {
  total: number;
  healthy: number;
  needsAttention: number;
  draft: number;
  goldManaged: number;
  unhealthy: { id: string; name: string; label: string; tone: string; goldManaged: boolean }[];
};

function providerLabel(provider: Row) {
  return displayHealthLabel({
    activationStatus: String(provider.status ?? 'draft'),
    healthStatus: String(provider.health_status ?? 'unvalidated'),
    validationStale: Boolean(provider.validation_stale),
  });
}

export function deriveProviderHealthSummary(providers: Row[]): ProviderHealthSummary {
  let healthy = 0;
  let needsAttention = 0;
  let draft = 0;
  let goldManaged = 0;
  const unhealthy: ProviderHealthSummary['unhealthy'] = [];

  for (const provider of providers) {
    const label = providerLabel(provider);
    const tone = healthTone(label);
    const isGold = provider.goldAccount != null;
    if (isGold) goldManaged += 1;
    if (label === 'HEALTHY') healthy += 1;
    if (label === 'DRAFT') draft += 1;
    if (tone === 'warn' || tone === 'fail') {
      needsAttention += 1;
      unhealthy.push({
        id: String(provider.id ?? ''),
        name: String(provider.display_name ?? provider.slug ?? 'Managed provider'),
        label,
        tone,
        goldManaged: isGold,
      });
    }
  }

  // Failures first, then degraded/stale/testing.
  unhealthy.sort((a, b) => (a.tone === 'fail' ? 0 : 1) - (b.tone === 'fail' ? 0 : 1));

  return { total: providers.length, healthy, needsAttention, draft, goldManaged, unhealthy };
}

export type VersionDistributionRow = { version: string; build: string | null; count: number; percentage: number };
export type FleetSummary = {
  totalDevices: number;
  onlineDevices: number;
  staleDevices: number;
  activeProviders: number;
  providerHealth: Record<string, number>;
  playbackIssues: number;
  diagnosticIssues: number;
  versions: VersionDistributionRow[];
  mostObserved: VersionDistributionRow | null;
};

function normalizedStatus(value: unknown): string {
  return String(value ?? 'unknown').trim().toLowerCase().replace(/[- ]+/g, '_');
}

export function isDeviceOnline(device: Row, now: number = Date.now()): boolean {
  const lastSeen = parseTime(device.last_seen_at);
  return lastSeen !== null && lastSeen >= now - ONLINE_WINDOW_MS;
}

function hasPlaybackIssue(device: Row): boolean {
  const candidates = [device.recentPlayback, device.recentError, device.last_diagnostics];
  return candidates.some((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Row;
    return Boolean(row.error || row.errorCode || row.reason || row.event === 'playback_error' || row.status === 'failed');
  });
}

function hasDiagnosticIssue(device: Row): boolean {
  const value = device.last_diagnostics;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Row;
  return String(row.level ?? row.status ?? '').toLowerCase() === 'error' || Boolean(row.error || row.errorCode);
}

export function deriveVersionDistribution(devices: Row[]): VersionDistributionRow[] {
  const counts = new Map<string, { version: string; build: string | null; count: number }>();
  for (const device of devices) {
    const version = String(device.app_version ?? '').trim();
    if (!version) continue;
    const build = device.app_build == null || String(device.app_build).trim() === '' ? null : String(device.app_build);
    const key = `${version}\u0000${build ?? ''}`;
    const current = counts.get(key) ?? { version, build, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  const total = [...counts.values()].reduce((sum, row) => sum + row.count, 0);
  return [...counts.values()]
    .map((row) => ({ ...row, percentage: total ? Math.round((row.count / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.count - a.count || a.version.localeCompare(b.version));
}

export function deriveFleetSummary(devices: Row[], providers: Row[], now: number | undefined = Date.now(), aggregate?: Row): FleetSummary {
  const versions = deriveVersionDistribution(devices);
  const providerHealth: Record<string, number> = {};
  for (const provider of providers) {
    const health = normalizedStatus(provider.health_status);
    providerHealth[health] = (providerHealth[health] ?? 0) + 1;
  }
  const serverVersions = Array.isArray(aggregate?.versionDistribution) ? aggregate.versionDistribution as VersionDistributionRow[] : null;
  const serverHealth = aggregate?.providerHealthCounts && typeof aggregate.providerHealthCounts === 'object' ? aggregate.providerHealthCounts as Record<string, number> : null;
  return {
    totalDevices: Number(aggregate?.totalDevices ?? devices.length),
    onlineDevices: Number(aggregate?.onlineDevices ?? devices.filter((device) => isDeviceOnline(device, now)).length),
    staleDevices: Number(aggregate?.staleDevices ?? devices.filter((device) => !isDeviceOnline(device, now)).length),
    activeProviders: Number(aggregate?.activeProviders ?? providers.filter((provider) => normalizedStatus(provider.status) === 'active').length),
    providerHealth: serverHealth ?? providerHealth,
    playbackIssues: Number(aggregate?.playbackFailureCount ?? devices.filter(hasPlaybackIssue).length),
    diagnosticIssues: Number(aggregate?.diagnosticIssueCount ?? devices.filter(hasDiagnosticIssue).length),
    versions: serverVersions ?? versions,
    mostObserved: (serverVersions ?? versions)[0] ?? null,
  };
}

export type AttentionRow = { id: string; label: string; detail: string; tone: 'warning' | 'problem'; deviceKey?: string; providerId?: string };

export function deriveNeedsAttention(devices: Row[], providers: Row[], now: number = Date.now()): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const device of devices) {
    const deviceKey = String(device.public_device_code ?? device.id ?? '');
    if (!isDeviceOnline(device, now)) rows.push({ id: `stale-${deviceKey}`, label: 'Device stale', detail: deviceKey || 'Device code unavailable', tone: 'warning', deviceKey });
    if (hasPlaybackIssue(device)) rows.push({ id: `playback-${deviceKey}`, label: 'Recent playback failure', detail: deviceKey || 'Device code unavailable', tone: 'problem', deviceKey });
    if (hasDiagnosticIssue(device)) rows.push({ id: `diagnostic-${deviceKey}`, label: 'Diagnostic error', detail: deviceKey || 'Device code unavailable', tone: 'problem', deviceKey });
  }
  for (const provider of providers) {
    const health = normalizedStatus(provider.health_status);
    if (!['healthy', 'active', 'unknown', 'unvalidated', 'draft'].includes(health)) {
      rows.push({ id: `provider-${String(provider.id ?? '')}`, label: health === 'authentication_required' ? 'Authentication required' : health === 'subscription_expired' ? 'Subscription expired' : health === 'unavailable' ? 'Provider unavailable' : 'Provider degraded', detail: String(provider.display_name ?? provider.slug ?? 'Managed provider'), tone: health === 'unavailable' || health === 'subscription_expired' ? 'problem' : 'warning', providerId: String(provider.id ?? '') });
    }
  }
  return rows.slice(0, 12);
}

export type PlaybackIssueRow = { id: string; deviceKey: string; provider: string; contentType: string; route: string; reason: string; timestamp: string | null; recovery: string };

export function derivePlaybackIssues(devices: Row[], providers: Row[]): { available: boolean; rows: PlaybackIssueRow[] } {
  const providerNames = new Map(providers.map((provider) => [String(provider.id), String(provider.display_name ?? provider.slug ?? 'Provider unavailable')]));
  const rows: PlaybackIssueRow[] = [];
  for (const device of devices) {
    const values = [device.recentError, device.recentPlayback, device.last_diagnostics];
    const value = values.find((item) => item && typeof item === 'object' && !Array.isArray(item)) as Row | undefined;
    if (!value || !(value.error || value.errorCode || value.reason || value.event === 'playback_error' || value.status === 'failed')) continue;
    rows.push({
      id: `${String(device.id ?? device.public_device_code ?? '')}-${String(value.timestamp ?? value.createdAt ?? device.last_seen_at ?? '')}`,
      deviceKey: String(device.public_device_code ?? device.id ?? 'Unavailable'),
      provider: providerNames.get(String(device.managed_provider_id ?? '')) ?? 'Unassigned',
      contentType: String(value.contentType ?? value.mediaType ?? 'Not reported'),
      route: String(value.route ?? device.current_route ?? 'Not reported'),
      reason: String(value.error ?? value.errorCode ?? value.reason ?? 'Playback failure'),
      timestamp: typeof value.timestamp === 'string' ? value.timestamp : typeof value.createdAt === 'string' ? value.createdAt : null,
      recovery: String(value.recovery ?? value.watchdog ?? 'Not reported'),
    });
  }
  return { available: devices.some((device) => device.recentError !== undefined || device.recentPlayback !== undefined || device.last_diagnostics !== undefined), rows };
}

export function filterAdminDevices(devices: Row[], filters: { query?: string; status?: string; platform?: string; activation?: string; version?: string; providerId?: string; providerHealth?: string }, providers: Row[], now: number = Date.now()): Row[] {
  const needle = String(filters.query ?? '').trim().toLowerCase();
  const providerById = new Map(providers.map((provider) => [String(provider.id), provider]));
  return devices.filter((device) => {
    const provider = providerById.get(String(device.managed_provider_id ?? ''));
    const health = normalizedStatus(provider?.health_status);
    const haystack = [device.public_device_code, device.friendly_name, device.model, device.platform, device.assigned_tester_name].map(String).join(' ').toLowerCase();
    const status = String(filters.status ?? 'all');
    const statusMatches = status === 'all' || (status === 'online' && isDeviceOnline(device, now)) || (status === 'offline' && !isDeviceOnline(device, now)) || normalizedStatus(device.status) === status;
    return (!needle || haystack.includes(needle)) && statusMatches && (filters.platform === undefined || filters.platform === 'all' || String(device.platform ?? '') === filters.platform) && (filters.activation === undefined || filters.activation === 'all' || normalizedStatus(device.activation_status) === filters.activation) && (filters.version === undefined || filters.version === 'all' || String(device.app_version ?? '') === filters.version) && (filters.providerId === undefined || filters.providerId === 'all' || String(device.managed_provider_id ?? '') === filters.providerId) && (filters.providerHealth === undefined || filters.providerHealth === 'all' || health === filters.providerHealth);
  });
}

export type DeviceSupportRow = {
  id: string;
  code: string;
  name: string;
  model: string | null;
  online: boolean;
  lastSeen: string | null;
  activationStatus: string;
  assignedProviderId: string | null;
  assignmentState: string | null;
  appVersion: string | null;
  appBuild: string | null;
  tester: string | null;
};

export function deriveDeviceSupportRows(
  devices: Row[],
  now: number = Date.now(),
  limit = 6,
): DeviceSupportRow[] {
  const rows = devices.map((device) => {
    const lastSeen = parseTime(device.last_seen_at);
    return {
      id: String(device.id ?? ''),
      code: String(device.public_device_code ?? 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â'),
      name: String(device.friendly_name ?? device.assigned_tester_name ?? device.model ?? 'NovaCast device'),
      model: (device.model as string) ?? null,
      online: lastSeen !== null && lastSeen >= now - ONLINE_WINDOW_MS,
      lastSeen: (device.last_seen_at as string) ?? null,
      activationStatus: String(device.activation_status ?? 'inactive'),
      assignedProviderId: (device.managed_provider_id as string) ?? null,
      assignmentState: (device.assignment_command_status as string) ?? null,
      appVersion: (device.app_version as string) ?? null,
      appBuild: (device.app_build as string) ?? null,
      tester: (device.assigned_tester_name as string) ?? null,
    };
  });
  // Surface offline / unassigned devices first.
  rows.sort((a, b) => {
    const aRisk = (a.online ? 0 : 2) + (a.assignedProviderId ? 0 : 1);
    const bRisk = (b.online ? 0 : 2) + (b.assignedProviderId ? 0 : 1);
    if (aRisk !== bRisk) return bRisk - aRisk;
    return (parseTime(b.lastSeen) ?? 0) - (parseTime(a.lastSeen) ?? 0);
  });
  return rows.slice(0, limit);
}

export type ReadinessSignal = { id: string; label: string; state: string; tone: StatusTone; detail?: string };

export function deriveReleaseReadiness(input: {
  core: Row;
  providerHealth: ProviderHealthSummary;
  gold: GoldSummary;
  deviceCount: number;
}): ReadinessSignal[] {
  const { core, providerHealth, gold, deviceCount } = input;
  const online = num(core.devicesOnline) ?? 0;
  const activeProviders = num(core.providers) ?? 0;
  const recentErrors = Array.isArray(core.recentErrors) ? core.recentErrors.length : 0;
  const pendingActivations = num(core.pendingActivations) ?? 0;
  const creditsTone = goldCreditsTone(gold.credits);

  const signals: ReadinessSignal[] = [];

  signals.push(
    deviceCount === 0
      ? { id: 'devices', label: 'Device service', state: 'No devices', tone: 'neutral' }
      : online > 0
        ? { id: 'devices', label: 'Device service', state: 'Healthy', tone: 'healthy', detail: `${online} online` }
        : { id: 'devices', label: 'Device service', state: 'Attention', tone: 'warning', detail: 'None online' },
  );

  signals.push(
    providerHealth.needsAttention > 0 || activeProviders === 0
      ? {
          id: 'providers',
          label: 'Provider service',
          state: 'Attention',
          tone: providerHealth.unhealthy.some((p) => p.tone === 'fail') ? 'critical' : 'warning',
          detail: `${activeProviders} active`,
        }
      : { id: 'providers', label: 'Provider service', state: 'Healthy', tone: 'healthy', detail: `${activeProviders} active` },
  );

  signals.push({
    id: 'gold',
    label: 'Gold capacity',
    state: gold.credits === null ? 'Unavailable' : creditsTone === 'healthy' ? 'Healthy' : creditsTone === 'warning' ? 'Low' : 'Empty',
    tone: creditsTone,
    detail: gold.credits === null ? undefined : `${gold.credits} credits`,
  });

  signals.push(
    recentErrors > 0
      ? { id: 'diagnostics', label: 'Diagnostics', state: 'Alerts', tone: 'warning', detail: `${recentErrors} recent` }
      : { id: 'diagnostics', label: 'Diagnostics', state: 'Clear', tone: 'healthy' },
  );

  signals.push({
    id: 'pending',
    label: 'Pending activations',
    state: String(pendingActivations),
    tone: pendingActivations > 0 ? 'neutral' : 'healthy',
  });

  signals.push({
    id: 'drafts',
    label: 'Provider drafts',
    state: String(providerHealth.draft),
    tone: providerHealth.draft > 0 ? 'neutral' : 'healthy',
  });

  return signals;
}

export type OpsMetric = { id: string; label: string; value: string | number; detail: string; tone: StatusTone };

export function deriveOpsSummary(input: {
  core: Row;
  providerHealth: ProviderHealthSummary;
  gold: GoldSummary;
  deviceCount: number;
}): OpsMetric[] {
  const { core, providerHealth, gold, deviceCount } = input;
  const online = num(core.devicesOnline) ?? 0;
  const offline = num(core.devicesOffline);
  const registered = offline === null ? null : online + offline;
  const failedProviders = providerHealth.unhealthy.filter((p) => p.tone === 'fail').length;
  const criticalAlerts = failedProviders + gold.expired;

  const metrics: OpsMetric[] = [
    {
      id: 'devicesOnline',
      label: 'Devices online',
      value: online,
      detail: deviceCount ? `of ${deviceCount} registered` : 'No devices yet',
      tone: deviceCount === 0 ? 'neutral' : online > 0 ? 'healthy' : 'warning',
    },
    {
      id: 'registeredDevices',
      label: 'Registered devices',
      value: registered ?? '—',
      detail: registered === null ? 'Not reported' : `${online} online · ${offline} offline`,
      tone: registered === null ? 'neutral' : registered > 0 ? 'healthy' : 'warning',
    },
    {
      id: 'healthyProviders',
      label: 'Healthy providers',
      value: providerHealth.healthy,
      detail: providerHealth.needsAttention ? `${providerHealth.needsAttention} need attention` : 'All clear',
      tone: providerHealth.needsAttention ? 'warning' : providerHealth.healthy ? 'healthy' : 'neutral',
    },
    {
      id: 'goldCredits',
      label: 'Gold credits',
      value: gold.credits === null ? '\u2014' : gold.credits,
      detail: gold.credits === null ? 'Not reported' : gold.resellerEnabled === false ? 'Reseller disabled' : 'Reseller balance',
      tone: goldCreditsTone(gold.credits),
    },
    {
      id: 'goldAccounts',
      label: 'Gold accounts',
      value: gold.total,
      detail: gold.expiringSoon ? `${gold.expiringSoon} expiring soon` : `${gold.active} active`,
      tone: gold.expiringSoon ? 'warning' : 'neutral',
    },
    {
      id: 'alerts',
      label: 'Critical alerts',
      value: criticalAlerts,
      detail: criticalAlerts
        ? failedProviders + ' provider failure' + (failedProviders === 1 ? '' : 's') + ' \u00B7 ' + gold.expired + ' expired Gold'
        : 'Nothing critical',
      tone: criticalAlerts ? 'critical' : 'healthy',
    },
  ];

  return metrics;
}

