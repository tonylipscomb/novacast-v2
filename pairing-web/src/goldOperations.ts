export const EXPIRATION_BUCKETS = ['expired', 'today', 'tomorrow', 'next7', 'next30', 'later', 'unknown'] as const;
export type ExpirationBucket = typeof EXPIRATION_BUCKETS[number];

export const EXPIRATION_BUCKET_LABELS: Record<ExpirationBucket, string> = {
  expired: 'Expired', today: 'Today', tomorrow: 'Tomorrow', next7: 'Next 7 days',
  next30: 'Next 30 days', later: 'Later', unknown: 'Unknown expiration',
};

export const GOLD_CAPABILITIES = {
  listAccounts: 'supported',
  resellerSummary: 'supported',
  packages: 'supported',
  createAccount: 'supported',
  importM3uAccount: 'supported',
  syncAccount: 'supported',
  diagnostics: 'supported',
  renewAccount: 'supported',
  setAccountStatus: 'supported',
  routeHealth: 'supported',
  copyCredentials: 'supported',
  editLine: 'unsupported',
  kickOut: 'unsupported',
  ispLock: 'unsupported',
  vpnSwitch: 'unsupported',
  moveReseller: 'unsupported',
  packageUpdate: 'unsupported',
  smartTvUpload: 'unsupported',
  androidAppUpload: 'unsupported',
  refund: 'unsupported',
} as const;

export type GoldLine = {
  id: string;
  providerId: string;
  username: string;
  displayName: string;
  packageName: string;
  reseller: string;
  country: string;
  expiration: string | null;
  enabled: boolean | null;
  providerStatus: string;
  healthStatus: string;
  assignedDevice: string;
  assignmentStatus: 'ACTIVE' | 'SUPERSEDED' | 'INACTIVE' | 'UNASSIGNED';
  assignedAt: string | null;
  createdAt: string | null;
  upstreamUrl: string;
  routeMode: string;
  routeDomain: string;
  lastSyncedAt: string | null;
  lastSyncError: string;
};

export function resolveGoldAssignmentStatus(value: unknown): GoldLine['assignmentStatus'] {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'active') return 'ACTIVE';
  if (raw === 'superseded') return 'SUPERSEDED';
  if (raw === 'inactive' || raw === 'revoked' || raw === 'expired') return 'INACTIVE';
  return 'UNASSIGNED';
}

export function formatGoldAssignmentTimestamp(value: string | null): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : '—';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeGoldLine(value: unknown): GoldLine {
  const row = record(value);
  const provider = record(row.provider);
  const device = record(row.assignedDevice);
  const assignment = record(row.assignment);
  const assignmentStatus = resolveGoldAssignmentStatus(assignment.status ?? row.assignment_status ?? device.assignment_status);
  const hasAssignedDevice = Object.keys(device).length > 0;
  const goldUserId = String(row.gold_user_id ?? '').trim();
  const displayName = String(provider.display_name ?? (goldUserId ? `Gold ${goldUserId}` : 'Gold account')).trim();
  return {
    id: String(row.id ?? '').trim(),
    providerId: String(row.managed_provider_id ?? '').trim(),
    username: goldUserId || 'Unavailable',
    displayName,
    packageName: String(row.gold_package_name ?? row.gold_package_id ?? 'Unavailable').trim(),
    reseller: String(row.reseller_name ?? row.reseller ?? 'Unavailable').trim(),
    country: String(row.gold_country ?? 'Unavailable').trim(),
    expiration: typeof row.gold_expiration === 'string' && row.gold_expiration.trim() ? row.gold_expiration : null,
    enabled: typeof row.gold_enabled === 'boolean' ? row.gold_enabled : null,
    providerStatus: String(provider.status ?? 'unknown'),
    healthStatus: String(provider.health_status ?? 'unvalidated'),
    assignedDevice: String(device.public_device_code ?? 'Unassigned'),
    assignmentStatus: assignmentStatus === 'UNASSIGNED' && hasAssignedDevice ? 'ACTIVE' : assignmentStatus,
    assignedAt: typeof (assignment.assigned_at ?? row.assigned_at ?? device.assigned_at) === 'string'
      ? String(assignment.assigned_at ?? row.assigned_at ?? device.assigned_at)
      : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    upstreamUrl: String(row.gold_upstream_url ?? '').trim(),
    routeMode: String(row.route_mode ?? 'default').trim() || 'default',
    routeDomain: String(row.route_domain ?? '').trim(),
    lastSyncedAt: typeof row.last_synced_at === 'string' ? row.last_synced_at : null,
    lastSyncError: String(row.last_sync_error ?? '').trim(),
  };
}

export function filterGoldLines(lines: GoldLine[], query: string, status: 'all' | 'active' | 'expired' = 'all', packageName = '', expiration: ExpirationBucket | null = null) {
  const normalizedQuery = query.trim().toLowerCase();
  return lines.filter((line) => {
    const expirationStatus = classifyGoldExpiration(line.expiration);
    const statusMatches = status === 'all' || (status === 'expired' ? expirationStatus === 'expired' : line.enabled !== false && expirationStatus !== 'expired');
    const queryMatches = !normalizedQuery || [line.username, line.displayName, line.packageName, line.country].some((field) => field.toLowerCase().includes(normalizedQuery));
    const packageMatches = !packageName || line.packageName === packageName;
    const expirationMatches = !expiration || expirationStatus === expiration;
    return statusMatches && queryMatches && packageMatches && expirationMatches;
  });
}

export function sortGoldLines(lines: GoldLine[], sort: 'expiration' | 'created' = 'expiration') {
  return [...lines].sort((left, right) => {
    const leftValue = sort === 'created' ? left.createdAt : left.expiration;
    const rightValue = sort === 'created' ? right.createdAt : right.expiration;
    return String(leftValue ?? '').localeCompare(String(rightValue ?? ''));
  });
}

function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function parseExpiration(value: unknown) {
  const raw = String(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59, 999);
  return new Date(raw);
}

export function classifyGoldExpiration(value: unknown, now = new Date()): ExpirationBucket {
  if (value === null || value === undefined || String(value).trim() === '') return 'unknown';
  const expiration = parseExpiration(value);
  if (Number.isNaN(expiration.getTime())) return 'unknown';
  if (expiration.getTime() < now.getTime()) return 'expired';
  const today = startOfDay(now).getTime();
  const day = startOfDay(expiration).getTime();
  const tomorrow = today + 86400000;
  if (day === today) return 'today';
  if (day === tomorrow) return 'tomorrow';
  if (day <= today + 7 * 86400000) return 'next7';
  if (day <= today + 30 * 86400000) return 'next30';
  return 'later';
}

export function sortGoldAccountsByExpiration<T extends { gold_expiration?: unknown }>(accounts: T[], now = new Date()) {
  return [...accounts].sort((a, b) => {
    const aBucket = classifyGoldExpiration(a.gold_expiration, now);
    const bBucket = classifyGoldExpiration(b.gold_expiration, now);
    const aTime = aBucket === 'unknown' ? Number.POSITIVE_INFINITY : parseExpiration(a.gold_expiration).getTime();
    const bTime = bBucket === 'unknown' ? Number.POSITIVE_INFINITY : parseExpiration(b.gold_expiration).getTime();
    return aTime - bTime;
  });
}
