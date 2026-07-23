/**
 * Release-safe search diagnostics for Fire TV logcat.
 * Filter: adb logcat | findstr /i "[NovaCast Search]"
 */
export function logSearchEvent(event: string, payload: Record<string, unknown> = {}) {
  console.info('[NovaCast Search]', event, payload);
}
