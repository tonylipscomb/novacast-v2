function envFlag(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === undefined || value === '' ? fallback : value === 'true' || value === '1';
}

const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;

export const analyticsConfig = {
  enabled: envFlag('EXPO_PUBLIC_BETA_ANALYTICS_ENABLED', !isDevelopment),
  endpoint: process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '') ?? null,
  batchSize: 25,
  maxQueueItems: 200,
  maxQueueBytes: 256 * 1024,
  maxAttempts: 6,
  baseRetryDelayMs: 5_000,
  maxRetryDelayMs: 15 * 60_000,
};

