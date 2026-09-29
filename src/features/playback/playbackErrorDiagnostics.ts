export type PlaybackErrorContext = {
  playerState?: string | null;
  isPlaying?: boolean | null;
  positionSeconds?: number | null;
  streamUrl?: unknown;
};

export type PlaybackErrorDiagnostics = {
  nativeErrorCode?: string;
  nativeErrorName?: string;
  nativeErrorType?: string;
  nativeErrorMessage?: string;
  underlyingCause?: string;
  exoPlayerErrorCode?: string;
  exoPlayerErrorCodeName?: string;
  httpStatus?: number;
  rendererError?: string;
  dataSourceError?: string;
  playerState?: string;
  isPlaying?: boolean;
  playbackPositionSeconds?: number;
  errorClassification?: 'http' | 'network' | 'timeout' | 'dns' | 'source' | 'decoder' | 'renderer' | 'unsupported_format' | 'provider' | 'player' | 'unknown';
  streamProtocol?: string;
  streamExtension?: string;
  mimeType?: string;
  networkConnected?: boolean | null;
  networkType?: string;
};

const MAX_TEXT = 240;

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : undefined;
}

function sanitizeErrorText(value: string | undefined) {
  if (!value) return undefined;
  return value
    .replace(/https?:\/\/[^\s"']+/gi, '[redacted-url]')
    .replace(/((?:username|password|passwd|token|auth|bearer|api[_ -]?key)=)[^&\s]+/gi, '$1***')
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer ***')
    .slice(0, MAX_TEXT);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function findNested(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 2 || !value || typeof value !== 'object') return undefined;
  const current = record(value);
  for (const key of keys) if (current[key] != null) return current[key];
  for (const child of Object.values(current)) {
    const found = findNested(child, keys, depth + 1);
    if (found != null) return found;
  }
  return undefined;
}

function errorMessage(error: unknown) {
  if (typeof error === 'string') return error.slice(0, MAX_TEXT);
  if (error instanceof Error) return `${error.name} ${error.message}`.slice(0, MAX_TEXT);
  const current = record(error);
  return text(current.message) ?? text(current.localizedMessage) ?? text(error) ?? '';
}

function httpStatusFrom(value: string) {
  const match = value.match(/(?:response\s*code|http|status(?:\s*code)?)\D{0,12}(\d{3})|\b(401|403|404|408|429|5\d{2})\b/i);
  const parsed = Number(match?.[1] ?? match?.[2]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function safeStreamFields(value: unknown) {
  if (typeof value !== 'string') return {};
  try {
    const url = new URL(value);
    const extension = url.pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
    return { streamProtocol: url.protocol.replace(':', ''), ...(extension ? { streamExtension: `.${extension}` } : {}) };
  } catch {
    return {};
  }
}

export function extractPlaybackErrorDiagnostics(error: unknown, context: PlaybackErrorContext = {}): PlaybackErrorDiagnostics {
  const message = errorMessage(error);
  const cause = findNested(error, ['cause', 'underlyingCause', 'reason']);
  const causeText = text(typeof cause === 'string' ? cause : record(cause).message);
  const combined = `${message} ${causeText ?? ''}`.toLowerCase();
  const safeMessage = sanitizeErrorText(message);
  const safeCauseText = sanitizeErrorText(causeText);
  const code = text(findNested(error, ['code', 'errorCode', 'nativeErrorCode']));
  const name = error instanceof Error ? text(error.name) : text(findNested(error, ['name', 'errorName', 'nativeErrorName']));
  const type = text(findNested(error, ['type', 'errorType']));
  const exoName = `${combined} ${code ?? ''}`.match(/\b(ERROR_CODE_[A-Z0-9_]+)\b/i)?.[1];
  const status = httpStatusFrom(message);
  const renderer = sanitizeErrorText(text(findNested(error, ['rendererError', 'rendererException'])));
  const dataSource = sanitizeErrorText(text(findNested(error, ['dataSourceError', 'dataSourceException'])));
  let classification: PlaybackErrorDiagnostics['errorClassification'] = 'unknown';
  if (status != null) classification = 'http';
  else if (/dns|unknownhost|name.?not.?resolved|getaddrinfo/.test(combined)) classification = 'dns';
  else if (/timeout|timed.?out|deadline/.test(combined)) classification = 'timeout';
  else if (/decoder|decode|codec|mediacodec/.test(combined)) classification = 'decoder';
  else if (/renderer|render/.test(combined) || renderer) classification = 'renderer';
  else if (/unsupported|not.?support|format.?not/.test(combined)) classification = 'unsupported_format';
  else if (/http|network|connection|socket|reset|unreachable|offline|ioexception/.test(combined)) classification = 'network';
  else if (/source|load|manifest|media.?item/.test(combined)) classification = 'source';
  else if (/provider|authorization|forbidden|unauthorized/.test(combined)) classification = 'provider';
  else if (message || code || name) classification = 'player';
  return {
    ...(code ? { nativeErrorCode: code } : {}),
    ...(name ? { nativeErrorName: name } : {}),
    ...(type ? { nativeErrorType: type } : {}),
    ...(safeMessage ? { nativeErrorMessage: safeMessage } : {}),
    ...(safeCauseText ? { underlyingCause: safeCauseText } : {}),
    ...(exoName ? { exoPlayerErrorCodeName: exoName.toUpperCase() } : {}),
    ...(status != null ? { httpStatus: status } : {}),
    ...(renderer ? { rendererError: renderer } : {}),
    ...(dataSource ? { dataSourceError: dataSource } : {}),
    ...(context.playerState ? { playerState: context.playerState } : {}),
    ...(typeof context.isPlaying === 'boolean' ? { isPlaying: context.isPlaying } : {}),
    ...(typeof context.positionSeconds === 'number' && Number.isFinite(context.positionSeconds) ? { playbackPositionSeconds: Math.max(0, context.positionSeconds) } : {}),
    errorClassification: classification,
    ...safeStreamFields(context.streamUrl),
    ...((text(findNested(error, ['mimeType', 'contentType'])) ?? '').match(/^[\w.+-]+\/[\w.+-]+$/) ? { mimeType: text(findNested(error, ['mimeType', 'contentType'])) } : {}),
  };
}
