import { useEffect, useState } from 'react';

import { useDeviceState } from '@/features/device/deviceActivation';
import { isClosedBetaManagedFlow } from '@/features/device/deviceFeatureFlags';
import { formatProviderExpirationLabel } from '@/features/providers/providerExpiration';
import type { ProviderAccountMetadata, ProviderRecord } from '@/features/providers/providerModel';

export function getRemainingMs(expiresAt: string | null | undefined, now = Date.now()) {
  if (!expiresAt) return null;
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - now);
}

/** Live countdown for closed-beta access windows (e.g. 2d 4h 12m or 4:12:08). */
export function formatBetaCountdown(ms: number | null | undefined) {
  if (ms == null) return null;
  if (ms <= 0) return '0:00:00';

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function useAccessExpirationDisplay(options?: {
  provider?: ProviderRecord | null;
  account?: ProviderAccountMetadata | null;
}) {
  const closedBeta = isClosedBetaManagedFlow();
  const device = useDeviceState();
  const expiresAt = device.status?.activationExpiresAt ?? null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!closedBeta || !expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [closedBeta, expiresAt]);

  if (closedBeta) {
    const remainingMs = getRemainingMs(expiresAt, now) ?? device.status?.remainingBetaMs ?? null;
    const countdown = formatBetaCountdown(remainingMs) ?? '—';
    return {
      closedBeta: true as const,
      caption: 'Beta ends',
      value: countdown,
      line: remainingMs != null && remainingMs > 0 ? `Ends in ${countdown}` : 'Beta access ended',
    };
  }

  const value = formatProviderExpirationLabel(options?.provider, options?.account);
  return {
    closedBeta: false as const,
    caption: 'Expires',
    value,
    line: value === 'Expiration unavailable' ? value : `Expires ${value}`,
  };
}
