export const NOVACAST_MIN_SPLASH_DURATION_MS = 5_500;

export function getStartupSplashRemainingMs(
  startedAt: number,
  now = Date.now(),
  minimumDurationMs = NOVACAST_MIN_SPLASH_DURATION_MS,
) {
  return Math.max(0, minimumDurationMs - Math.max(0, now - startedAt));
}
