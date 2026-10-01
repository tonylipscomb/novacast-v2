export type DeviceInspectorRow = Record<string, unknown>;

export type DeviceActivity = {
  id: string;
  label: string;
  detail: string;
  timestamp: string | null;
};

function text(value: unknown): string | null {
  return value == null || value === '' ? null : String(value);
}

export function resolveDeviceRecord(devices: DeviceInspectorRow[], key: string): DeviceInspectorRow | null {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return null;
  return devices.find((device) =>
    [device.public_device_code, device.id].filter(Boolean).some((value) => String(value).toLowerCase() === normalized),
  ) ?? null;
}

export function sanitizeProviderSummary(device: DeviceInspectorRow, provider: DeviceInspectorRow | null) {
  return {
    id: text(provider?.id ?? device.managed_provider_id),
    name: text(provider?.display_name ?? provider?.slug ?? device.providerName),
    type: text(provider?.provider_type ?? provider?.type),
    assignment: text(device.assignment_command_status ?? device.assignment_status) ?? 'Not reported',
    acknowledgement: text(device.applied_assignment_id ?? device.assignment_acknowledgement) ?? 'Not reported',
    health: text(provider?.health_status ?? device.providerStatus) ?? 'Not reported',
    inventory: text(provider?.inventory_summary ?? provider?.catalog_count),
    epg: text(provider?.epg_status),
    lastCheck: text(provider?.last_checked_at ?? provider?.last_validation_at),
  };
}

export function readPlaybackSummary(device: DeviceInspectorRow) {
  const playback = device.recentPlayback;
  if (!playback || typeof playback !== 'object' || Array.isArray(playback)) return { available: false, fields: [] as [string, string | null][] };
  const value = playback as DeviceInspectorRow;
  const fields: [string, string | null][] = [
    ['Content', text(value.contentTitle)], ['Content type', text(value.contentType)],
    ['Route', text(value.route ?? device.current_route)], ['Started', text(value.startedAt)],
    ['Ended / state', text(value.endedAt ?? value.finalResult)],
    ['Error', text(device.recentError && typeof device.recentError === 'object' ? (device.recentError as DeviceInspectorRow).errorCode : null)],
  ];
  return { available: fields.some(([, field]) => field !== null), fields };
}

export function buildDeviceActivity(device: DeviceInspectorRow): DeviceActivity[] {
  const activities: DeviceActivity[] = [];
  if (device.last_seen_at) activities.push({ id: 'heartbeat', label: 'Heartbeat observed', detail: 'Device last seen', timestamp: String(device.last_seen_at) });
  if (device.activation_status) activities.push({ id: 'activation', label: 'Activation state', detail: String(device.activation_status), timestamp: text(device.updated_at) });
  if (device.assignment_command_status || device.applied_assignment_id) activities.push({ id: 'assignment', label: 'Provider assignment', detail: String(device.assignment_command_status ?? 'Acknowledgement recorded'), timestamp: text(device.assignment_applied_at ?? device.updated_at) });
  const events = Array.isArray(device.events) ? device.events : [];
  events.forEach((event, index) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return;
    const row = event as DeviceInspectorRow;
    activities.push({ id: String(row.id ?? `event-${index}`), label: text(row.event_type) ?? 'Diagnostic event', detail: text(row.level) ?? 'Recorded event', timestamp: text(row.event_at) });
  });
  return activities.sort((a, b) => {
    const left = Date.parse(a.timestamp ?? '');
    const right = Date.parse(b.timestamp ?? '');
    if (!Number.isFinite(left)) return 1;
    if (!Number.isFinite(right)) return -1;
    return right - left;
  });
}
