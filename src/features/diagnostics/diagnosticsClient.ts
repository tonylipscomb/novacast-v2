import { deviceAuthHeaders, deviceMetadata } from '@/features/device/deviceRegistration';
import { sanitizeDiagnosticEvent } from './diagnosticsSanitizer';
import { isDiagnosticsEnabled, shouldBufferDiagnostics } from './diagnosticsConfig';
import { getDiagnosticCapture, isEnhancedCaptureActive } from './diagnosticCapture';
import type { DiagnosticEvent } from './diagnosticTypes';

const MAX_QUEUE = 120;
const queue: DiagnosticEvent[] = [];
let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function endpoint() { return process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '') ?? ''; }

export function recordDiagnostic(event: DiagnosticEvent) {
  if (!shouldBufferDiagnostics()) return;
  const capture = getDiagnosticCapture();
  queue.push(sanitizeDiagnosticEvent({ ...event, captureId: capture?.captureId } as unknown as Record<string, unknown>) as DiagnosticEvent);
  while (queue.length > MAX_QUEUE) queue.splice(0, 1);
  if (event.eventType === 'playback_error' || event.eventType === 'source_timeout' || event.eventType === 'decoder_error') {
    void flushDiagnostics();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => { flushTimer = null; void flushDiagnostics(); }, isEnhancedCaptureActive() ? 2_000 : 8_000);
  }
}

/** Structured support event entry; intentionally shares the bounded, fail-open queue. */
export function recordSupportLog(event: DiagnosticEvent) {
  recordDiagnostic(event);
}

export async function flushDiagnostics() {
  if (flushing || !queue.length || !isDiagnosticsEnabled()) return;
  const apiUrl = endpoint();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!apiUrl || !anonKey) return;
  flushing = true;
  const batch = queue.splice(0, 25);
  try {
    const response = await fetch(`${apiUrl}/diagnostics-ingest`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json', ...(await deviceAuthHeaders()) },
      body: JSON.stringify({
        events: batch,
        device: deviceMetadata(),
      }),
    });
    if (!response.ok) queue.unshift(...batch.slice(-25));
  } catch { queue.unshift(...batch.slice(-25)); }
  finally { flushing = false; }
}

export function getPendingDiagnosticCount() { return queue.length; }
