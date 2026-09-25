export const NOVA_PULSE_SPORTS_REFRESH_LEASE_TTL_MS = 10 * 60 * 1000;
export const NOVA_PULSE_SPORTS_REFRESH_COOLDOWN_MS = 2 * 60 * 1000;

type RpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

type LeaseRpcResult = {
  status?: unknown;
  owner_token?: unknown;
  expires_at?: unknown;
  retry_after_seconds?: unknown;
};

export type SportsRefreshLease = {
  status: 'acquired' | 'refresh_in_progress' | 'refresh_cooldown';
  ownerToken: string | null;
  retryAfterSeconds: number | null;
  expiresAt: string | null;
};

function boundedRetry(value: unknown, maximum: number) {
  const seconds = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, Math.min(maximum, seconds));
}

export async function acquireSportsRefreshLease(client: RpcClient): Promise<SportsRefreshLease> {
  const { data, error } = await client.rpc('try_acquire_novapulse_sports_refresh_lease');
  if (error || !data || typeof data !== 'object') throw new Error('sports_lease_unavailable');
  const result = data as LeaseRpcResult;
  const status = result.status;
  if (status === 'acquired') {
    if (typeof result.owner_token !== 'string' || !result.owner_token) throw new Error('sports_lease_unavailable');
    return {
      status,
      ownerToken: result.owner_token,
      retryAfterSeconds: null,
      expiresAt: typeof result.expires_at === 'string' ? result.expires_at : null,
    };
  }
  if (status === 'refresh_in_progress') {
    return { status, ownerToken: null, expiresAt: null, retryAfterSeconds: boundedRetry(result.retry_after_seconds, 600) };
  }
  if (status === 'refresh_cooldown') {
    return { status, ownerToken: null, expiresAt: null, retryAfterSeconds: boundedRetry(result.retry_after_seconds, 120) };
  }
  throw new Error('sports_lease_unavailable');
}

export async function releaseSportsRefreshLease(client: RpcClient, lease: SportsRefreshLease) {
  if (lease.status !== 'acquired' || !lease.ownerToken) return;
  const { data, error } = await client.rpc('release_novapulse_sports_refresh_lease', {
    p_owner_token: lease.ownerToken,
  });
  if (error || data !== true) throw new Error('sports_lease_release_failed');
}
