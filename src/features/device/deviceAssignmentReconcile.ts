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
  getAppliedDeviceAssignmentSync,
  markDeviceAssignmentApplied as markAppliedInMemory,
  reconcileDeviceAssignment as reconcileAssignmentLogic,
  seedAppliedAssignmentIfUnchanged as seedAppliedLogic,
  setAppliedDeviceAssignmentForTests as setAppliedInMemory,
  type AuthoritativeDeviceAssignment,
  type DeviceAssignmentSource,
} from './deviceAssignmentLogic.ts';

export * from './deviceAssignmentLogic.ts';

const APPLY_TOAST_ID = 'device-assignment-refresh';
let persistLoaded = false;
let downloadInflight: Promise<void> | null = null;

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
}) {
  await ensureAppliedLoaded();
  const notify = input.notify ?? true;
  return reconcileAssignmentLogic({
    source: input.source,
    snapshot: input.snapshot,
    fetchAuthoritative: input.fetchAuthoritative ?? fetchAuthoritativeDeviceAssignment,
    applyAssignment: input.applyAssignment ?? runManagedProviderRefresh,
    persistApplied: writeAppliedDeviceAssignment,
    onRefreshing: notify ? showAssignmentRefreshingToast : undefined,
    onApplied: notify ? showAssignmentAppliedToast : undefined,
  });
}
