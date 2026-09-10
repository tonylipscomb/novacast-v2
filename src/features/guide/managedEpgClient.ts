import type { ProviderGuideProgram } from '../providers/providerRepositories.ts';
import { deviceAuthHeaders } from '../device/deviceRegistration.ts';
import { novacastTrace } from '../diagnostics/novacastLogPolicy.ts';
import { mapManagedEpgPrograms } from './managedEpgMapping.ts';

const MANAGED_EPG_RELEASE_AUDIT = '[NovaCast Managed EPG Release Audit]';

function safeAuditText(value: unknown, maxLength = 160) {
  if (typeof value !== 'string') return null;
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/(?:password|passwd|token|secret|authorization|bearer|api[_ -]?key)\s*[=:]\s*[^\s,;]+/gi, '[redacted]')
    .trim()
    .slice(0, maxLength) || null;
}

function logManagedEpgFallback(streamId: string, reason: string, httpStatus?: number) {
  console.info(MANAGED_EPG_RELEASE_AUDIT, {
    event: 'request-fallback',
    streamId,
    reason,
    ...(httpStatus == null ? {} : { httpStatus }),
  });
}

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
    logManagedEpgFallback(streamId, 'configuration_missing');
    novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-fallback', reason: 'configuration_missing' }));
    return null;
  }
  if (callerSignal?.aborted) return null;
  const authHeaders: Record<string, string> = await deviceAuthHeaders().catch(() => ({} as Record<string, string>));
  if (!authHeaders['x-novacast-device-id'] || !authHeaders['x-novacast-device-secret']) {
    logManagedEpgFallback(streamId, 'device_auth_missing');
    novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-fallback', reason: 'device_auth_missing' }));
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  const abort = () => controller.abort();
  callerSignal?.addEventListener('abort', abort, { once: true });
  const startedAt = Date.now();
  const requestedLimit = Math.min(12, Math.max(1, Math.floor(limit)));
  console.info(MANAGED_EPG_RELEASE_AUDIT, { event: 'request-start', streamId, limit: requestedLimit });
  novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-start', streamId }));
  try {
    const response = await fetch(`${api.apiUrl}/device-epg`, {
      method: 'POST',
      headers: { apikey: api.anonKey, Authorization: `Bearer ${api.anonKey}`, 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ streamId, limit: requestedLimit }),
      signal: controller.signal,
    });
    if (!response.ok) {
      logManagedEpgFallback(streamId, 'http_failure', response.status);
      novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-fallback', reason: 'http_failure', status: response.status }));
      return null;
    }
    const payload = await response.json().catch(() => null) as { ok?: unknown; programs?: unknown; source?: unknown } | null;
    const programs = payload?.ok === true && Array.isArray(payload.programs)
      ? mapManagedEpgPrograms(payload.programs as Record<string, unknown>[], limit)
      : [];
    if (!programs.length) {
      logManagedEpgFallback(streamId, 'empty_programmes');
      novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-fallback', reason: 'empty_programmes', streamId }));
      return null;
    }
    const source = payload?.source && typeof payload.source === 'object' ? payload.source as Record<string, unknown> : {};
    console.info(MANAGED_EPG_RELEASE_AUDIT, {
      event: 'request-success',
      streamId,
      programCount: programs.length,
      sourceLabel: safeAuditText(source.label ?? source.safe_label),
      sourcePriority: typeof source.priority === 'number' ? source.priority : null,
      firstProgramTitle: safeAuditText(programs[0]?.title),
      firstStartAt: programs[0]?.startAt ?? null,
      firstEndAt: programs[0]?.endAt ?? null,
      durationMs: Date.now() - startedAt,
    });
    novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-success', streamId, source: payload?.source, programCount: programs.length, durationMs: Date.now() - startedAt }));
    return programs;
  } catch {
    logManagedEpgFallback(streamId, controller.signal.aborted ? 'timeout_or_aborted' : 'request_failed');
    novacastTrace('[NovaCast Managed EPG] ' + JSON.stringify({ event: 'request-fallback', reason: controller.signal.aborted ? 'timeout_or_aborted' : 'request_failed' }));
    return null;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abort);
  }
}
