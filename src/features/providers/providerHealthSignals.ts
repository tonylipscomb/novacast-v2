import { recordProviderHealthSignal } from './providerHealth.ts';

export type ProviderHealthFailureReason = 'generic' | 'authentication_required' | 'subscription_expired';

export function classifyProviderHealthFailure(error: unknown): ProviderHealthFailureReason {
  if (!error || typeof error !== 'object') return 'generic';
  const value = error as { code?: unknown; kind?: unknown; status?: unknown; providerStatus?: unknown };
  const code = String(value.code ?? value.kind ?? value.providerStatus ?? '').toLowerCase();
  if (code.includes('expired') || code.includes('subscription')) return 'subscription_expired';
  if (code.includes('auth') || code.includes('credential') || code.includes('login')) return 'authentication_required';
  return 'generic';
}

export async function recordProviderHealthFailure(input: {
  providerId: string;
  generation: number;
  operationId: string;
  error?: unknown;
  nowMs?: number;
  cancelled?: boolean;
  offline?: boolean;
}) {
  const reason = classifyProviderHealthFailure(input.error);
  return recordProviderHealthSignal({
    providerId: input.providerId,
    generation: input.generation,
    operationId: input.operationId,
    kind: 'failure',
    nowMs: input.nowMs,
    cancelled: input.cancelled,
    offline: input.offline,
    ...(reason === 'generic' ? {} : { explicit: reason }),
  });
}

export function recordProviderHealthSuccess(input: { providerId: string; generation: number; operationId: string; nowMs?: number }) {
  return recordProviderHealthSignal({ ...input, kind: 'success' });
}

