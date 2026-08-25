export type ProviderAssignmentAckState = 'pending' | 'updating' | 'applied';

export function isAdminDeviceOnline(device: {
  last_seen_at?: unknown;
  status?: unknown;
}, now = Date.now()) {
  const seen = Date.parse(String(device.last_seen_at ?? ''));
  return (
    Number.isFinite(seen) &&
    seen >= now - 30 * 60 * 1000 &&
    !['revoked', 'disabled', 'blocked'].includes(String(device.status ?? ''))
  );
}

export function resolveProviderAssignmentAckState(device: {
  assignment_id?: unknown;
  assignment_command_status?: unknown;
  applied_assignment_id?: unknown;
  assignment_applied_at?: unknown;
}): ProviderAssignmentAckState {
  const assignmentId = String(device.assignment_id ?? '');
  const appliedId = String(device.applied_assignment_id ?? '');
  const commandStatus = String(device.assignment_command_status ?? '');
  if ((assignmentId && appliedId && assignmentId === appliedId) || commandStatus === 'completed') {
    return 'applied';
  }
  if (commandStatus === 'pending' || commandStatus === 'acked') {
    return 'updating';
  }
  return 'pending';
}

export function formatProviderAssignmentMessage(input: {
  providerName: string;
  unchanged?: boolean;
  deviceOnline?: boolean;
  ackState?: ProviderAssignmentAckState;
}) {
  const providerName = input.providerName.trim() || 'selected provider';
  if (input.unchanged) {
    return `Device already uses ${providerName}.`;
  }
  if (input.ackState === 'applied') {
    return `${providerName} applied successfully.`;
  }
  if (input.deviceOnline) {
    return `Provider changed to ${providerName}. Updating TV now…`;
  }
  return `Provider changed to ${providerName}. It will update when the TV reconnects.`;
}
