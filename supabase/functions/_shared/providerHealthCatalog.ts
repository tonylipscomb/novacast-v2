export const CATALOG_READ_LIMIT_BYTES = 128 * 1024 * 1024;
export const CATALOG_ITEM_SCAN_LIMIT = 12_000;
export const CATALOG_SAMPLE_LIMIT = 40;
export const CATALOG_UNPARSED_TAIL_LIMIT = 512 * 1024;

export type CatalogFailureReason =
  | 'catalog_timeout'
  | 'catalog_http'
  | 'catalog_html'
  | 'catalog_invalid_json'
  | 'catalog_unexpected_shape'
  | 'catalog_payload_too_large'
  | 'catalog_empty';

export type CatalogStopReason =
  | 'complete'
  | 'byte_limit'
  | 'timeout'
  | 'upstream_incomplete'
  | 'fallback_sample'
  | 'parse_failure';

export type CatalogScanResult = {
  ok: boolean;
  reason: 'ok' | CatalogFailureReason;
  detail: string;
  items: Record<string, unknown>[];
  count: number;
  totalCount: number | null;
  inspectedCount: number;
  exactCountAvailable: boolean;
  diagnosticTruncated: boolean;
  stopReason: CatalogStopReason;
  truncated: boolean;
  complete: boolean;
  bytesRead: number;
  httpStatus?: number | null;
  latencyMs?: number;
};

export function catalogDiagnosticMessage(
  reason: CatalogScanResult['reason'],
  extra: { httpStatus?: number | null; limitBytes?: number; count?: number } = {},
) {
  const limitMb = Math.round((extra.limitBytes ?? CATALOG_READ_LIMIT_BYTES) / (1024 * 1024));
  switch (reason) {
    case 'ok':
      return extra.count != null ? `Parsed ${extra.count} catalog records.` : 'Catalog parsed.';
    case 'catalog_timeout':
      return 'Catalog request timed out.';
    case 'catalog_http':
      return `Catalog request returned HTTP ${extra.httpStatus ?? 'error'}.`;
    case 'catalog_html':
      return 'Catalog endpoint returned an HTML/login page instead of JSON.';
    case 'catalog_invalid_json':
      return 'Catalog returned malformed JSON.';
    case 'catalog_unexpected_shape':
      return 'Catalog returned an unexpected response shape.';
    case 'catalog_payload_too_large':
      return `Catalog response exceeded the ${limitMb} MB validation read limit before a complete record could be parsed.`;
    case 'catalog_empty':
      return 'Catalog JSON was valid but contained no records.';
    default:
      return 'Catalog request failed.';
  }
}

