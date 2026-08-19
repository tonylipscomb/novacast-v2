/**
 * Movies-only playback compatibility / recovery policy.
 *
 * Xtream typically exposes one VOD stream per movie id:
 *   {base}/movie/{user}/{pass}/{streamId}.{container_extension}
 * Changing `.mkv` → `.mp4` usually only rewrites the URL suffix; it does not
 * select a different encode. Do not invent a lower-quality URL.
 *
 * Media3/ExoPlayer software decoder fallback is not enabled here. Hardware HEVC
 * (`OMX.MTK.VIDEO.DECODER.HEVC`) can fail configure on low-end Fire TV. Forcing
 * 4K HEVC software decode on those sticks is worse than a clear unsupported error.
 *
 * Capability querying (MediaCodecList) is not available in this Expo layer.
 * When source width/height are missing, runtime decoder-init failure remains the
 * source of truth. When metadata shows >1080p on a conservative FHD/low-end
 * profile, block before playback so a technically-successful 4K decode cannot
 * sit in an unusable choppy state.
 */

export const UNSUPPORTED_VIDEO_FORMAT_ERROR = "This video format isn't supported on this device.";
export const UNSUPPORTED_VIDEO_FORMAT_DETAIL = 'Try another version or device.';
export const DEVICE_PERFORMANCE_RISK_ERROR = 'This video is too demanding for this device.';
export const DEVICE_PERFORMANCE_RISK_DETAIL = 'Try another version or a higher-performance device.';
export const UNSUPPORTED_VIDEO_FORMAT_CATEGORY = 'unsupported-video-format';
export const DEVICE_PERFORMANCE_RISK_REASON = 'device-performance-risk';
export const MAX_MOVIE_COMPATIBILITY_FALLBACK_ATTEMPTS = 1;
export const FHD_MAX_WIDTH = 1920;
export const FHD_MAX_HEIGHT = 1080;

export type MoviePlaybackCompatibilityEvent =
  | 'device-profile'
  | 'source-inspected'
  | 'codec-risk-detected'
  | 'resolution-risk-detected'
  | 'preplay-blocked'
  | 'decoder-failure'
  | 'fallback-source-found'
  | 'fallback-start'
  | 'fallback-success'
  | 'fallback-unavailable'
  | 'unsupported-device-format';

export type MoviePlaybackCompatibilityLog = {
  event: MoviePlaybackCompatibilityEvent;
  codec?: string | null;
  width?: number | null;
  height?: number | null;
  container?: string | null;
  fallbackAttempt?: number;
  displayWidth?: number | null;
  displayHeight?: number | null;
  platform?: string | null;
  conservativePlayback?: boolean;
  reason?: string | null;
};

export type DevicePlaybackSignals = {
  displayWidth?: number | null;
  displayHeight?: number | null;
  os?: string | null;
  isTv?: boolean | null;
  manufacturer?: string | null;
  model?: string | null;
  brand?: string | null;
  apiLevel?: number | null;
  deviceType?: string | number | null;
};

export type DevicePlaybackProfile = {
  displayWidth: number | null;
  displayHeight: number | null;
  platform: 'android-tv' | 'android' | 'ios' | 'web' | 'unknown';
  manufacturer: string | null;
  model: string | null;
  apiLevel: number | null;
  conservativePlayback: boolean;
};

export type MoviePreplayDecision =
  | { action: 'play' }
  | { action: 'fallback'; source: MovieCompatibilityFallbackSource }
  | { action: 'block'; reason: 'source-exceeds-device-profile' };

export type MoviePlaybackSourceProbe = {
  codec: string | null;
  width: number | null;
  height: number | null;
  container: string | null;
  bitrate: number | null;
  hasDirectSource: boolean;
  directSourceKind: 'none' | 'hls' | 'http-other';
};

export type MovieCompatibilityFallbackSource = {
  streamUrl: string;
  container: string | null;
  reason: 'direct-source-hls' | 'direct-source-other';
};

export type MovieCompatibilityErrorDecision =
  | { action: 'passthrough' }
  | { action: 'fallback'; source: MovieCompatibilityFallbackSource }
  | { action: 'unsupported' };

