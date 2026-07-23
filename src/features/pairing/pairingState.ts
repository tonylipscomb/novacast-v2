export function isDevelopmentBuild() {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

// Pairing is server-authorized in every build. The old local mock is intentionally disabled.
export const MOCK_PAIRING_ENABLED = false;
export const BYPASS_PAIRING_IN_DEV = false;

let pairingCompleted = false;

export function isPairingCompleted() {
  return pairingCompleted;
}

export function markPairingCompleted() {
  pairingCompleted = true;
}

export function resetPairingCompleted() {
  pairingCompleted = false;
}
