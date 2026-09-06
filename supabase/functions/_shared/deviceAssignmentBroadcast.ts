const ONLINE_WINDOW_MS = 30 * 60 * 1000;

export function isAdminDeviceOnline(lastSeenAt: string | null | undefined, status?: string | null) {
  const seen = Date.parse(String(lastSeenAt ?? ''));
  return (
    Number.isFinite(seen) &&
    seen >= Date.now() - ONLINE_WINDOW_MS &&
    !['revoked', 'disabled', 'blocked'].includes(String(status ?? ''))
  );
}

export function buildDeviceAssignmentChannelName(deviceId: string) {
  return `device-assignment:${deviceId}`;
}

export async function broadcastDeviceAssignmentChanged(input: {
  deviceId: string;
  assignmentId: string;
  managedProviderId: string;
  assignedAt: string | null;
}) {
  const url = Deno.env.get('SUPABASE_URL')?.replace(/\/+$/, '');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    return false;
  }
  const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          topic: buildDeviceAssignmentChannelName(input.deviceId),
          event: 'assignment-changed',
          payload: {
            assignmentId: input.assignmentId,
            managedProviderId: input.managedProviderId,
            assignedAt: input.assignedAt,
          },
        },
      ],
    }),
  }).catch(() => null);
  return Boolean(response?.ok);
}
