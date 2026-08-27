export const DIAGNOSTIC_EVENT_LABELS: Record<string, string> = {
  play_attempt: 'Trying to play', first_frame: 'Picture appeared', playback_started: 'Playback started',
  buffer_start: 'Started buffering', buffer_end: 'Buffer recovered', playback_error: 'Playback failed',
  playback_stopped: 'Playback ended', source_timeout: 'Stream timed out', decoder_error: 'Device decoder error',
  network_request_failure: 'Network request failed',
};

export type DiagnosticTone = 'good' | 'warning' | 'problem' | 'unknown';

export function diagnosticEventLabel(eventType: unknown) {
  const value = String(eventType ?? '');
  return DIAGNOSTIC_EVENT_LABELS[value] ?? (value.replace(/_/g, ' ') || 'Diagnostic event');
}

export function diagnosticTone(value: unknown): DiagnosticTone {
  const normalized = String(value ?? '').toUpperCase();
  if (['GOOD', 'HEALTHY', 'ONLINE'].includes(normalized)) return 'good';
  if (['WARNING', 'DEGRADED', 'ACTIVE'].includes(normalized)) return 'warning';
  if (['PROBLEM', 'CRITICAL', 'OFFLINE', 'FAILED'].includes(normalized)) return 'problem';
  return 'unknown';
}

export function diagnosticStatusLabel(value: unknown) {
  const tone = diagnosticTone(value);
  return tone === 'good' ? 'GOOD' : tone === 'warning' ? 'CHECK' : tone === 'problem' ? 'PROBLEM' : 'NOT ENOUGH DATA';
}

export function formatDiagnosticDuration(value: unknown) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'Not enough data yet';
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} sec`;
}
