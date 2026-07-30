export type PlaybackEndpointFamily = 'live' | 'movie' | 'series';

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function streamIdType(streamId: string | number) {
  if (typeof streamId === 'number') return 'number';
  return /^\d+$/.test(String(streamId).trim()) ? 'numeric-string' : 'string';
}

export function normalizePlaybackExtension(extension: string | undefined, fallback: string) {
  const raw = String(extension ?? '').trim().toLowerCase().replace(/[?#].*$/, '');
  const lastSegment = raw.split('/').pop() ?? '';
  const value = lastSegment.replace(/^\.+/, '').split('.').pop() ?? '';
  return value || fallback;
}

/**
 * Canonical movie container-extension resolver.
 *
 * Resolution order:
 * 1. `vodInfoContainerExtension` – from `get_vod_info.movie_data.container_extension`
 * 2. `listContainerExtension` – from the VOD list response `container_extension`
 * 3. Bounded fallback set (up to 2–3 unique extensions)
 *
 * Normalization:
 * - Trims whitespace
 * - Converts to lowercase
 * - Removes leading `.`
 * - Removes duplicated suffixes (e.g. `mp4.mp4` → `mp4`)
 * - Removes query strings and fragments
 * - Rejects path separators, unsafe characters
 * - Permits only short alphanumeric container values
 */
export function resolveMovieContainerExtension(
  vodInfoContainerExtension: string | undefined | null,
  listContainerExtension: string | undefined | null,
): string | null {
  // Try VOD-info extension first (most authoritative)
  const vodExt = normalizeSingleExtension(vodInfoContainerExtension);
  if (vodExt) {
    return vodExt;
  }

  // Try list extension second
  const listExt = normalizeSingleExtension(listContainerExtension);
  if (listExt) {
    return listExt;
  }

  return null;
}

/**
 * Normalize a single extension value.
 * Returns null if the value is empty, unsafe, or invalid.
 */
export function normalizeSingleExtension(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  let normalized = String(value)
    .trim()
    .toLowerCase();

  // Remove query strings and fragments
  normalized = normalized.replace(/[?#].*$/, '');

  // Reject path separators
  if (normalized.includes('/') || normalized.includes('\\')) {
    return null;
  }

  // Remove leading dots
  normalized = normalized.replace(/^\.+/, '');

  // Remove duplicated suffixes (e.g. mp4.mp4 -> mp4, mkv.mkv -> mkv)
  const parts = normalized.split('.');
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    if (last === secondLast) {
      normalized = last;
    } else {
      normalized = last;
    }
  }

  // Reject empty after normalization
  if (!normalized) {
    return null;
  }

  // Reject unsafe characters (only allow alphanumeric and hyphens)
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    return null;
  }

  // Reject values that are too long for a container extension
  if (normalized.length > 10) {
    return null;
  }

  return normalized;
}

/**
 * Bounded fallback extensions for movie playback.
 * Used when the provider does not supply a valid container extension.
 * Ordered by likelihood of success on Xtream providers.
 */
export const MOVIE_FALLBACK_EXTENSIONS: readonly string[] = ['mp4', 'mkv', 'ts'] as const;

/**
 * Maximum number of internal extension retry attempts.
 */
export const MAX_MOVIE_EXTENSION_RETRIES = 3;

export function logPlaybackSourceDiagnostics(input: {
  mediaType: PlaybackEndpointFamily;
  url: string;
  streamId: string | number;
  extensionRaw?: string | null;
  extensionSource?: 'container' | 'fallback' | 'explicit' | 'unknown';
  retryCount?: number;
  playerGenerationId?: number;
  sourceShape?: string;
}) {
  let protocol = 'invalid';
  let hostnameHash = 'invalid';
  let pathSegmentCount = 0;
  let finalExtension = '';
  let credentialsPresentInExpectedPathPositions = false;
  try {
    const parsed = new URL(input.url);
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    const endpointIndex = pathSegments.indexOf(input.mediaType);
    protocol = parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.protocol.slice(0, -1) : 'other';
    hostnameHash = stableHash(parsed.hostname);
    pathSegmentCount = pathSegments.length;
    credentialsPresentInExpectedPathPositions = endpointIndex >= 0 &&
      Boolean(pathSegments[endpointIndex + 1]) && Boolean(pathSegments[endpointIndex + 2]);
    const finalPathSegment = pathSegments.at(-1) ?? '';
    finalExtension = finalPathSegment.includes('.')
      ? finalPathSegment.slice(finalPathSegment.lastIndexOf('.') + 1).toLowerCase()
      : '';
  } catch {
    // Keep diagnostics safe and structured when the source is malformed.
  }

  console.info('[NovaCast Playback Source]', {
    mediaType: input.mediaType,
    endpointFamily: input.mediaType,
    protocol,
    hostnameHash,
    pathSegmentCount,
    finalExtension,
    extensionSource: input.extensionSource ?? 'unknown',
    extensionRawPresent: Boolean(String(input.extensionRaw ?? '').trim()),
    credentialsPresentInExpectedPathPositions,
    streamIdType: streamIdType(input.streamId),
    streamIdNonempty: String(input.streamId).trim().length > 0,
    sourceObjectShape: input.sourceShape ?? 'string',
    retryCount: input.retryCount ?? 0,
    playerGenerationId: input.playerGenerationId,
  });
}

/** Movie-only attempt ledger — never logs URLs, credentials, or titles. */
const movieAttemptStartedAt = new Map<string, number>();

export function beginMoviePlaybackAttemptDiag(streamId: string | number) {
  const key = String(streamId).trim() || 'unknown';
  movieAttemptStartedAt.set(key, Date.now());
  console.info('[NovaCast Movie Playback Attempt]', {
    event: 'begin',
    streamIdType: streamIdType(streamId),
    streamIdNonempty: key !== 'unknown',
  });
}

export function endMoviePlaybackAttemptDiag(input: {
  streamId: string | number;
  nativeStatus?: string;
  errorCategory?: string;
  outcome: 'started' | 'error' | 'timeout' | 'cancelled';
}) {
  const key = String(input.streamId).trim() || 'unknown';
  const startedAt = movieAttemptStartedAt.get(key);
  const timeToOutcomeMs = startedAt != null ? Math.max(0, Date.now() - startedAt) : null;
  movieAttemptStartedAt.delete(key);
  console.info('[NovaCast Movie Playback Attempt]', {
    event: 'end',
    outcome: input.outcome,
    nativeStatus: input.nativeStatus ?? null,
    errorCategory: input.errorCategory ?? null,
    timeToOutcomeMs,
    streamIdType: streamIdType(input.streamId),
  });
}