type XtreamVideoObject = {
  codec_name?: unknown;
  codec?: unknown;
  video_codec?: unknown;
  profile?: unknown;
  width?: unknown;
  height?: unknown;
  coded_width?: unknown;
  coded_height?: unknown;
  bit_rate?: unknown;
  bitrate?: unknown;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stringifyError(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return `${error.name} ${error.message}`;
  }
  if (error && typeof error === 'object') {
    const record = error as { name?: unknown; message?: unknown; code?: unknown };
    return [record.name, record.message, record.code].filter(Boolean).join(' ');
  }
  return String(error ?? '');
}

function normalizeCodec(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const lowered = value.toLowerCase();
  if (/hevc|h\.?\s*265|hvc1|hev1/.test(lowered)) {
    return 'hevc';
  }
  if (/avc|h\.?\s*264|avc1/.test(lowered)) {
    return 'avc';
  }
  if (/av1|vp9|mpeg/.test(lowered)) {
    return lowered.replace(/[^a-z0-9]+/g, '').slice(0, 16) || null;
  }
  return lowered.replace(/[^a-z0-9.]+/g, '').slice(0, 24) || null;
}

function parseResolutionFromText(value: string): { width: number | null; height: number | null } {
  const match = value.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/i);
  if (!match) {
    return { width: null, height: null };
  }
  return {
    width: asFiniteNumber(match[1]),
    height: asFiniteNumber(match[2]),
  };
}

function parseVideoField(video: unknown): {
  codec: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
} {
  if (typeof video === 'string' && video.trim()) {
    const resolution = parseResolutionFromText(video);
    return {
      codec: normalizeCodec(video),
      width: resolution.width,
      height: resolution.height,
      bitrate: null,
    };
  }

  if (!video || typeof video !== 'object') {
    return { codec: null, width: null, height: null, bitrate: null };
  }

  const fields = video as XtreamVideoObject;
  const codecSource =
    asNonEmptyString(fields.codec_name) ||
    asNonEmptyString(fields.codec) ||
    asNonEmptyString(fields.video_codec) ||
    asNonEmptyString(fields.profile);
  return {
    codec: normalizeCodec(codecSource),
    width: asFiniteNumber(fields.width) ?? asFiniteNumber(fields.coded_width),
    height: asFiniteNumber(fields.height) ?? asFiniteNumber(fields.coded_height),
    bitrate: asFiniteNumber(fields.bit_rate) ?? asFiniteNumber(fields.bitrate),
  };
}

function classifyDirectSource(value: unknown): MoviePlaybackSourceProbe['directSourceKind'] {
  const url = asNonEmptyString(value);
  if (!url || !/^https?:\/\//i.test(url)) {
    return 'none';
  }
  if (/\.m3u8(\b|$)/i.test(url) || /\/hls\b/i.test(url) || /application\/vnd\.apple\.mpegurl/i.test(url)) {
    return 'hls';
  }
  return 'http-other';
}

export function inspectMoviePlaybackSource(input: {
  containerExtension?: string | null;
  video?: unknown;
  videoCodec?: unknown;
  width?: unknown;
  height?: unknown;
  bitrate?: unknown;
  directSource?: unknown;
  streamUrl?: string | null;
}): MoviePlaybackSourceProbe {
  const parsedVideo = parseVideoField(input.video);
  const codec = parsedVideo.codec || normalizeCodec(asNonEmptyString(input.videoCodec));
  const width = parsedVideo.width ?? asFiniteNumber(input.width);
  const height = parsedVideo.height ?? asFiniteNumber(input.height);
  const container =
    asNonEmptyString(input.containerExtension)?.replace(/^\./, '').toLowerCase() ||
    (typeof input.streamUrl === 'string' && input.streamUrl.includes('.')
      ? input.streamUrl.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? null
      : null);
  const directSourceKind = classifyDirectSource(input.directSource);

  return {
    codec,
    width,
    height,
    container: container && /^[a-z0-9-]{1,10}$/.test(container) ? container : null,
    bitrate: parsedVideo.bitrate ?? asFiniteNumber(input.bitrate),
    hasDirectSource: directSourceKind !== 'none',
    directSourceKind,
  };
}

