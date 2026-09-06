import { logCatalogDecodeFailure } from '../catalog/nativeCatalogDecodeShared.ts';

export const XTREAM_CATEGORY_FETCH_MAX_ATTEMPTS = 3;
const CATEGORY_FETCH_BACKOFF_MS = [300, 800];

export type XtreamFailureClassification =
  | 'empty_body'
  | 'html_or_non_json'
  | 'truncated_json'
  | 'malformed_json'
  | 'http_auth'
  | 'http_retryable'
  | 'http_other'
  | 'timeout_or_abort'
  | 'network_failure'
  | 'response_too_large'
  | 'unknown';

export type XtreamFailureDetails = {
  classification: XtreamFailureClassification;
  httpStatus: number | null;
  contentType: string | null;
  contentLength: number | null;
  errorReason: string;
};

export function createXtreamFailureError(
  message: string,
  details: XtreamFailureDetails,
): Error & XtreamFailureDetails {
  const error = new Error(message) as Error & XtreamFailureDetails;
  error.classification = details.classification;
  error.httpStatus = details.httpStatus;
  error.contentType = details.contentType;
  error.contentLength = details.contentLength;
  error.errorReason = details.errorReason;
  return error;
}

export function readXtreamFailureDetails(error: unknown): XtreamFailureDetails {
  if (error && typeof error === 'object') {
    const record = error as Partial<XtreamFailureDetails> & { name?: string; message?: string };
    if (record.classification) {
      return {
        classification: record.classification,
        httpStatus: record.httpStatus ?? null,
        contentType: record.contentType ?? null,
        contentLength: record.contentLength ?? null,
        errorReason: record.errorReason ?? record.message ?? 'unknown',
      };
    }
    const message = record.message ?? String(error);
    const statusMatch = /status (\d{3})/.exec(message);
    const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        classification: 'http_auth',
        httpStatus,
        contentType: null,
        contentLength: null,
        errorReason: message,
      };
    }
    if (httpStatus === 408 || httpStatus === 429 || httpStatus === 500 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
      return {
        classification: 'http_retryable',
        httpStatus,
        contentType: null,
        contentLength: null,
        errorReason: message,
      };
    }
    if (httpStatus) {
      return {
        classification: 'http_other',
        httpStatus,
        contentType: null,
        contentLength: null,
        errorReason: message,
      };
    }
    if (record.name === 'AbortError' || /aborted|timeout/i.test(message)) {
      return {
        classification: 'timeout_or_abort',
        httpStatus: null,
        contentType: null,
        contentLength: null,
        errorReason: message,
      };
    }
    if (record.name === 'TypeError' || /network|fetch/i.test(message)) {
      return {
        classification: 'network_failure',
        httpStatus: null,
        contentType: null,
        contentLength: null,
        errorReason: message,
      };
    }
    if (/non-JSON response/i.test(message)) {
      return {
        classification: 'malformed_json',
        httpStatus: null,
        contentType: null,
        contentLength: null,
        errorReason: message,
      };
    }
    if (/too large/i.test(message)) {
      return {
        classification: 'response_too_large',
        httpStatus: null,
        contentType: null,
        contentLength: null,
        errorReason: message,
      };
    }
  }
  return {
    classification: 'unknown',
    httpStatus: null,
    contentType: null,
    contentLength: null,
    errorReason: error instanceof Error ? error.message : String(error),
  };
}

export function classifyXtreamHttpStatus(status: number): Extract<
  XtreamFailureClassification,
  'http_auth' | 'http_retryable' | 'http_other'
> {
  if (status === 401 || status === 403) {
    return 'http_auth';
  }
  if (status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return 'http_retryable';
  }
  return 'http_other';
}

export function shouldRetryXtreamCategoryFetch(details: XtreamFailureDetails): boolean {
  if (details.classification === 'http_auth' || details.classification === 'response_too_large' || details.classification === 'http_other') {
    return false;
  }
  return (
    details.classification === 'empty_body' ||
    details.classification === 'html_or_non_json' ||
    details.classification === 'truncated_json' ||
    details.classification === 'malformed_json' ||
    details.classification === 'http_retryable' ||
    details.classification === 'timeout_or_abort' ||
    details.classification === 'network_failure'
  );
}

export function classifyNonJsonBody(text: string): Extract<
  XtreamFailureClassification,
  'empty_body' | 'html_or_non_json' | 'truncated_json' | 'malformed_json'
> {
  if (!text.trim()) {
    return 'empty_body';
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<')) {
    return 'html_or_non_json';
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'truncated_json';
  }
  return 'malformed_json';
}

export function logXtreamCategoryFetchProbe(fields: Record<string, unknown>) {
  logCatalogDecodeFailure({
    event: 'category-metadata-fetch',
    operation: 'getCategories',
    ...fields,
  });
}

export async function retryXtreamCategoryFetch<T>(input: {
  providerId?: string | null;
  mediaType: 'movie' | 'series';
  work: () => Promise<T>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<T> {
  const maxAttempts = XTREAM_CATEGORY_FETCH_MAX_ATTEMPTS;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await input.work();
      if (attempt > 1) {
        logXtreamCategoryFetchProbe({
          providerId: input.providerId ?? null,
          mediaType: input.mediaType,
          attempt,
          maxAttempts,
          errorReason: null,
          classification: 'ok',
          retried: true,
        });
      }
      return result;
    } catch (error) {
      lastError = error;
      const details = readXtreamFailureDetails(error);
      const willRetry = attempt < maxAttempts && shouldRetryXtreamCategoryFetch(details);
      logXtreamCategoryFetchProbe({
        providerId: input.providerId ?? null,
        mediaType: input.mediaType,
        attempt,
        maxAttempts,
        httpStatus: details.httpStatus,
        contentType: details.contentType,
        contentLength: details.contentLength,
        classification: details.classification,
        errorReason: details.errorReason,
        willRetry,
      });
      if (!willRetry) {
        throw error;
      }
      const delayMs = CATEGORY_FETCH_BACKOFF_MS[attempt - 1] ?? 800;
      await sleep(delayMs);
    }
  }
  throw lastError;
}
