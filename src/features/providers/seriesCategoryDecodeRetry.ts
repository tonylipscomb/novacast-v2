import { readXtreamFailureDetails, shouldRetryXtreamCategoryFetch } from './xtreamTransientRetry.ts';

export const SERIES_CATEGORY_DECODE_MAX_ATTEMPTS = 3;
export const SERIES_CATEGORY_DECODE_BACKOFF_MS = [300, 800];

export type SeriesCategoryDecodeClassification =
  | 'ok'
  | 'truncated_or_incomplete_json'
  | 'retryable-truncated-json'
  | 'non-retryable-malformed-json'
  | 'empty_body'
  | 'timeout_or_abort'
  | 'network_failure'
  | 'http_auth'
  | 'http_retryable'
  | 'http_other'
  | 'response_too_large'
  | 'schema_validation'
  | 'cancelled'
  | 'unknown';

export type SeriesCategoryDecodeFailure = {
  classification: SeriesCategoryDecodeClassification;
  retryable: boolean;
  httpStatus: number | null;
  bytesRead: number | null;
  rawSeen: number | null;
  errorReason: string;
  errorMessage: string;
};

type JsonParserFailureKind = 'eof' | 'unterminated' | 'separator' | 'lenient' | 'other-malformed';

function parseJsonErrorColumn(text: string): number | null {
  const match = /column\s+(\d+)/i.exec(text);
  if (!match) {
    return null;
  }
  const column = Number(match[1]);
  return Number.isFinite(column) && column > 0 ? column : null;
}

function isNearResponseEnd(column: number | null, bytesRead: number | null): boolean {
  if (column == null || bytesRead == null || bytesRead <= 0) {
    return false;
  }
  const slack = Math.max(2048, Math.floor(bytesRead * 0.02));
  return column <= bytesRead + 64 && bytesRead - column <= slack;
}