export function parseXtreamVodVideoMetadata(fields: Record<string, unknown>): {
  videoCodec?: string;
  videoWidth?: number;
  videoHeight?: number;
  videoBitrate?: number;
  directSource?: string;
} {
  const probe = inspectMoviePlaybackSource({
    containerExtension: asNonEmptyString(fields.container_extension),
    video: fields.video,
    videoCodec: fields.video_codec ?? fields.videoCodec,
    width: fields.width,
    height: fields.height,
    bitrate: fields.bitrate ?? fields.bit_rate,
    directSource: fields.direct_source ?? fields.directSource,
  });
  const directSource = asNonEmptyString(fields.direct_source ?? fields.directSource);
  return {
    videoCodec: probe.codec ?? undefined,
    videoWidth: probe.width ?? undefined,
    videoHeight: probe.height ?? undefined,
    videoBitrate: probe.bitrate ?? undefined,
    directSource: directSource && /^https?:\/\//i.test(directSource) ? directSource : undefined,
  };
}

export function isHevcCodec(codec: string | null | undefined): boolean {
  return normalizeCodec(codec ?? null) === 'hevc';
}

export function isAvcCodec(codec: string | null | undefined): boolean {
  return normalizeCodec(codec ?? null) === 'avc';
}

export function isOver1080p(width: number | null | undefined, height: number | null | undefined): boolean {
  return (width ?? 0) > 1920 || (height ?? 0) > 1080;
}

export function isMovieCodecRisk(probe: Pick<MoviePlaybackSourceProbe, 'codec' | 'width' | 'height'>): boolean {
  return isHevcCodec(probe.codec) && isOver1080p(probe.width, probe.height);
}

export function isMovieResolutionRisk(probe: Pick<MoviePlaybackSourceProbe, 'width' | 'height'>): boolean {
  return isOver1080p(probe.width, probe.height);
}

export function isUhdSource(probe: Pick<MoviePlaybackSourceProbe, 'width' | 'height'>): boolean {
  return (probe.width ?? 0) >= 3840 || (probe.height ?? 0) >= 2160;
}

