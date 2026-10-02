const startupAt = Date.now();

export function logProviderStartupPhase(
  phase: string,
  fields: {
    providerPresent?: boolean;
    cachedProviderUsable?: boolean;
    providerInitInFlight?: boolean;
    deadlineExceeded?: boolean;
    managedRefreshInFlight?: boolean;
    retryBackoffActive?: boolean;
  } = {},
) {
  console.info('[NOVACAST_STARTUP] provider-access', {
    phase,
    elapsedMs: Math.max(0, Date.now() - startupAt),
    ...fields,
  });
}
