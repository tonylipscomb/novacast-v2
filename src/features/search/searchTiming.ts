import { isNovaCastTraceLoggingEnabled } from '../diagnostics/novacastLogPolicy.ts';

export type SearchTimingStage =
  | 'index-scan'
  | 'index-map'
  | 'provider-fallback'
  | 'sqlite'
  | 'global-grouped'
  | 'scope-complete';

export type SearchTimingMetric = {
  stage: SearchTimingStage;
  scope?: string;
  queryLength: number;
  repository: 'index' | 'provider' | 'sqlite' | 'none';
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
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(message, payload);
}

export function logSearchTiming(payload: SearchTimingMetric) {
  safeLog('[NovaCast Search]', payload);
}

export async function withSearchTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  // search-s3-cancellable-series
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;

  try {
    const racers: Promise<T>[] = [
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ];

    if (signal) {
      racers.push(
        new Promise<T>((_, reject) => {
          abortHandler = () => reject(new DOMException('Aborted', 'AbortError'));
          signal.addEventListener('abort', abortHandler, { once: true });
        }),
      );
    }

    return await Promise.race(racers);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
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
