/**
 * Bounded startup operation helpers for closed-beta resilience.
 */

export const STARTUP_NETWORK_TIMEOUT_MS = 12_000;
export const STARTUP_BOOTSTRAP_TIMEOUT_MS = 45_000;
export const STARTUP_MAX_AUTO_RETRIES = 2;

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = 'operation_timeout',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export type StartupTerminalState =
  | 'success'
  | 'recoverable_offline'
  | 'actionable_error'
  | 'activation_required'
  | 'provider_action_required';

export function resolveManagedLibraryMissingState(input: {
  closedBeta: boolean;
  providerAssigned: boolean;
  requiresProviderDownload: boolean;
  hasProvider: boolean;
}): StartupTerminalState | 'wait' {
  if (input.hasProvider) {
    return 'success';
  }
  if (!input.closedBeta) {
    return 'provider_action_required';
  }
  if (!input.providerAssigned && !input.requiresProviderDownload) {
    return 'actionable_error';
  }
  return 'wait';
}
