import { analyticsConfig } from '../analytics/analyticsConfig.ts';
import type { RecommendationEvent } from './recommendationContract.ts';

export class RecommendationTransportError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'RecommendationTransportError';
    this.retryable = retryable;
  }
}

export type RecommendationSyncResult = {
  ok: boolean;
  accepted?: number;
  duplicates?: number;
  invalid?: number;
  transientFailed?: number;
  retryable?: boolean;
  results?: Array<{ index: number; status: 'accepted' | 'duplicate' | 'invalid' }>;
};

export async function sendRecommendationEvents(events: readonly RecommendationEvent[]): Promise<RecommendationSyncResult> {
  if (!analyticsConfig.endpoint) throw new RecommendationTransportError('recommendation_endpoint_missing', false);
  const { deviceAuthHeaders } = await import('../device/deviceRegistration.ts');
  const response = await fetch(`${analyticsConfig.endpoint}/recommendation-events-ingest`, {
    method: 'POST',
    headers: {
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
      Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
      'Content-Type': 'application/json',
      ...(await deviceAuthHeaders()),
    },
    body: JSON.stringify({ events }),
  }).catch((error) => {
    throw new RecommendationTransportError(error instanceof Error ? error.message : 'recommendation_network_error', true);
  });
  const payload = await response.json().catch(() => null) as RecommendationSyncResult | null;
  const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
  if (!payload || payload.ok !== true && !Array.isArray(payload.results)) {
    throw new RecommendationTransportError('recommendation_invalid_response', retryable);
  }
  if (!response.ok && payload.retryable !== false) {
    throw new RecommendationTransportError('recommendation_ingest_failed', payload.retryable === true || retryable);
  }
  return payload;
}
