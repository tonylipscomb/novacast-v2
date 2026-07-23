/**
 * Tracks whether the fullscreen player has actually rendered a decoded
 * frame, as distinct from merely reporting a `playing`/`readyToPlay`
 * status. Some live channels reach `playing` well before the first frame is
 * decoded and composited onto the surface (startup/buffering latency varies
 * by codec, bitrate, and keyframe interval), which is what left a black
 * fullscreen surface while the player believed it was already playing.
 *
 * - 'pending': fullscreen just opened (or is retrying); no first frame yet.
 * - 'ready': `onFirstFrameRender` fired - a decoded frame is on screen.
 * - 'timeout': the bounded wait elapsed with no first frame and no error.
 * - 'error': the player reported a real playback error.
 */
export type FullscreenFrameStatus = 'pending' | 'ready' | 'timeout' | 'error';

/** Bounded wait for a first decoded frame before offering Retry/Back. */
export const FULLSCREEN_FIRST_FRAME_TIMEOUT_MS = 7000;

/**
 * The already-playing preview must stay mounted and visible for as long as
 * fullscreen has not proven it is actually showing a frame, so Back (or a
 * timeout) always has a live fallback instead of a black screen. Once
 * fullscreen is confirmed `ready`, the preview underneath (now fully
 * obscured by the opaque fullscreen overlay anyway) is released.
 */
export function shouldKeepPreviewAlive(fullscreenChannelId: string | null, frameStatus: FullscreenFrameStatus): boolean {
  return !fullscreenChannelId || frameStatus !== 'ready';
}

export function shouldShowFullscreenLoadingOverlay(frameStatus: FullscreenFrameStatus): boolean {
  return frameStatus === 'pending';
}

export function shouldShowFullscreenFallback(frameStatus: FullscreenFrameStatus): boolean {
  return frameStatus === 'timeout' || frameStatus === 'error';
}
