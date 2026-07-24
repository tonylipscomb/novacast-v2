/**
 * Sanitized diagnostic events for beta support / DEV HUD.
 * Never store credentials, secrets, stream URLs, or invitation tokens.
 */

export type SanitizedDiagnosticEvent = {
  id: string;
  timestamp: number;
  operation: string;
  screen: string;
  errorType: string;
  detail?: string;
  outcome?: string;
  lifecycle?: string;
  network?: string;
  retryCount?: number;
};

const MAX_EVENTS = 80;
const events: SanitizedDiagnosticEvent[] = [];
let counter = 0;

const SENSITIVE =
  /(password|passwd|username|user=|token|secret|authorization|streamurl|m3u|xtream|invite|pairing)/i;

function scrub(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (SENSITIVE.test(value)) {
    return '[redacted]';
  }
  // Strip query strings that may contain credentials.
  return value.replace(/\?.*$/, '').slice(0, 240);
}

export function recordSanitizedDiagnostic(input: {
  operation: string;
  screen: string;
  errorType: string;
  detail?: string;
  outcome?: string;
  lifecycle?: string;
  network?: string;
  retryCount?: number;
}) {
  const event: SanitizedDiagnosticEvent = {
    id: `diag-${Date.now()}-${++counter}`,
    timestamp: Date.now(),
    operation: input.operation,
    screen: input.screen,
    errorType: input.errorType.slice(0, 80),
    detail: scrub(input.detail),
    outcome: input.outcome,
    lifecycle: input.lifecycle,
    network: input.network,
    retryCount: input.retryCount,
  };
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.log('[NovaCastDiag]', event.operation, event.errorType, event.outcome ?? '');
  }
}

export function getSanitizedDiagnostics(): SanitizedDiagnosticEvent[] {
  return events.map((entry) => ({ ...entry }));
}

export function clearSanitizedDiagnosticsForTests() {
  events.length = 0;
  counter = 0;
}

/** Compact code for Beta Support — no secrets. */
export function buildDiagnosticCode(input: {
  version: string;
  activation: string;
  network: string;
  lastErrorType?: string;
}): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const err = (input.lastErrorType || 'none').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24);
  return `NC-${input.version}-${input.activation}-${input.network}-${err}-${stamp}`.toUpperCase();
}
