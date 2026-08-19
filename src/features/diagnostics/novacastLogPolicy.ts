/**
 * Central diagnostic log policy for NovaCast.
 *
 * Production / closed-beta APKs must stay readable in logcat.
 * High-frequency traces (focus, DPAD, seek ticks, catalog timing, search
 * progress) are off unless explicitly enabled.
 *
 * Fatal / error diagnostics should call console.warn/error directly and
 * must not use these helpers.
 *
 * Enable traces with:
 * - Metro / `__DEV__` development builds
 * - `EXPO_PUBLIC_NOVACAST_DEBUG=true`
 * - Node unit tests (no RN `__DEV__`, NODE_ENV not production)
 */

function envEnabled(name: string): boolean {
  const value =
    typeof process !== 'undefined' ? process.env?.[name]?.trim().toLowerCase() : undefined;
  return value === 'true' || value === '1';
}

function isReactNativeDev(): boolean | null {
  if (typeof __DEV__ === 'undefined') {
    return null;
  }
  return Boolean(__DEV__);
}

export function isNovaCastTraceLoggingEnabled(): boolean {
  if (envEnabled('EXPO_PUBLIC_NOVACAST_DEBUG')) {
    return true;
  }
  const rnDev = isReactNativeDev();
  if (rnDev != null) {
    return rnDev;
  }
  return typeof process === 'undefined' || process.env?.NODE_ENV !== 'production';
}

export function isNovaCastCatalogTraceEnabled(): boolean {
  return (
    isNovaCastTraceLoggingEnabled() ||
    envEnabled('EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT') ||
    envEnabled('EXPO_PUBLIC_NOVACAST_MOVIES_TRACE')
  );
}

export function novacastTrace(...args: unknown[]): void {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(...args);
}

export function novacastCatalogTrace(...args: unknown[]): void {
  if (!isNovaCastCatalogTraceEnabled()) {
    return;
  }
  console.info(...args);
}
