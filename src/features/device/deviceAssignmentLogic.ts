export const DEVICE_ASSIGNMENT_REALTIME_DIAG = '[NovaCast Device Assignment Realtime]';

export type DeviceAssignmentSource = 'realtime' | 'heartbeat' | 'startup';

export type AuthoritativeDeviceAssignment = {
  assignmentId: string | null;
  managedProviderId: string | null;
  assignedAt: string | null;
  providerAssigned: boolean;
};

export type AppliedDeviceAssignment = {
  assignmentId: string | null;
  managedProviderId: string | null;
  assignedAt: string | null;
  appliedAt: string;
};

export type DeviceAssignmentDecision = 'apply' | 'unchanged' | 'pending';

export type ReconcileDeviceAssignmentResult = {
  decision: DeviceAssignmentDecision;
  source: DeviceAssignmentSource;
  refreshed: boolean;
  assignmentId: string | null;
  managedProviderId: string | null;
};

export type DeviceAssignmentRealtimeEvent = {
  assignmentId?: unknown;
  managedProviderId?: unknown;
  assignedAt?: unknown;
  username?: unknown;
  password?: unknown;
  baseUrl?: unknown;
};

let appliedMemory: AppliedDeviceAssignment | null = null;
let inflight: Promise<ReconcileDeviceAssignmentResult> | null = null;

export function resetDeviceAssignmentReconcileForTests() {
  appliedMemory = null;
  inflight = null;
}

export function assignmentToken(assignment: {
  assignmentId?: string | null;
  managedProviderId?: string | null;
  assignedAt?: string | null;
}): string | null {
  const assignmentId = String(assignment.assignmentId ?? '').trim();
  if (assignmentId) {
    return `id:${assignmentId}`;
  }
  const providerId = String(assignment.managedProviderId ?? '').trim();
  const assignedAt = String(assignment.assignedAt ?? '').trim();
  if (providerId && assignedAt) {
    return `provider:${providerId}@${assignedAt}`;
  }
  if (providerId) {
    return `provider:${providerId}`;
  }
  return null;
}

export function decideDeviceAssignmentAction(input: {
  applied: AppliedDeviceAssignment | null;
  authoritative: AuthoritativeDeviceAssignment;
}): DeviceAssignmentDecision {
  const nextToken = assignmentToken(input.authoritative);
  if (!nextToken) {
    return 'pending';
  }
  const appliedToken = input.applied ? assignmentToken(input.applied) : null;
  if (appliedToken === nextToken) {
    return 'unchanged';
  }
  return 'apply';
}

export function shouldIgnoreStaleCatalogPublish(input: {
  publishAssignmentToken: string | null;
  currentAssignmentToken: string | null;
}): boolean {
  if (!input.publishAssignmentToken || !input.currentAssignmentToken) {
    return false;
  }
  return input.publishAssignmentToken !== input.currentAssignmentToken;
}

export function isDeviceScopedAssignmentChannel(channelName: string, deviceId: string): boolean {
  return channelName === buildDeviceAssignmentChannelName(deviceId);
}

export function buildDeviceAssignmentChannelName(deviceId: string): string {
  return `device-assignment:${deviceId.trim()}`;
}

export function shortenDeviceId(deviceId: string | null | undefined): string | null {
  const value = String(deviceId ?? '').trim();
  if (!value) {
    return null;
  }
  return value.slice(0, 8);
}

export function logDeviceAssignmentRealtime(event: string, fields: Record<string, unknown> = {}) {
  const safe: Record<string, unknown> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (/user|pass|auth|token|secret|url|baseUrl|credential/i.test(key)) {
      continue;
    }
    if (typeof value === 'string' && /https?:|password|username/i.test(value)) {
      continue;
    }
    safe[key] = value;
  }
  console.info(DEVICE_ASSIGNMENT_REALTIME_DIAG, safe);
}

export function assignmentFromStatusLike(status: {
  assignmentId?: string | null;
  managedProviderId?: string | null;
  assignedAt?: string | null;
  providerAssigned?: boolean;
} | null): AuthoritativeDeviceAssignment {
  return {
    assignmentId: status?.assignmentId ?? null,
    managedProviderId: status?.managedProviderId ?? null,
    assignedAt: status?.assignedAt ?? null,
    providerAssigned: Boolean(status?.providerAssigned || status?.managedProviderId),
  };
}

export function parseRealtimeAssignmentSignal(payload: DeviceAssignmentRealtimeEvent | null | undefined): {
  signal: Pick<AuthoritativeDeviceAssignment, 'assignmentId' | 'managedProviderId' | 'assignedAt'>;
  credentialsPresent: boolean;
} {
  return {
    signal: {
      assignmentId: typeof payload?.assignmentId === 'string' ? payload.assignmentId : null,
      managedProviderId: typeof payload?.managedProviderId === 'string' ? payload.managedProviderId : null,
      assignedAt: typeof payload?.assignedAt === 'string' ? payload.assignedAt : null,
    },
    credentialsPresent: Boolean(payload?.username || payload?.password || payload?.baseUrl),
  };
}

