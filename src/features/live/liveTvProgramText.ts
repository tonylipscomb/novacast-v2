import { displayStreamTitle } from '../series/metadata/titleNormalization.ts';

const STREAM_SCHEME_PATTERN = /^(?:data|file|http|https|mms|rtmp|rtsp|udp):/i;
const STREAM_FILE_PATTERN = /\.(?:m3u8|mkv|mp4|mpeg|mpg|ts)(?:[?#]|$)/i;
const STREAM_QUERY_PATTERN = /[?&](?:auth|key|password|sig|signature|token|username)=/i;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9+/_=-]{28,}$/;

export function isRawLiveStreamValue(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return false;
  }

  return (
    STREAM_SCHEME_PATTERN.test(normalized) ||
    STREAM_FILE_PATTERN.test(normalized) ||
    STREAM_QUERY_PATTERN.test(normalized) ||
    OPAQUE_TOKEN_PATTERN.test(normalized)
  );
}

/** Shorter TV row label when EPG is missing or still loading. */
export const LIVE_TV_NO_PROGRAM_LABEL = 'No program info';

export function resolveLiveTvNowPlaying(
  program: string | null | undefined,
  channelName: string,
): string {
  const normalized = displayLiveProgramText(program, '');
  if (!normalized) {
    return LIVE_TV_NO_PROGRAM_LABEL;
  }

  const normalizedChannelName = displayStreamTitle(channelName);
  if (normalized === normalizedChannelName || normalized === channelName.trim()) {
    return LIVE_TV_NO_PROGRAM_LABEL;
  }

  return normalized;
}

/** Keep provider stream payloads out of TV-facing program metadata. */
export function displayLiveProgramText(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized || isRawLiveStreamValue(normalized)) {
    return fallback;
  }

  return displayStreamTitle(decodeDisplayTextEntities(normalized));
}

export function decodeDisplayTextEntities(value: string) {
  return value.replace(/&(?:apos|#39|#x27);/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (match, code: string) => {
      const parsed = code[0]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
      return Number.isFinite(parsed) && parsed > 0 && parsed <= 0x10ffff ? String.fromCodePoint(parsed) : match;
    });
}
