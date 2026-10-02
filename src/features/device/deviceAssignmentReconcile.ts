import { showNotification } from '@/features/notifications/notificationStore';
import { downloadManagedProviderAssignment } from './managedProviderDownload.ts';
import { checkDeviceStatus } from './deviceActivation.ts';
import {
  readAppliedDeviceAssignment,
  writeAppliedDeviceAssignment,
} from './deviceStorage.ts';
import type { DeviceHeartbeatResponse, DeviceStatusResponse } from './deviceTypes.ts';
import {
  assignmentFromStatusLike,
  assignmentToken,
  getAppliedDeviceAssignmentSync,
  markDeviceAssignmentApplied as markAppliedInMemory,
  reconcileDeviceAssignment as reconcileAssignmentLogic,
  resetDeviceAssignmentReconcileForTests as resetAssignmentLogicForTests,
  seedAppliedAssignmentIfUnchanged as seedAppliedLogic,
  setAppliedDeviceAssignmentForTests as setAppliedInMemory,
  type AuthoritativeDeviceAssignment,
  type DeviceAssignmentSource,
  type ReconcileDeviceAssignmentResult,
} from './deviceAssignmentLogic.ts';

export {
  assignmentToken,
  assignmentFromStatusLike,
  buildDeviceAssignmentChannelName,
  getAppliedAssignmentDiagnostics,
  getAppliedDeviceAssignmentSync,
  isDeviceScopedAssignmentChannel,
  logDeviceAssignmentRealtime,
  parseRealtimeAssignmentSignal,
  setAppliedDeviceAssignmentForTests,
  shortenDeviceId,
} from './deviceAssignmentLogic.ts';
export type {
  AppliedDeviceAssignment,
  AuthoritativeDeviceAssignment,
  DeviceAssignmentRealtimeEvent,
  DeviceAssignmentSource,
  ReconcileDeviceAssignmentResult,
} from './deviceAssignmentLogic.ts';

const APPLY_TOAST_ID = 'device-assignment-refresh';
let persistLoaded = false;
let downloadInflight: Promise<void> | null = null;
const ASSIGNMENT_RETRY_DELAYS_MS = [15_000, 30_000, 60_000] as const;
let assignmentRetryBackoff: {
  token: string;
  attempts: number;
  retryAt: number;
} | null = null;
let reconcileInflight: Promise<ReconcileDeviceAssignmentResult> | null = null;

export function assignmentFromDeviceStatus(
  status: Pick<DeviceStatusResponse, 'assignmentId' | 'managedProviderId' | 'assignedAt' | 'providerAssigned'> | null,
): AuthoritativeDeviceAssignment {
  return assignmentFromStatusLike(status);
}

export function assignmentFromHeartbeat(
  payload: Pick<
    DeviceHeartbeatResponse,
    'assignmentId' | 'managedProviderId' | 'assignedAt' | 'providerAssigned'
  >,
): AuthoritativeDeviceAssignment {
  return assignmentFromStatusLike(payload);
}

async function ensureAppliedLoaded() {
  if (persistLoaded) {
    return;
  }
  persistLoaded = true;
  const stored = await readAppliedDeviceAssignment();
  if (stored) {
    setAppliedInMemory(stored);
  }
}

export async function getAppliedDeviceAssignment() {
  await ensureAppliedLoaded();
  return getAppliedDeviceAssignmentSync();
}

export async function markDeviceAssignmentApplied(assignment: AuthoritativeDeviceAssignment) {
  await ensureAppliedLoaded();
  return markAppliedInMemory(assignment, writeAppliedDeviceAssignment);
}

export async function seedAppliedAssignmentIfUnchanged(
  previous: AuthoritativeDeviceAssignment | null,
  next: AuthoritativeDeviceAssignment,
) {
  await ensureAppliedLoaded();
  return seedAppliedLogic(previous, next, writeAppliedDeviceAssignment);
}

export async function runManagedProviderRefresh() {
  if (downloadInflight) {
    return downloadInflight;
  }
  downloadInflight = downloadManagedProviderAssignment()
    .then(() => undefined)
    .finally(() => {
      downloadInflight = null;
    });
  return downloadInflight;
}

export function getAssignmentRetryBackoffState() {
  if (!assignmentRetryBackoff) {
    return { active: false, attempts: 0, remainingMs: 0 };
  }
  return {
    active: Date.now() < assignmentRetryBackoff.retryAt,
    attempts: assignmentRetryBackoff.attempts,
    remainingMs: Math.max(0, assignmentRetryBackoff.retryAt - Date.now()),
  };
}

export function clearAssignmentRetryBackoff() {
  assignmentRetryBackoff = null;
}

