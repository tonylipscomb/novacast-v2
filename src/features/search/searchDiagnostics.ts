import { isNovaCastTraceLoggingEnabled } from '../diagnostics/novacastLogPolicy.ts';

/**
 * Search diagnostics for Fire TV logcat.
 * High-frequency query/index traces are gated; keep using console.error for fatal search failures.
 */
export function logSearchEvent(event: string, payload: Record<string, unknown> = {}) {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info('[NovaCast Search]', event, payload);
}