export function createXtreamCatalogScanner(options: {
  sampleSize?: number;
  maxItems?: number;
  maxBytes?: number;
  keepAll?: boolean;
} = {}) {
  const sampleSize = options.sampleSize ?? CATALOG_SAMPLE_LIMIT;
  const maxItems = options.maxItems ?? CATALOG_ITEM_SCAN_LIMIT;
  const maxBytes = options.maxBytes ?? CATALOG_READ_LIMIT_BYTES;
  const keepAll = options.keepAll === true;
  const decoder = new TextDecoder();
  let buffer = '';
  let bytesRead = 0;
  let totalCount = 0;
  let inspectedCount = 0;
  let samples: Record<string, unknown>[] = [];
  let lastItems: Record<string, unknown>[] = [];
  let arrayStarted = false;
  let finished = false;
  let truncated = false;
  let diagnosticTruncated = false;
  let complete = false;
  let reason: CatalogScanResult['reason'] = 'ok';
  let httpStatus: number | null = null;

  const fail = (next: CatalogFailureReason) => {
    if (reason === 'ok') reason = next;
    finished = true;
  };

  const consider = (item: Record<string, unknown>) => {
    totalCount += 1;
    if (inspectedCount >= maxItems) {
      diagnosticTruncated = true;
      return;
    }
    inspectedCount += 1;
    if (keepAll) {
      samples.push(item);
      return;
    }
    if (samples.length < Math.min(8, sampleSize)) {
      samples.push(item);
    } else if (totalCount % 47 === 0 && samples.length < sampleSize - 8) {
      samples.push(item);
    }
    lastItems = [...lastItems, item].slice(-8);
  };

  const processBuffer = (flush: boolean) => {
    if (finished && !flush) return;
    let index = 0;
    const skipSpace = () => {
      while (index < buffer.length && /\s/.test(buffer[index]!)) index += 1;
    };

    if (!arrayStarted) {
      skipSpace();
      if (index >= buffer.length) {
        if (flush && buffer.trim()) fail(looksLikeHtml(buffer) ? 'catalog_html' : 'catalog_invalid_json');
        return;
      }
      const lead = buffer.slice(index, index + 32).trimStart();
      if (looksLikeHtml(lead)) {
        fail('catalog_html');
        buffer = '';
        return;
      }
      if (lead[0] === '[') {
        arrayStarted = true;
        index += 1;
      } else if (lead[0] === '{') {
        const bracket = findArrayStart(buffer, index);
        if (bracket < 0) {
          if (flush) {
            tryUnwrapObject(buffer.slice(index));
          } else if (buffer.length > CATALOG_UNPARSED_TAIL_LIMIT) {
            fail(truncated ? 'catalog_payload_too_large' : 'catalog_unexpected_shape');
          }
          return;
        }
        arrayStarted = true;
        index = bracket + 1;
      } else if (flush) {
        fail('catalog_invalid_json');
        return;
      } else {
        return;
      }
    }

    while (index < buffer.length) {
      skipSpace();
      if (index >= buffer.length) break;
      if (buffer[index] === ',') {
        index += 1;
        continue;
      }
      if (buffer[index] === ']') {
        complete = true;
        finished = true;
        index += 1;
        break;
      }
      if (buffer[index] !== '{') {
        if (flush) fail('catalog_unexpected_shape');
        break;
      }
      const end = findMatchingBrace(buffer, index);
      if (end < 0) break;
      const raw = buffer.slice(index, end + 1);
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          consider(parsed as Record<string, unknown>);
        }
      } catch {
        fail('catalog_invalid_json');
        break;
      }
      index = end + 1;
    }
    buffer = buffer.slice(index);
    if (buffer.length > CATALOG_UNPARSED_TAIL_LIMIT) {
      fail(truncated ? 'catalog_payload_too_large' : 'catalog_invalid_json');
      buffer = '';
    }
  };

  const tryUnwrapObject = (text: string) => {
    try {
      const parsed = JSON.parse(text) as unknown;
      const rows = unwrapCatalogRows(parsed);
      if (rows) {
        arrayStarted = true;
        complete = true;
        finished = true;
        for (const row of rows) {
          if (row && typeof row === 'object' && !Array.isArray(row)) consider(row);
        }
        buffer = '';
        return;
      }
      fail('catalog_unexpected_shape');
    } catch {
      fail(truncated ? 'catalog_payload_too_large' : 'catalog_invalid_json');
    }
  };

  return {
    get bytesRead() {
      return bytesRead;
    },
    get count() {
      return inspectedCount;
    },
    get finished() {
      return finished;
    },
    get complete() {
      return complete;
    },
    setHttpStatus(status: number) {
      httpStatus = status;
    },
    push(chunk: Uint8Array) {
      if (finished) return;
      const remaining = maxBytes - bytesRead;
      if (remaining <= 0) {
        truncated = true;
        finished = true;
        return;
      }
      const next = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
      if (next.byteLength < chunk.byteLength) truncated = true;
      bytesRead += next.byteLength;
      buffer += decoder.decode(next, { stream: true });
      processBuffer(false);
      if (bytesRead >= maxBytes && !complete) {
        truncated = true;
        finished = true;
      }
    },
    finish(inputTruncated = truncated, forcedStopReason?: CatalogStopReason): CatalogScanResult {
      buffer += decoder.decode();
      const inputEndedIncomplete = inputTruncated;
      if (!finished) processBuffer(true);
      if (!keepAll && lastItems.length) {
        const seen = new Set(samples);
        for (const item of lastItems) {
          if (seen.has(item) || samples.length >= sampleSize) continue;
          samples.push(item);
          seen.add(item);
        }
      }
      if (reason === 'ok' && totalCount === 0) {
        if (complete) reason = 'catalog_empty';
        else if (truncated) reason = 'catalog_payload_too_large';
        else if (!arrayStarted) reason = looksLikeHtml(buffer) ? 'catalog_html' : 'catalog_invalid_json';
        else reason = 'catalog_invalid_json';
      }
      const ok = reason === 'ok' && totalCount > 0;
      const exactCountAvailable = ok && complete && !truncated && !inputEndedIncomplete;
      const stopReason = forcedStopReason ?? (
        exactCountAvailable ? 'complete' :
          truncated ? 'byte_limit' :
            inputEndedIncomplete ? 'upstream_incomplete' :
              reason !== 'ok' ? 'parse_failure' : 'upstream_incomplete'
      );
      return {
        ok,
        reason: ok ? 'ok' : reason,
        detail: catalogDiagnosticMessage(ok ? 'ok' : reason, { httpStatus, limitBytes: maxBytes, count: exactCountAvailable ? totalCount : inspectedCount }),
        items: samples,
        count: inspectedCount,
        totalCount: exactCountAvailable ? totalCount : null,
        inspectedCount,
        exactCountAvailable,
        diagnosticTruncated: diagnosticTruncated || totalCount > inspectedCount,
        stopReason,
        truncated,
        complete,
        bytesRead,
        httpStatus,
      };
    },
  };
}

export function parseXtreamCatalogText(
  text: string,
  options: { truncatedInput?: boolean; maxBytes?: number; maxItems?: number; sampleSize?: number; keepAll?: boolean } = {},
) {
  const scanner = createXtreamCatalogScanner(options);
  scanner.push(new TextEncoder().encode(text));
  return scanner.finish(Boolean(options.truncatedInput));
}

function looksLikeHtml(value: string) {
  const lead = value.trimStart().slice(0, 64);
  return /^<!doctype html|<html|<head|<body|login/i.test(lead);
}

function findArrayStart(text: string, from: number) {
  let inString = false;
  let escape = false;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '[') return index;
  }
  return -1;
}

function findMatchingBrace(text: string, from: number) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function unwrapCatalogRows(parsed: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(parsed)) {
    return parsed.filter((row) => row && typeof row === 'object' && !Array.isArray(row)) as Record<string, unknown>[];
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  for (const key of ['js', 'data', 'streams', 'movies', 'series', 'results', 'available_channels']) {
    if (Array.isArray(record[key])) {
      return unwrapCatalogRows(record[key]);
    }
  }
  return null;
}