function classifyJsonParserFailureKind(text: string): JsonParserFailureKind | null {
  if (/end of input/i.test(text)) {
    return 'eof';
  }
  if (/unterminated (object|array)\b/i.test(text)) {
    return 'unterminated';
  }
  if (/expected\s*':'/i.test(text) || /expected\s*','\s*or\s*['"]?[}\]]/i.test(text)) {
    return 'separator';
  }
  if (/setLenient|malformed json/i.test(text)) {
    return 'lenient';
  }
  if (/expected name|expected value|invalid (json|syntax)|syntax error/i.test(text)) {
    return 'other-malformed';
  }
  return null;
}

function isRetryableTruncatedParserFailure(input: {
  message: string;
  errorReason: string;
  rawSeen: number | null;
  bytesRead: number | null;
}): boolean {
  const text = `${input.message}\n${input.errorReason}`;
  const kind = classifyJsonParserFailureKind(text);
  if (!kind || kind === 'other-malformed') {
    return false;
  }
  const rawSeen = input.rawSeen ?? 0;
  const nearEnd = isNearResponseEnd(parseJsonErrorColumn(text), input.bytesRead);
  if (kind === 'eof' || kind === 'unterminated') {
    return rawSeen > 0 || nearEnd || (input.bytesRead ?? 0) > 0;
  }
  return nearEnd && (rawSeen > 0 || (input.bytesRead ?? 0) > 0);
}

function isDeterministicMalformedParserFailure(input: {
  message: string;
  errorReason: string;
  rawSeen: number | null;
  bytesRead: number | null;
}): boolean {
  const text = `${input.message}\n${input.errorReason}`;
  const kind = classifyJsonParserFailureKind(text);
  if (!kind) {
    return false;
  }
  return !isRetryableTruncatedParserFailure(input);
}

const SCHEMA_ERROR_REASONS = new Set([
  'top_level_object_not_supported',
  'unsupported_top_level_token',
  'series_sanitizer_threshold_exceeded',
]);

export function logSeriesCategoryRetryProbe(fields: Record<string, unknown>) {
  console.info(
    '[NovaCast Series Category Retry Probe]',
    JSON.stringify({
      mediaType: 'series',
      ...fields,
    }),
  );
}

export function isSeriesCategoryDecodeCancelled(error: unknown): boolean {
  return classifySeriesCategoryDecodeFailure(error).classification === 'cancelled';
}

export function classifySeriesCategoryDecodeFailure(error: unknown): SeriesCategoryDecodeFailure {
  const record =
    error && typeof error === 'object'
      ? (error as {
          errorReason?: string;
          httpStatus?: number | null;
          bytesRead?: number | null;
          rawSeen?: number | null;
          message?: string;
        })
      : {};
  const message = error instanceof Error ? error.message : String(error);
  const errorReason = typeof record.errorReason === 'string' && record.errorReason ? record.errorReason : message;
  const httpStatus = typeof record.httpStatus === 'number' ? record.httpStatus : null;
  const bytesRead = typeof record.bytesRead === 'number' ? record.bytesRead : null;
  const rawSeen = typeof record.rawSeen === 'number' ? record.rawSeen : null;
  const withMessage = (failure: Omit<SeriesCategoryDecodeFailure, 'errorMessage'>): SeriesCategoryDecodeFailure => ({
    ...failure,
    errorMessage: message,
  });

  if (errorReason === 'cancelled' || message === 'cancelled') {
    return withMessage({
      classification: 'cancelled',
      retryable: false,
      httpStatus,
      bytesRead,
      rawSeen,
      errorReason: 'cancelled',
    });
  }

  if (
    /stale_provider|native_catalog_decode_unavailable/i.test(errorReason) ||
    /stale_provider|native_catalog_decode_unavailable/i.test(message)
  ) {
    return withMessage({
      classification: 'unknown',
      retryable: false,
      httpStatus,
      bytesRead,
      rawSeen,
      errorReason,
    });
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return withMessage({
      classification: 'http_auth',
      retryable: false,
      httpStatus,
      bytesRead,
      rawSeen,
      errorReason,
    });
  }

  if (
    errorReason === 'response_too_large' ||
    /too large|oversized/i.test(errorReason) ||
    /too large|oversized/i.test(message)
  ) {
    return withMessage({
      classification: 'response_too_large',
      retryable: false,
      httpStatus,
      bytesRead,
      rawSeen,
      errorReason,
    });
  }

  if (SCHEMA_ERROR_REASONS.has(errorReason)) {
    return withMessage({
      classification: 'schema_validation',
      retryable: false,
      httpStatus,
      bytesRead,
      rawSeen,
      errorReason,
    });
  }

  if (
    errorReason === 'truncated_or_incomplete_json' ||
    errorReason === 'empty_or_truncated_json_before_first_item' ||
    errorReason === 'empty_body' ||
    /end of input/i.test(message) ||
    /end of input/i.test(errorReason)
  ) {
    return withMessage({
      classification:
        errorReason === 'empty_or_truncated_json_before_first_item' ||
        errorReason === 'empty_body' ||
        (rawSeen ?? 0) <= 0
          ? 'empty_body'
          : 'truncated_or_incomplete_json',
      retryable: true,
      httpStatus,
      bytesRead,
      rawSeen,
      errorReason,
    });
  }

  if (isRetryableTruncatedParserFailure({ message, errorReason, rawSeen, bytesRead })) {
    return withMessage({
      classification: 'retryable-truncated-json',
      retryable: true,
      httpStatus,
      bytesRead,
      rawSeen,
      errorReason,
    });
  }

  if (isDeterministicMalformedParserFailure({ message, errorReason, rawSeen, bytesRead })) {
    return withMessage({
      classification: 'non-retryable-malformed-json',
      retryable: false,
      httpStatus,
      bytesRead,
      rawSeen,
      errorReason,
    });
  }

  if (httpStatus === 408 || httpStatus === 429 || (httpStatus != null && httpStatus >= 500 && httpStatus <= 599)) {
    return withMessage({
      classification: 'http_retryable',
      retryable: true,
      httpStatus,
      bytesRead,
      rawSeen,
      errorReason,
    });
  }

  const xtream = readXtreamFailureDetails(error);
  if (
    xtream.classification === 'http_auth' ||
    xtream.classification === 'response_too_large' ||
    xtream.classification === 'http_other'
  ) {
    return withMessage({
      classification: xtream.classification,
      retryable: false,
      httpStatus: xtream.httpStatus ?? httpStatus,
      bytesRead,
      rawSeen,
      errorReason: xtream.errorReason,
    });
  }

  return withMessage({
    classification:
      xtream.classification === 'timeout_or_abort'
        ? 'timeout_or_abort'
        : xtream.classification === 'network_failure'
          ? 'network_failure'
          : xtream.classification === 'http_retryable'
            ? 'http_retryable'
            : xtream.classification === 'empty_body'
              ? 'empty_body'
              : xtream.classification === 'truncated_json'
                ? 'truncated_or_incomplete_json'
                : 'unknown',
    retryable: shouldRetryXtreamCategoryFetch(xtream),
    httpStatus: xtream.httpStatus ?? httpStatus,
    bytesRead,
    rawSeen,
    errorReason: xtream.errorReason,
  });
}

export async function retrySeriesCategoryDecode<T>(input: {
  providerId: string;
  generation: number | null;
  categoryId: string;
  categoryIndex: number;
  categoryPosition: number;
  totalCategoryCount?: number;
  work: (attempt: number) => Promise<T>;
  isCancelled?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}): Promise<T> {
  const maxAttempts = SERIES_CATEGORY_DECODE_MAX_ATTEMPTS;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (input.isCancelled?.()) {
      const cancelled = Object.assign(new Error('cancelled'), { errorReason: 'cancelled' });
      logSeriesCategoryRetryProbe({
        providerId: input.providerId,
        generation: input.generation,
        categoryId: input.categoryId,
        categoryIndex: input.categoryIndex,
        categoryPosition: input.categoryPosition,
        attempt,
        maxAttempts,
        classification: 'cancelled',
        httpStatus: null,
        bytesRead: null,
        rawSeen: null,
        willRetry: false,
        retryDelayMs: 0,
        finalOutcome: 'cancelled',
      });
      throw cancelled;
    }
    try {
      const result = await input.work(attempt);
      logSeriesCategoryRetryProbe({
        providerId: input.providerId,
        generation: input.generation,
        categoryId: input.categoryId,
        categoryIndex: input.categoryIndex,
        categoryPosition: input.categoryPosition,
        attempt,
        maxAttempts,
        classification: 'ok',
        httpStatus: null,
        bytesRead: null,
        rawSeen: null,
        willRetry: false,
        retryDelayMs: 0,
        finalOutcome: 'committed',
      });
      return result;
    } catch (error) {
      lastError = error;
      const details = classifySeriesCategoryDecodeFailure(error);
      const willRetry = attempt < maxAttempts && details.retryable && !input.isCancelled?.();
      const retryDelayMs = willRetry ? (SERIES_CATEGORY_DECODE_BACKOFF_MS[attempt - 1] ?? 800) : 0;
      logSeriesCategoryRetryProbe({
        providerId: input.providerId,
        generation: input.generation,
        categoryId: input.categoryId,
        categoryIndex: input.categoryIndex,
        categoryPosition: input.categoryPosition,
        attempt,
        maxAttempts,
        classification: details.classification,
        httpStatus: details.httpStatus,
        bytesRead: details.bytesRead,
        rawSeen: details.rawSeen,
        willRetry,
        retryDelayMs,
        finalOutcome: willRetry ? 'retrying' : details.classification === 'cancelled' ? 'cancelled' : 'failed',
        errorReason: details.errorReason,
        errorMessage: details.errorMessage,
      });
      if (!willRetry) {
        throw error;
      }
      await sleep(retryDelayMs);
    }
  }

  throw lastError;
}
