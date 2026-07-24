/**
 * Tiny foreground gate with no React Native imports — safe for Node smoke tests.
 */

let foregroundActive = true;

export function setAppForegroundActive(active: boolean) {
  foregroundActive = active;
}

export function isAppForegroundActive() {
  return foregroundActive;
}

export function resetAppForegroundGateForTests() {
  foregroundActive = true;
}
