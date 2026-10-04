type RecoverySurface = 'provider-access' | 'restricted-settings';
type RecoveryFocusAction =
  | 'surface-mounted'
  | 'preferred-focus-requested'
  | 'preferred-focus-received'
  | 'action-pressed'
  | 'retry-start'
  | 'retry-success'
  | 'retry-failed';

const SAFE_RESULT = /^[a-z0-9_-]{1,64}$/i;

function safe(value: string) {
  return SAFE_RESULT.test(value) ? value : 'unknown';
}
export function logProviderRecoveryFocus(input: {
  surface: RecoverySurface;
  action: RecoveryFocusAction;
  controlId?: string;
  accessState: string;
  focusHandlePresent?: boolean;
  elapsedMs?: number;
  retryAttempt?: number;
  resultCategory?: string;
}) {
  console.info('[NOVACAST_PROVIDER_RECOVERY_FOCUS]', {
    surface: input.surface,
    action: input.action,
    ...(input.controlId ? { controlId: safe(input.controlId) } : {}),
    accessState: safe(input.accessState),
    ...(input.focusHandlePresent !== undefined ? { focusHandlePresent: input.focusHandlePresent } : {}),
    ...(input.elapsedMs !== undefined ? { elapsedMs: Math.max(0, Math.round(input.elapsedMs)) } : {}),
    ...(input.retryAttempt !== undefined ? { retryAttempt: Math.max(0, Math.round(input.retryAttempt)) } : {}),
    ...(input.resultCategory ? { resultCategory: safe(input.resultCategory) } : {}),
  });
}

export function logProviderAccessDecision(input: {
  accessState: string;
  providerStatus?: string;
  healthStatus?: string;
  providerInitialized: boolean;
  retryInFlight: boolean;
  metadataFreshnessCategory: string;
  validationResultCategory: string;
}) {
  console.info('[NOVACAST_PROVIDER_ACCESS]', {
    accessState: safe(input.accessState),
    providerStatus: safe(input.providerStatus ?? 'none'),
    healthStatus: safe(input.healthStatus ?? 'none'),
    providerInitialized: input.providerInitialized,
    retryInFlight: input.retryInFlight,
    metadataFreshnessCategory: safe(input.metadataFreshnessCategory),
    validationResultCategory: safe(input.validationResultCategory),
  });
}
