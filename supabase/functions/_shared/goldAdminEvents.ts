type Client = { from: (table: string) => any };

export const GOLD_EVENT_ACTIONS = new Set([
  'account_imported', 'account_created', 'account_synced', 'account_renewed',
  'account_enabled', 'account_disabled', 'diagnostics_run', 'recovery_completed',
  'credentials_accessed', 'provider_assigned',
]);
const SAFE_METADATA_KEYS = new Set(['subscriptionMonths', 'source', 'healthStatus', 'deviceId', 'providerName']);

export function sanitizeGoldEventMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue;
    if ((typeof raw === 'string' && raw.length <= 120 && !/https?:\/\/|password|token|secret|credential/i.test(raw)) || typeof raw === 'boolean' || (typeof raw === 'number' && Number.isFinite(raw))) result[key] = raw as string | number | boolean;
  }
  return result;
}

export function sanitizeGoldEventIdentifier(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) return null;
  return /https?:\/\/|password|token|secret|credential|[?&](?:user|pass|username)=/i.test(value) ? null : value.trim();
}

export function sanitizeGoldActivityEvent(row: Record<string, unknown>) {
  return {
    id: row.id,
    action: row.action,
    status: row.status,
    accountId: row.accountId,
    providerId: row.providerId,
    goldUserId: sanitizeGoldEventIdentifier(row.goldUserId),
    providerName: typeof row.providerName === 'string' ? row.providerName : null,
    createdAt: row.createdAt,
    metadata: sanitizeGoldEventMetadata(row.metadata),
  };
}

export function isMissingGoldActivityTableError(error: unknown) {
  const value = error as { code?: string } | null;
  return value?.code === '42P01' || value?.code === 'PGRST205';
}

export class GoldActivityTableMissingError extends Error {
  constructor() { super('gold_activity_table_missing'); }
}

export async function listGoldAdminActivity(client: Client) {
  const { data, error } = await client.from('gold_admin_events').select('id,created_at,action,status,gold_account_id,managed_provider_id,gold_user_id,metadata').order('created_at', { ascending: false }).limit(50);
  if (error) {
    if (isMissingGoldActivityTableError(error)) throw new GoldActivityTableMissingError();
    throw error;
  }
  const providerIds = (data ?? []).map((row: Record<string, unknown>) => row.managed_provider_id).filter(Boolean);
  const providers = providerIds.length ? await client.from('managed_providers').select('id,display_name').in('id', providerIds) : { data: [], error: null };
  if (providers.error) throw providers.error;
  const providerNames = new Map((providers.data ?? []).map((row: Record<string, string>) => [row.id, row.display_name]));
  return (data ?? []).map((row: Record<string, unknown>) => sanitizeGoldActivityEvent({
    id: row.id, action: row.action, status: row.status, accountId: row.gold_account_id,
    providerId: row.managed_provider_id, goldUserId: row.gold_user_id,
    providerName: row.managed_provider_id ? providerNames.get(String(row.managed_provider_id)) ?? null : null,
    createdAt: row.created_at, metadata: row.metadata,
  }));
}

export async function recordGoldAdminEvent(client: Client, input: { action: string; status?: 'success' | 'failure'; goldAccountId?: string | null; managedProviderId?: string | null; goldUserId?: string | null; actorUserId?: string | null; metadata?: unknown }) {
  if (!GOLD_EVENT_ACTIONS.has(input.action)) return;
  try {
    await client.from('gold_admin_events').insert({
      action: input.action, status: input.status ?? 'success', gold_account_id: input.goldAccountId ?? null,
      managed_provider_id: input.managedProviderId ?? null, gold_user_id: sanitizeGoldEventIdentifier(input.goldUserId),
      actor_user_id: input.actorUserId ?? null, metadata: sanitizeGoldEventMetadata(input.metadata),
    });
  } catch { /* Audit logging is intentionally best effort. */ }
}
