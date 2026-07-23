type MoviesPlaybackDiagPayload = Record<string, unknown>;

/** Release-safe Movies playback tracing (shows in logcat as ReactNativeJS). */
export function logMoviesPlayback(event: string, payload: MoviesPlaybackDiagPayload = {}) {
  console.warn('[NovaCast Movies Playback]', event, JSON.stringify(payload));
}