function identityBlob(signals: DevicePlaybackSignals): string {
  return [signals.manufacturer, signals.brand, signals.model]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

export function isFhdOrSmallerDisplay(width: number | null | undefined, height: number | null | undefined): boolean {
  if (width == null && height == null) {
    return false;
  }
  const longEdge = Math.max(width ?? 0, height ?? 0);
  const shortEdge = Math.min(width ?? 0, height ?? 0);
  return longEdge > 0 && longEdge <= FHD_MAX_WIDTH && shortEdge <= FHD_MAX_HEIGHT;
}

export function resolveDevicePlaybackProfile(signals: DevicePlaybackSignals = {}): DevicePlaybackProfile {
  const displayWidth = asFiniteNumber(signals.displayWidth);
  const displayHeight = asFiniteNumber(signals.displayHeight);
  const os = (signals.os ?? '').toLowerCase();
  const identity = identityBlob(signals);
  const isAmazon = /amazon|\baft[a-z0-9]*\b|fire\s*(tv|stick)/i.test(identity);
  const isTv =
    signals.isTv === true ||
    String(signals.deviceType ?? '').toLowerCase() === 'tv' ||
    isAmazon ||
    /android\s*tv/.test(identity);
  const platform: DevicePlaybackProfile['platform'] =
    os === 'android' && isTv ? 'android-tv' : os === 'android' ? 'android' : os === 'ios' ? 'ios' : os === 'web' ? 'web' : 'unknown';
  const displayKnown = displayWidth != null || displayHeight != null;
  const fhdOutput = isFhdOrSmallerDisplay(displayWidth, displayHeight);
  const lowEndUnknownDisplay =
    !displayKnown &&
    os === 'android' &&
    isTv &&
    signals.apiLevel != null &&
    Number.isFinite(signals.apiLevel) &&
    signals.apiLevel <= 28;
  const conservativePlayback = os === 'android' && isTv && (fhdOutput || lowEndUnknownDisplay);

  return {
    displayWidth,
    displayHeight,
    platform,
    manufacturer: asNonEmptyString(signals.manufacturer) ?? asNonEmptyString(signals.brand),
    model: asNonEmptyString(signals.model),
    apiLevel: asFiniteNumber(signals.apiLevel),
    conservativePlayback,
  };
}

export function isPlausiblyMoreCompatibleMovieAlternate(input: {
  primaryStreamUrl?: string | null;
  directSourceUrl?: string | null;
  alternateProbe?: Pick<MoviePlaybackSourceProbe, 'codec' | 'width' | 'height' | 'directSourceKind'> | null;
  profile: Pick<DevicePlaybackProfile, 'conservativePlayback'>;
}): boolean {
  if (!isLegitimateMovieAlternateSource(input.primaryStreamUrl, input.directSourceUrl)) {
    return false;
  }
  const kind = input.alternateProbe?.directSourceKind ?? classifyDirectSource(input.directSourceUrl);
  if (kind === 'none') {
    return false;
  }
  if (isOver1080p(input.alternateProbe?.width, input.alternateProbe?.height) && input.profile.conservativePlayback) {
    return false;
  }
  if (kind === 'hls') {
    return true;
  }
  const hasSize = (input.alternateProbe?.width ?? 0) > 0 || (input.alternateProbe?.height ?? 0) > 0;
  if (hasSize && !isOver1080p(input.alternateProbe?.width, input.alternateProbe?.height)) {
    return true;
  }
  if (isAvcCodec(input.alternateProbe?.codec) && !isOver1080p(input.alternateProbe?.width, input.alternateProbe?.height)) {
    return true;
  }
  return false;
}

export function resolveMoviePreplayCompatibilityDecision(input: {
  mediaType?: string | null;
  probe: Pick<MoviePlaybackSourceProbe, 'codec' | 'width' | 'height' | 'container' | 'directSourceKind'>;
  profile: DevicePlaybackProfile;
  primaryStreamUrl?: string | null;
  directSourceUrl?: string | null;
  fallbackAttempted?: boolean;
  /** Ignored. Category titles such as "4K" must not drive blocking. */
  categoryName?: string | null;
}): MoviePreplayDecision {
  if (input.mediaType !== 'movie') {
    return { action: 'play' };
  }
  if (input.fallbackAttempted) {
    return { action: 'play' };
  }
  if (!input.profile.conservativePlayback || !isMovieResolutionRisk(input.probe)) {
    return { action: 'play' };
  }
  if (!input.fallbackAttempted) {
    const kind = classifyDirectSource(input.directSourceUrl);
    if (
      isPlausiblyMoreCompatibleMovieAlternate({
        primaryStreamUrl: input.primaryStreamUrl,
        directSourceUrl: input.directSourceUrl,
        alternateProbe: {
          codec: null,
          width: null,
          height: null,
          directSourceKind: kind,
        },
        profile: input.profile,
      })
    ) {
      const source = resolveMovieCompatibilityFallback({
        primaryStreamUrl: input.primaryStreamUrl,
        directSourceUrl: input.directSourceUrl,
        probe: { directSourceKind: kind },
      });
      if (source) {
        return { action: 'fallback', source };
      }
    }
  }
  return { action: 'block', reason: 'source-exceeds-device-profile' };
}

export function resolveMovieCompatibilityErrorCopy(input: {
  errorMessage?: string | null;
  errorCategory?: string | null;
}): { title: string; message: string } {
  if (isDevicePerformanceRiskMessage(input.errorMessage)) {
    return { title: DEVICE_PERFORMANCE_RISK_ERROR, message: DEVICE_PERFORMANCE_RISK_DETAIL };
  }
  if (input.errorCategory === UNSUPPORTED_VIDEO_FORMAT_CATEGORY) {
    return { title: UNSUPPORTED_VIDEO_FORMAT_ERROR, message: UNSUPPORTED_VIDEO_FORMAT_DETAIL };
  }
  return { title: 'Playback issue', message: input.errorMessage ?? 'Playback unavailable' };
}

function extractHttpStatusHint(error: unknown): number | null {
  const value = stringifyError(error);
  const match = value.match(
    /InvalidResponseCodeException[:\s]+(\d{3})|Response code[:\s]+(\d{3})|HTTP\s+(\d{3})|\b(401|403|404|429|458|5\d{2})\b/i,
  );
  if (!match) {
    return null;
  }
  const raw = match[1] || match[2] || match[3] || match[4];
  const status = Number(raw);
  return Number.isFinite(status) ? status : null;
}

export function isMovieNetworkOrAuthFailure(error: unknown): boolean {
  if (extractHttpStatusHint(error) != null) {
    return true;
  }
  const value = stringifyError(error).toLowerCase();
  if (/decoderinitializationexception|configurecodec|decodererrorfatal/.test(value)) {
    return false;
  }
  return /network|connection|offline|unreachable|dns|timeout|timed out|unauthorized|forbidden|not found|458|authoriz/.test(
    value,
  );
}

export function isVideoDecoderInitFailure(error: unknown): boolean {
  if (isMovieNetworkOrAuthFailure(error)) {
    return false;
  }
  const value = stringifyError(error).toLowerCase();
  if (!value.trim()) {
    return false;
  }
  return (
    /decoderinitializationexception/.test(value) ||
    /decodererrorfatal/.test(value) ||
    /configurecodec/.test(value) ||
    /failed to (?:initialize|init)(?: the)? (?:video )?decoder/.test(value) ||
    /codec(?:.+)?configur/.test(value) ||
    /omx\.[a-z0-9.]*decoder/.test(value) && /fail|error|configur/.test(value) ||
    /error -22/.test(value) && /codec|decoder|configure/.test(value) ||
    /unsupported (?:video )?format/.test(value) ||
    /this video format isn't supported/.test(value)
  );
}

export function classifyMoviePlaybackErrorCategory(error: unknown): string | null {
  if (isMovieNetworkOrAuthFailure(error)) {
    return null;
  }
  if (isVideoDecoderInitFailure(error)) {
    return UNSUPPORTED_VIDEO_FORMAT_CATEGORY;
  }
  return null;
}

function parseStreamLocator(url: string): {
  host: string;
  streamId: string | null;
  extension: string | null;
  isHls: boolean;
  path: string;
} | null {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const movieIndex = segments.indexOf('movie');
    let streamId: string | null = null;
    let extension: string | null = null;
    if (movieIndex >= 0 && segments[movieIndex + 3]) {
      const file = segments[movieIndex + 3];
      const dot = file.lastIndexOf('.');
      streamId = (dot >= 0 ? file.slice(0, dot) : file) || null;
      extension = dot >= 0 ? file.slice(dot + 1).toLowerCase() : null;
    }
    return {
      host: parsed.host.toLowerCase(),
      streamId,
      extension,
      isHls: /\.m3u8$/i.test(parsed.pathname) || /\/hls\b/i.test(parsed.pathname),
      path: parsed.pathname,
    };
  } catch {
    return null;
  }
}

