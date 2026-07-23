import type { PairingConnectionPayload } from './pairingBridge.ts';
import type { PendingPairingSession } from './pairingTypes.ts';
import { isPairingSessionActive } from './pairingLogic.ts';

export type PairingPollStatus = 'waiting' | 'validating' | 'completed' | 'expired';

export type PairingResumeDecision =
  | { action: 'resume'; session: PendingPairingSession }
  | { action: 'create' }
  | { action: 'connect'; session: PendingPairingSession; payload: PairingConnectionPayload };

export function shouldResumePersistedSession(session: PendingPairingSession | null, now = Date.now()) {
  return Boolean(session);
}

export function shouldCreateNewSessionAfterPoll(
  session: PendingPairingSession | null,
  pollStatus: PairingPollStatus,
  now = Date.now(),
) {
  if (!session) {
    return true;
  }

  if (pollStatus === 'completed') {
    return false;
  }

  if (pollStatus === 'waiting' || pollStatus === 'validating') {
    return false;
  }

  if (session.redemptionToken || session.redeemedPayload) {
    return false;
  }

  return pollStatus === 'expired' && !isPairingSessionActive(session.expiresAt, now);
}

export function resolvePairingResumeDecision(
  session: PendingPairingSession | null,
  pollStatus: PairingPollStatus | null,
  now = Date.now(),
): PairingResumeDecision {
  if (session?.redeemedPayload) {
    return { action: 'connect', session, payload: session.redeemedPayload };
  }

  if (!session) {
    return { action: 'create' };
  }

  if (pollStatus === null) {
    return { action: 'resume', session };
  }

  if (shouldCreateNewSessionAfterPoll(session, pollStatus, now)) {
    return { action: 'create' };
  }

  return { action: 'resume', session };
}

export type PairingPollPhase = 'waiting' | 'validating';

const POLL_INTERVAL_MS: Record<PairingPollPhase, number> = {
  waiting: 1_200,
  validating: 800,
};

export function computePollIntervalMs(consecutiveFailures: number, phase: PairingPollPhase = 'waiting') {
  const baseInterval = POLL_INTERVAL_MS[phase];

  if (consecutiveFailures <= 0) {
    return baseInterval;
  }

  return Math.min(baseInterval * 2 ** Math.min(consecutiveFailures - 1, 3), 20_000);
}

export function shouldMarkPollingUnavailable(consecutiveFailures: number) {
  return consecutiveFailures >= 6;
}

export function resolvePairingUserMessage(
  status:
    | 'initializing'
    | 'waiting'
    | 'validating'
    | 'redeeming'
    | 'connecting'
    | 'connected'
    | 'failed'
    | 'expired'
    | 'unavailable'
    | 'binding_error',
  failureCategory?: string | null,
) {
  switch (status) {
    case 'initializing':
      return 'Restoring pairing session...';
    case 'validating':
      return 'Provider verified on your phone. Finishing setup...';
    case 'redeeming':
      return 'Retrieving provider details securely...';
    case 'connecting':
      return 'Connecting provider...';
    case 'connected':
      return 'Preparing channels for Home...';
    case 'expired':
      return 'Code expired. Generate a new code.';
    case 'binding_error':
      return 'This TV lost its pairing session binding. Generate a new code.';
    case 'unavailable':
      if (failureCategory === 'invalid_device') {
        return 'Device authentication failed. Generate a new code.';
      }
      if (failureCategory === 'activation_required') {
        return 'This TV must be activated before pairing.';
      }
      if (failureCategory === 'rate_limited') {
        return 'Too many pairing attempts. Wait a few minutes, then press Generate New Code.';
      }
      if (failureCategory === 'server_configuration_error' || failureCategory === 'unexpected_server_error') {
        return 'Pairing handoff failed after phone setup. Generate a new code.';
      }
      return 'Pairing service unavailable. Check the connection and retry.';
    case 'failed':
      if (failureCategory === 'provider_persistence_failed') {
        return 'The provider could not be saved on this TV. Retry pairing.';
      }
      if (failureCategory === 'redemption_failed') {
        return 'NovaCast could not retrieve the paired provider. Retry pairing.';
      }
      return 'Pairing could not finish. Retry with the same code.';
    case 'waiting':
      return 'Waiting for phone activation…';
    default:
      return 'Waiting for phone activation…';
  }
}

export function isPairingSetupInProgress(
  status:
    | 'initializing'
    | 'waiting'
    | 'validating'
    | 'redeeming'
    | 'connecting'
    | 'connected'
    | 'failed'
    | 'expired'
    | 'unavailable'
    | 'binding_error',
  isConnecting: boolean,
) {
  return (
    isConnecting ||
    status === 'validating' ||
    status === 'redeeming' ||
    status === 'connecting' ||
    status === 'connected'
  );
}

export function resolvePairingSetupPhase(
  status:
    | 'initializing'
    | 'waiting'
    | 'validating'
    | 'redeeming'
    | 'connecting'
    | 'connected'
    | 'failed'
    | 'expired'
    | 'unavailable'
    | 'binding_error',
  isConnecting: boolean,
): 0 | 1 | 2 | 3 {
  if (isConnecting || status === 'connected') {
    return 3;
  }

  if (status === 'redeeming') {
    return 2;
  }

  if (status === 'validating') {
    return 1;
  }

  return 0;
}