export function getAppliedDeviceAssignmentSync() {
  return appliedMemory;
}

export function setAppliedDeviceAssignmentForTests(value: AppliedDeviceAssignment | null) {
  appliedMemory = value;
}

export async function seedAppliedAssignmentIfUnchanged(
  previous: AuthoritativeDeviceAssignment | null,
  next: AuthoritativeDeviceAssignment,
  persist?: (value: AppliedDeviceAssignment) => Promise<void> | void,
) {
  if (appliedMemory) {
    return appliedMemory;
  }
  const previousToken = previous ? assignmentToken(previous) : null;
  const nextToken = assignmentToken(next);
  if (!previousToken || !nextToken || previousToken !== nextToken) {
    return null;
  }
  return markDeviceAssignmentApplied(next, persist);
}

export async function markDeviceAssignmentApplied(
  assignment: AuthoritativeDeviceAssignment,
  persist?: (value: AppliedDeviceAssignment) => Promise<void> | void,
) {
  const next: AppliedDeviceAssignment = {
    assignmentId: assignment.assignmentId,
    managedProviderId: assignment.managedProviderId,
    assignedAt: assignment.assignedAt,
    appliedAt: new Date().toISOString(),
  };
  appliedMemory = next;
  await persist?.(next);
  return next;
}

export function getAppliedAssignmentDiagnostics() {
  if (!appliedMemory) {
    return {};
  }
  return {
    appliedAssignmentId: appliedMemory.assignmentId,
    appliedManagedProviderId: appliedMemory.managedProviderId,
    appliedAssignmentAt: appliedMemory.appliedAt,
  };
}

export async function reconcileDeviceAssignment(input: {
  source: DeviceAssignmentSource;
  snapshot?: AuthoritativeDeviceAssignment | null;
  fetchAuthoritative?: () => Promise<AuthoritativeDeviceAssignment | null>;
  applyAssignment?: () => Promise<void>;
  persistApplied?: (value: AppliedDeviceAssignment) => Promise<void> | void;
  onRefreshing?: () => void;
  onApplied?: () => void;
}): Promise<ReconcileDeviceAssignmentResult> {
  if (inflight) {
    return inflight;
  }
  inflight = runReconcileDeviceAssignment(input).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runReconcileDeviceAssignment(input: {
  source: DeviceAssignmentSource;
  snapshot?: AuthoritativeDeviceAssignment | null;
  fetchAuthoritative?: () => Promise<AuthoritativeDeviceAssignment | null>;
  applyAssignment?: () => Promise<void>;
  persistApplied?: (value: AppliedDeviceAssignment) => Promise<void> | void;
  onRefreshing?: () => void;
  onApplied?: () => void;
}): Promise<ReconcileDeviceAssignmentResult> {
  const startedAt = Date.now();
  logDeviceAssignmentRealtime('authoritative-refresh-start', { source: input.source });

  const authoritative =
    input.snapshot ?? (input.fetchAuthoritative ? await input.fetchAuthoritative() : null);

  if (!authoritative) {
    logDeviceAssignmentRealtime('assignment-unchanged', {
      source: input.source,
      reason: 'authoritative-unavailable',
      elapsedMs: Date.now() - startedAt,
    });
    return {
      decision: 'pending',
      source: input.source,
      refreshed: false,
      assignmentId: null,
      managedProviderId: null,
    };
  }

  const decision = decideDeviceAssignmentAction({
    applied: appliedMemory,
    authoritative,
  });

  if (decision === 'pending' || decision === 'unchanged') {
    logDeviceAssignmentRealtime('assignment-unchanged', {
      source: input.source,
      reason: decision,
      assignmentVersion: assignmentToken(authoritative),
      providerId: authoritative.managedProviderId,
      elapsedMs: Date.now() - startedAt,
    });
    return {
      decision,
      source: input.source,
      refreshed: false,
      assignmentId: authoritative.assignmentId,
      managedProviderId: authoritative.managedProviderId,
    };
  }

  logDeviceAssignmentRealtime('assignment-change-confirmed', {
    source: input.source,
    assignmentVersion: assignmentToken(authoritative),
    providerId: authoritative.managedProviderId,
    elapsedMs: Date.now() - startedAt,
  });
  input.onRefreshing?.();
  logDeviceAssignmentRealtime('provider-refresh-started', {
    source: input.source,
    assignmentVersion: assignmentToken(authoritative),
    providerId: authoritative.managedProviderId,
  });
  await input.applyAssignment?.();
  await markDeviceAssignmentApplied(authoritative, input.persistApplied);
  logDeviceAssignmentRealtime('provider-applied', {
    source: input.source,
    assignmentVersion: assignmentToken(authoritative),
    providerId: authoritative.managedProviderId,
    elapsedMs: Date.now() - startedAt,
  });
  input.onApplied?.();
  return {
    decision,
    source: input.source,
    refreshed: true,
    assignmentId: authoritative.assignmentId,
    managedProviderId: authoritative.managedProviderId,
  };
}
