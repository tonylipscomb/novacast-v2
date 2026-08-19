import { isNovaCastTraceLoggingEnabled } from '../diagnostics/novacastLogPolicy.ts';

type MoviesPlaybackDiagPayload = Record<string, unknown>;

const MOVIES_PLAYBACK_KEEP_EVENTS = new Set([
  'launch-failed',
  'play-blocked',
  'launch-timeout',
  'select-blocked',
]);

/** Movies playback tracing. Fatal/blocked events stay in beta logcat. */
export function logMoviesPlayback(event: string, payload: MoviesPlaybackDiagPayload = {}) {
  if (!MOVIES_PLAYBACK_KEEP_EVENTS.has(event) && !isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.warn('[NovaCast Movies Playback]', event, JSON.stringify(payload));
}
