import type { FullscreenFrameStatus } from './liveTvPlaybackReadiness';

export const FULLSCREEN_CHROME_AUTO_HIDE_MS = 4000;

export function shouldAutoHideFullscreenChrome(frameStatus: FullscreenFrameStatus) {
  return frameStatus === 'ready';
}

export function shouldRenderFullscreenChrome(chromeVisible: boolean, frameStatus: FullscreenFrameStatus) {
  if (!shouldAutoHideFullscreenChrome(frameStatus)) {
    return true;
  }

  return chromeVisible;
}
