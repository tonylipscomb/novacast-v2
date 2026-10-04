type PortalProviderFocusDetails = {
  providerState?: string;
  launchable?: boolean;
  nativeHandlePresent?: boolean;
  neighborHandlePresent?: boolean;
  elapsedMs?: number;
  reason?: string;
};

const SAFE_VALUE = /^[a-z0-9:_-]{1,80}$/i;

function safeValue(value: string | undefined) {
  return value && SAFE_VALUE.test(value) ? value : undefined;
}

export function logPortalProviderFocus(event: string, details: PortalProviderFocusDetails = {}) {
  const safeEvent = safeValue(event) ?? 'unknown';
  const providerState = safeValue(details.providerState);
  const reason = safeValue(details.reason);
  const elapsedMs = Number.isFinite(details.elapsedMs) ? Math.max(0, Math.round(details.elapsedMs ?? 0)) : undefined;

  console.info('[NOVACAST_PORTAL_PROVIDER_FOCUS]', {
    event: safeEvent,
    ...(providerState ? { providerState } : {}),
    ...(details.launchable !== undefined ? { launchable: details.launchable } : {}),
    ...(details.nativeHandlePresent !== undefined ? { nativeHandlePresent: details.nativeHandlePresent } : {}),
    ...(details.neighborHandlePresent !== undefined ? { neighborHandlePresent: details.neighborHandlePresent } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    ...(reason ? { reason } : {}),
  });
}
