type Device = Record<string, any>;

export function deviceMatchesQuery(device: Device, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [device.publicDeviceCode, device.assignedTesterName, device.assignedTesterEmail, device.friendlyName, device.manufacturer, device.model]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
    .includes(needle);
}

export function captureRemainingLabel(expiresAt: string | null | undefined, now = Date.now()): string {
  const remaining = Math.max(0, (Date.parse(expiresAt ?? '') - now) / 60000);
  return `${Math.floor(remaining)}m ${Math.floor((remaining % 1) * 60)}s`;
}
