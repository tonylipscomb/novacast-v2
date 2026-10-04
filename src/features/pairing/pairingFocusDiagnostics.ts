type PairingFocusDetails = {
  controlId?: string;
  pairingState?: string;
  focusHandlePresent?: boolean;
  elapsedMs?: number;
  reason?: string;
};

const SAFE_VALUE = /^[a-z0-9:_-]{1,80}$/i;

function safeValue(value: string | undefined) {
  return value && SAFE_VALUE.test(value) ? value : undefined;
}

/** Release-safe TV focus diagnostics; never accepts pairing or provider payloads. */
export function logPairingFocus(event: string, details: PairingFocusDetails = {}) {
  const safeEvent = safeValue(event) ?? 'unknown';
  const controlId = safeValue(details.controlId);
  const pairingState = safeValue(details.pairingState);
  const reason = safeValue(details.reason);

  console.info('[NOVACAST_PAIRING_FOCUS]', {
    event: safeEvent,
    ...(controlId ? { controlId } : {}),
    ...(pairingState ? { pairingState } : {}),
    ...(details.focusHandlePresent !== undefined ? { focusHandlePresent: details.focusHandlePresent } : {}),
    ...(typeof details.elapsedMs === 'number' && Number.isFinite(details.elapsedMs)
      ? { elapsedMs: Math.max(0, Math.round(details.elapsedMs)) }
      : {}),
    ...(reason ? { reason } : {}),
  });
}