function pendingAssignmentResult(
  source: DeviceAssignmentSource,
  assignment: AuthoritativeDeviceAssignment | null,
) {
  return {
    decision: 'pending' as const,
    source,
    refreshed: false,
    assignmentId: assignment?.assignmentId ?? null,
    managedProviderId: assignment?.managedProviderId ?? null,
  };
}

export async function fetchAuthoritativeDeviceAssignment(): Promise<AuthoritativeDeviceAssignment | null> {
  const next = await checkDeviceStatus();
  return assignmentFromDeviceStatus(next.status);
}

export function showAssignmentRefreshingToast() {
  showNotification({
    id: APPLY_TOAST_ID,
    type: 'info',
    title: 'Provider updated. Refreshing library…',
    dedupeKey: 'device-assignment',
    scope: 'device-assignment',
    position: 'top-right',
    duration: 8000,
  });
}

export function showAssignmentAppliedToast() {
  showNotification({
    id: APPLY_TOAST_ID,
    type: 'success',
    title: 'Provider updated.',
    dedupeKey: 'device-assignment',
    scope: 'device-assignment',
    position: 'top-right',
    duration: 4000,
  });
}

export async function reconcileDeviceAssignment(input: {
  source: DeviceAssignmentSource;
  snapshot?: AuthoritativeDeviceAssignment | null;
  fetchAuthoritative?: () => Promise<AuthoritativeDeviceAssignment | null>;
  applyAssignment?: () => Promise<void>;
  notify?: boolean;
  force?: boolean;
}) {
  await ensureAppliedLoaded();
  if (reconcileInflight) {
    return reconcileInflight;
  }
  const operation = reconcileDeviceAssignmentInternal(input);
  reconcileInflight = operation.finally(() => {
    reconcileInflight = null;
  });
  return reconcileInflight;
}

async function reconcileDeviceAssignmentInternal(input: {
  source: DeviceAssignmentSource;
  snapshot?: AuthoritativeDeviceAssignment | null;
  fetchAuthoritative?: () => Promise<AuthoritativeDeviceAssignment | null>;
  applyAssignment?: () => Promise<void>;
  notify?: boolean;
  force?: boolean;
}) {
  const notify = input.notify ?? true;
  const authoritative = input.snapshot ?? await (input.fetchAuthoritative ?? fetchAuthoritativeDeviceAssignment)();
  const token = authoritative ? assignmentToken(authoritative) : null;

  if (assignmentRetryBackoff && token !== assignmentRetryBackoff.token) {
    assignmentRetryBackoff = null;
  }

  if (
    !input.force &&
    token &&
    assignmentRetryBackoff?.token === token &&
    Date.now() < assignmentRetryBackoff.retryAt
  ) {
    console.info('[NovaCast Device Assignment]', JSON.stringify({
      event: 'retry-backoff-active',
      source: input.source,
      attempts: assignmentRetryBackoff.attempts,
      remainingMs: assignmentRetryBackoff.retryAt - Date.now(),
    }));
    return pendingAssignmentResult(input.source, authoritative);
  }

  try {
    const result = await reconcileAssignmentLogic({
      source: input.source,
      snapshot: authoritative,
      applyAssignment: input.applyAssignment ?? runManagedProviderRefresh,
      persistApplied: writeAppliedDeviceAssignment,
      onRefreshing: notify ? showAssignmentRefreshingToast : undefined,
      onApplied: notify ? showAssignmentAppliedToast : undefined,
    });
    if (result.refreshed || result.decision === 'unchanged' || result.decision === 'pending') {
      assignmentRetryBackoff = null;
    }
    return result;
  } catch (error) {
    if (token) {
      const attempts = Math.min((assignmentRetryBackoff?.attempts ?? 0) + 1, ASSIGNMENT_RETRY_DELAYS_MS.length);
      assignmentRetryBackoff = {
        token,
        attempts,
        retryAt: Date.now() + ASSIGNMENT_RETRY_DELAYS_MS[attempts - 1],
      };
      console.info('[NovaCast Device Assignment]', JSON.stringify({
        event: 'retry-backoff-scheduled',
        source: input.source,
        attempts,
        retryDelayMs: ASSIGNMENT_RETRY_DELAYS_MS[attempts - 1],
        errorCategory: error instanceof Error ? 'provider-refresh-failed' : 'provider-refresh-failed',
      }));
    }
    return pendingAssignmentResult(input.source, authoritative);
  }
}

export function resetDeviceAssignmentReconcileForTests() {
  assignmentRetryBackoff = null;
  persistLoaded = false;
  downloadInflight = null;
  reconcileInflight = null;
  resetAssignmentLogicForTests();
}
