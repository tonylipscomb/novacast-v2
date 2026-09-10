import type { ProviderGuideProgram } from '../providers/providerRepositories.ts';
import { deviceAuthHeaders } from '../device/deviceRegistration.ts';
import { novacastTrace } from '../diagnostics/novacastLogPolicy.ts';
import { mapManagedEpgPrograms } from './managedEpgMapping.ts';

function apiConfig() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return apiUrl && anonKey ? { apiUrl, anonKey } : null;
}

export async function fetchManagedEpg(
  streamId: string,
  limit = 3,
  callerSignal?: AbortSignal,
): Promise<ProviderGuideProgram[] | null> {
  const api = apiConfig();
  if (!api) {
    novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-fallback', reason: 'configuration_missing' }));
    return null;
  }
  if (callerSignal?.aborted) return null;
  const authHeaders: Record<string, string> = await deviceAuthHeaders().catch(() => ({} as Record<string, string>));
  if (!authHeaders['x-novacast-device-id'] || !authHeaders['x-novacast-device-secret']) {
    novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-fallback', reason: 'device_auth_missing' }));
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  const abort = () => controller.abort();
  callerSignal?.addEventListener('abort', abort, { once: true });
  const startedAt = Date.now();
  novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-start', streamId }));
  try {
    const response = await fetch(`${api.apiUrl}/device-epg`, {
      method: 'POST',
      headers: { apikey: api.anonKey, Authorization: `Bearer ${api.anonKey}`, 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ streamId, limit: Math.min(12, Math.max(1, Math.floor(limit))) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-fallback', reason: 'http_failure', status: response.status }));
      return null;
    }
    const payload = await response.json().catch(() => null) as { ok?: unknown; programs?: unknown; source?: unknown } | null;
    const programs = payload?.ok === true && Array.isArray(payload.programs)
      ? mapManagedEpgPrograms(payload.programs as Record<string, unknown>[], limit)
      : [];
    if (!programs.length) {
      novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-fallback', reason: 'empty_programmes', streamId }));
      return null;
    }
    novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-success', streamId, source: payload?.source, programCount: programs.length, durationMs: Date.now() - startedAt }));
    return programs;
  } catch {
    novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-fallback', reason: controller.signal.aborted ? 'timeout_or_aborted' : 'request_failed' }));
    return null;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abort);
  }
}
