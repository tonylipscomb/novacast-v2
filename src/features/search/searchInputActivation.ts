export const SEARCH_INPUT_ACTIVATE_DEDUPE_MS = 400;

export function shouldAcceptSearchInputActivation(lastArmedAtMs: number | null | undefined, nowMs: number, dedupeMs = SEARCH_INPUT_ACTIVATE_DEDUPE_MS) {
  if (lastArmedAtMs == null || lastArmedAtMs <= 0) {
    return true;
  }
  return nowMs - lastArmedAtMs >= dedupeMs;
}

export type SearchInputActivationResult = 'armed' | 'duplicate-suppressed';

export function createSearchInputActivationGate(dedupeMs = SEARCH_INPUT_ACTIVATE_DEDUPE_MS) {
  let lastArmedAtMs = 0;

  return {
    tryArm(nowMs = Date.now()): SearchInputActivationResult {
      if (!shouldAcceptSearchInputActivation(lastArmedAtMs, nowMs, dedupeMs)) {
        return 'duplicate-suppressed';
      }
      lastArmedAtMs = nowMs;
      return 'armed';
    },
    reset() {
      lastArmedAtMs = 0;
    },
  };
}
