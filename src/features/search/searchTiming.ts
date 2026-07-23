export type SearchTimingStage =
  | 'index-scan'
  | 'index-map'
  | 'provider-fallback'
  | 'global-grouped'
  | 'scope-complete';

export type SearchTimingMetric = {
  stage: SearchTimingStage;
  scope?: string;
  queryLength: number;
  repository: 'index' | 'provider' | 'none';
  candidateCount?: number;
  returnedCount?: number;
  queryDurationMs: number;
  mappingDurationMs?: number;
  totalDurationMs: number;
  cancelled?: boolean;
  timedOut?: boolean;
  indexSize?: number;
};

function safeLog(message: string, payload: SearchTimingMetric) {
  console.info(message, payload);
}

export function logSearchTiming(payload: SearchTimingMetric) {
  safeLog('[NovaCast Search]', payload);
}

export async function withSearchTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function createSearchTimer() {
  const startedAt = Date.now();
  return {
    elapsed() {
      return Date.now() - startedAt;
    },
  };
}
