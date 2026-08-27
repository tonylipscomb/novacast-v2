import * as Application from 'expo-application';
import * as Network from 'expo-network';

export type RuntimeNetworkDiagnostics = {
  networkConnected: boolean | null;
  connectionType: 'wifi' | 'ethernet' | 'cellular' | 'unknown';
  internetReachable: boolean | null;
  latencyMs: number | null;
};

const REFRESH_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 4_000;

let lastRefreshAt = 0;
let refreshPromise: Promise<void> | null = null;

let cachedNetwork: RuntimeNetworkDiagnostics = {
  networkConnected: null,
  connectionType: 'unknown',
  internetReachable: null,
  latencyMs: null,
};

function normalizeConnectionType(
  value: unknown,
): RuntimeNetworkDiagnostics['connectionType'] {
  const normalized = String(value ?? '').toLowerCase();

  if (normalized.includes('wifi')) return 'wifi';
  if (normalized.includes('ethernet')) return 'ethernet';
  if (normalized.includes('cellular')) return 'cellular';

  return 'unknown';
}

async function measureBackendLatency(): Promise<number | null> {
  const baseUrl =
    process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL
      ?.trim()
      .replace(/\/+$/, '');

  if (!baseUrl) {
    return null;
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    PROBE_TIMEOUT_MS,
  );

  const startedAt = Date.now();

  try {
    /*
     * Use NovaCast's own backend as the reachability target.
     *
     * OPTIONS keeps the probe tiny and does not download content.
     * Any HTTP response proves that the host answered.
     */
    await fetch(`${baseUrl}/device-heartbeat`, {
      method: 'OPTIONS',
      signal: controller.signal,
    });

    return Math.max(0, Date.now() - startedAt);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshRuntimeNetworkDiagnostics(): Promise<void> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const state = await Network.getNetworkStateAsync();

      const networkConnected =
        typeof state.isConnected === 'boolean'
          ? state.isConnected
          : null;

      const latencyMs =
        networkConnected === false
          ? null
          : await measureBackendLatency();

      const nativeReachability =
        typeof state.isInternetReachable === 'boolean'
          ? state.isInternetReachable
          : null;

      /*
       * A successful NovaCast backend probe is also direct evidence
       * of internet reachability.
       */
      const internetReachable =
        networkConnected === false
          ? false
          : latencyMs !== null
            ? true
            : nativeReachability;

      cachedNetwork = {
        networkConnected,
        connectionType: normalizeConnectionType(state.type),
        internetReachable,
        latencyMs,
      };

      lastRefreshAt = Date.now();
    } catch {
      lastRefreshAt = Date.now();
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export function getCachedNetworkDiagnostics(): RuntimeNetworkDiagnostics {
  /*
   * Refresh asynchronously when stale. We deliberately do not block
   * playback/diagnostics while probing the network.
   */
  if (Date.now() - lastRefreshAt >= REFRESH_INTERVAL_MS) {
    void refreshRuntimeNetworkDiagnostics();
  }

  return cachedNetwork;
}

export function getNativeBuildVersion(): string | null {
  const value = Application.nativeBuildVersion;

  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null;
}

/*
 * Warm network information immediately when diagnostics load.
 */
void refreshRuntimeNetworkDiagnostics();