export function isLegitimateMovieAlternateSource(
  primaryStreamUrl: string | null | undefined,
  candidateUrl: string | null | undefined,
): boolean {
  const primary = asNonEmptyString(primaryStreamUrl);
  const candidate = asNonEmptyString(candidateUrl);
  if (!primary || !candidate || !/^https?:\/\//i.test(candidate)) {
    return false;
  }
  if (primary === candidate) {
    return false;
  }

  const primaryParts = parseStreamLocator(primary);
  const candidateParts = parseStreamLocator(candidate);
  if (!candidateParts) {
    return false;
  }

  if (
    primaryParts &&
    primaryParts.host === candidateParts.host &&
    primaryParts.streamId &&
    primaryParts.streamId === candidateParts.streamId &&
    primaryParts.extension !== candidateParts.extension
  ) {
    // Same Xtream movie id, different suffix — not a different encode.
    return false;
  }

  if (candidateParts.isHls && candidate !== primary) {
    return true;
  }

  if (primaryParts && (candidateParts.host !== primaryParts.host || candidateParts.path !== primaryParts.path)) {
    return true;
  }

  return false;
}

export function resolveMovieCompatibilityFallback(input: {
  primaryStreamUrl: string | null | undefined;
  directSourceUrl?: string | null;
  probe?: Pick<MoviePlaybackSourceProbe, 'directSourceKind'> | null;
}): MovieCompatibilityFallbackSource | null {
  const candidate = asNonEmptyString(input.directSourceUrl);
  if (!isLegitimateMovieAlternateSource(input.primaryStreamUrl, candidate) || !candidate) {
    return null;
  }
  const kind = input.probe?.directSourceKind ?? classifyDirectSource(candidate);
  if (kind === 'none') {
    return null;
  }
  const container = kind === 'hls' ? 'm3u8' : candidate.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? null;
  return {
    streamUrl: candidate,
    container: container && /^[a-z0-9-]{1,10}$/.test(container) ? container : null,
    reason: kind === 'hls' ? 'direct-source-hls' : 'direct-source-other',
  };
}

