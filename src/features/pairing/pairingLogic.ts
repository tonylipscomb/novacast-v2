export const PAIRING_CODE_LENGTH = 8;

export function normalizePairingCode(value: unknown) {
  return typeof value === 'string' ? value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, PAIRING_CODE_LENGTH) : '';
}

export function isPairingSessionActive(expiresAt: number, now = Date.now()) {
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function getPairingSecondsRemaining(expiresAt: number, now = Date.now()) {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function canRedeemPairingResult(status: 'waiting' | 'completed' | 'expired', hasRedemptionToken: boolean) {
  return status === 'completed' && hasRedemptionToken;
}
