import { deviceAuthHeaders } from '@/features/device/deviceRegistration';

import { analyticsConfig } from './analyticsConfig';
import type { AnalyticsBatch, AnalyticsIngestResponse } from './analyticsTypes';

export class AnalyticsTransportError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AnalyticsTransportError';
  }
}

export async function sendAnalyticsBatch(batch: AnalyticsBatch): Promise<AnalyticsIngestResponse> {
  if (!analyticsConfig.endpoint) throw new AnalyticsTransportError('analytics_endpoint_missing', false);
  const response = await fetch(`${analyticsConfig.endpoint}/analytics-ingest`, {
    method: 'POST',
    headers: {
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
      Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
      'Content-Type': 'application/json',
      ...(await deviceAuthHeaders()),
    },
    body: JSON.stringify(batch),
  }).catch((error) => {
    throw new AnalyticsTransportError(error instanceof Error ? error.message : 'analytics_network_error', true);
  });

  const payload = (await response.json().catch(() => null)) as AnalyticsIngestResponse | null;
  if (!payload) throw new AnalyticsTransportError('analytics_invalid_response', response.status >= 500 || response.status === 408 || response.status === 429);
  if (!response.ok || payload.ok !== true) {
    throw new AnalyticsTransportError(payload.errorCategory ?? 'analytics_ingest_failed', payload.retryable === true || response.status >= 500 || response.status === 408 || response.status === 429);
  }
  return payload;
}

