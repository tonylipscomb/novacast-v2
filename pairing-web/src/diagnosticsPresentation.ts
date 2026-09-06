export const DIAGNOSTIC_EVENT_LABELS: Record<string, string> = {
  play_attempt: 'Trying to play', provider_request_started: 'Contacting provider', provider_request_succeeded: 'Provider responded', provider_request_failed: 'Provider request failed',
  stream_resolution_started: 'Resolving stream', stream_resolution_succeeded: 'Stream resolved', stream_resolution_failed: 'Stream could not be resolved',
  player_preparing: 'Player preparing', player_ready: 'Player ready', first_frame: 'Picture appeared', playback_started: 'Playback started',
  buffer_start: 'Buffering started', buffering_started: 'Buffering started', buffer_end: 'Buffering recovered', buffering_ended: 'Buffering recovered', playback_error: 'Playback error',
  playback_stopped: 'Playback ended', playback_completed: 'Playback completed', source_timeout: 'Stream timed out', decoder_error: 'Device decoder error',
  network_request_failure: 'Network request failed', route_changed: 'Screen changed', app_launch: 'App launched', app_backgrounded: 'App backgrounded',
};

const DIAGNOSTIC_EVENT_STAGES: Record<string, string> = {
  play_attempt: 'PLAYBACK', provider_request_started: 'PROVIDER', provider_request_succeeded: 'PROVIDER', provider_request_failed: 'PROVIDER',
  stream_resolution_started: 'STREAM', stream_resolution_succeeded: 'STREAM', stream_resolution_failed: 'STREAM',
  player_preparing: 'PLAYER', player_ready: 'PLAYER', first_frame: 'PLAYER', playback_started: 'PLAYER', playback_stopped: 'PLAYER', playback_completed: 'PLAYER', playback_error: 'PLAYER',
  buffer_start: 'BUFFERING', buffering_started: 'BUFFERING', buffer_end: 'BUFFERING', buffering_ended: 'BUFFERING',
  network_request_failure: 'NETWORK', route_changed: 'APP', app_launch: 'APP', app_backgrounded: 'APP',
};

export type DiagnosticTone = 'good' | 'warning' | 'problem' | 'unknown';

export function diagnosticEventLabel(eventType: unknown) {
  const value = String(eventType ?? '');
  return DIAGNOSTIC_EVENT_LABELS[value] ?? (value.replace(/_/g, ' ') || 'Diagnostic event');
}

export function diagnosticEventStage(eventType: unknown) {
  const value = String(eventType ?? '');
  return DIAGNOSTIC_EVENT_STAGES[value] ?? 'APP';
}

export function diagnosticEventStatus(eventType: unknown) {
  const value = String(eventType ?? '');
  if (value.endsWith('_failed') || ['playback_error', 'network_request_failure', 'source_timeout', 'decoder_error'].includes(value)) return 'ERROR';
  if (value.includes('buffer')) return 'WARNING';
  return 'INFO';
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