export function resolveMovieCompatibilityErrorDecision(input: {
  mediaType?: string | null;
  error: unknown;
  fallbackAttempted: boolean;
  primaryStreamUrl?: string | null;
  directSourceUrl?: string | null;
  probe?: MoviePlaybackSourceProbe | null;
}): MovieCompatibilityErrorDecision {
  if (input.mediaType !== 'movie' || !isVideoDecoderInitFailure(input.error)) {
    return { action: 'passthrough' };
  }
  if (input.fallbackAttempted) {
    return { action: 'unsupported' };
  }
  const source = resolveMovieCompatibilityFallback({
    primaryStreamUrl: input.primaryStreamUrl,
    directSourceUrl: input.directSourceUrl,
    probe: input.probe,
  });
  if (source) {
    return { action: 'fallback', source };
  }
  return { action: 'unsupported' };
}

export function shouldRunMovieHttpSourceRecovery(input: {
  mediaType?: string | null;
  httpStatus: number | null;
  decoderInitFailure: boolean;
}): boolean {
  return input.mediaType === 'movie' && input.httpStatus != null && !input.decoderInitFailure;
}

export function shouldRecordMovieProgressAfterPlayback(input: {
  firstFrameSeen: boolean;
  positionMs: number;
  durationMs: number;
  errorCategory?: string | null;
  preplayBlocked?: boolean;
}): boolean {
  if (input.preplayBlocked || input.errorCategory === UNSUPPORTED_VIDEO_FORMAT_CATEGORY) {
    return false;
  }
  if (!input.firstFrameSeen) {
    return false;
  }
  return Number.isFinite(input.positionMs) && input.positionMs > 0;
}

export function shouldRetryMovieUnsupportedFormat(errorCategory?: string | null): boolean {
  return errorCategory !== UNSUPPORTED_VIDEO_FORMAT_CATEGORY;
}

export function buildMoviePlaybackCompatibilityLog(
  input: MoviePlaybackCompatibilityLog,
): MoviePlaybackCompatibilityLog {
  const payload: MoviePlaybackCompatibilityLog = {
    event: input.event,
  };
  if (input.event === 'device-profile') {
    payload.displayWidth = input.displayWidth ?? null;
    payload.displayHeight = input.displayHeight ?? null;
    payload.platform = input.platform ?? null;
    payload.conservativePlayback = Boolean(input.conservativePlayback);
    return payload;
  }
  payload.codec = input.codec ?? null;
  payload.width = input.width ?? null;
  payload.height = input.height ?? null;
  payload.container = input.container ?? null;
  if (typeof input.fallbackAttempt === 'number') {
    payload.fallbackAttempt = input.fallbackAttempt;
  }
  if (input.displayWidth != null || input.displayHeight != null) {
    payload.displayWidth = input.displayWidth ?? null;
    payload.displayHeight = input.displayHeight ?? null;
  }
  if (input.platform != null) {
    payload.platform = input.platform;
  }
  if (typeof input.conservativePlayback === 'boolean') {
    payload.conservativePlayback = input.conservativePlayback;
  }
  if (input.reason) {
    payload.reason = input.reason;
  }
  return payload;
}

export function logMoviePlaybackCompatibility(input: MoviePlaybackCompatibilityLog) {
  console.info('[NovaCast Movie Playback Compatibility]', buildMoviePlaybackCompatibilityLog(input));
}

export function isUnsupportedVideoFormatMessage(message: string | null | undefined): boolean {
  return (message ?? '').trim() === UNSUPPORTED_VIDEO_FORMAT_ERROR;
}

export function isDevicePerformanceRiskMessage(message: string | null | undefined): boolean {
  return (message ?? '').trim() === DEVICE_PERFORMANCE_RISK_ERROR;
}
