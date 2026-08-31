import { normalizeSingleExtension } from './playbackSourceDiagnostics.ts';

export const LIVE_URL_CONTRACT_PROBE = '[NovaCast Live URL Probe]';
export const LIVE_URL_CONTRACT_DIAG = '[NovaCast Live URL Contract]';

export type LiveUrlCandidateLabel =
  | 'live-family-ts'
  | 'live-family-m3u8'
  | 'live-family-no-ext'
  | 'legacy-no-family-ts';

export type LiveUrlContractMatch = 'match' | 'mismatch' | 'unknown';

export type LivePlaybackExtensionSource =
  | 'explicit'
  | 'channel-container'
  | 'account-preferred'
  | 'probe-cache'
  | 'fallback';

export type LivePlaybackExtensionResolution = {
  extension: string;
  source: LivePlaybackExtensionSource;
  channelContainerMetadataPresent: boolean;
  providerOutputMetadataPresent: boolean;
  allowedOutputFormatCount: number;
  preferredOutputFormat: string | null;
  constructedFormatMatchesContract: LiveUrlContractMatch;
};

export type LiveUrlProbeClassification = 'media' | 'html' | 'timeout' | 'error' | 'unknown';

export type LiveUrlProbeResult = {
  candidateLabel: LiveUrlCandidateLabel;
  httpStatus: number | null;
  contentType: string | null;
  classification: LiveUrlProbeClassification;
  elapsedMs: number;
};

export type LiveUrlProbeCacheEntry = {
  winningLabel: LiveUrlCandidateLabel | null;
  winningExtension: string | null;
  provenBetterThan: string | null;
  results: LiveUrlProbeResult[];
};

type LiveUrlCandidate = {
  label: LiveUrlCandidateLabel;
  url: string;
};

const LIVE_PROBE_TIMEOUT_MS = 5000;
const LIVE_PROBE_HEAD_BYTES = 1024;
const probeCache = new Map<string, LiveUrlProbeCacheEntry>();
const probeInflight = new Map<string, Promise<LiveUrlProbeCacheEntry>>();

export function resetLivePlaybackUrlContractCache() {
  probeCache.clear();
  probeInflight.clear();
}

export function getCachedLivePlaybackProbe(providerId: string | null | undefined) {
  const key = String(providerId ?? '').trim();
  if (!key) {
    return null;
  }
  return probeCache.get(key) ?? null;
}

export function resolveLivePlaybackExtension(input: {
  explicitExtension?: string | null;
  channelContainerExtension?: string | null;
  preferredOutputFormat?: string | null;
  allowedOutputFormats?: readonly string[] | null;
  cachedProbe?: Pick<LiveUrlProbeCacheEntry, 'winningExtension' | 'provenBetterThan'> | null;
}): LivePlaybackExtensionResolution {
  const channelExt = normalizeSingleExtension(input.channelContainerExtension);
  const explicitExt = normalizeSingleExtension(input.explicitExtension);
  const allowed = (input.allowedOutputFormats ?? [])
    .map((item) => normalizeSingleExtension(item))
    .filter((item): item is string => Boolean(item));
  const preferred = normalizeSingleExtension(input.preferredOutputFormat);
  const providerOutputMetadataPresent = allowed.length > 0 || Boolean(preferred);

  let extension = 'ts';
  let source: LivePlaybackExtensionSource = 'fallback';

  if (explicitExt) {
    extension = explicitExt;
    source = 'explicit';
  } else if (channelExt) {
    extension = channelExt;
    source = 'channel-container';
  } else if (preferred) {
    extension = preferred;
    source = 'account-preferred';
  } else if (allowed.length > 0) {
    extension = allowed.includes('m3u8') ? 'm3u8' : allowed[0]!;
    source = 'account-preferred';
  }

  const cachedWinning = input.cachedProbe?.winningExtension;
  const cachedExt = cachedWinning === '' ? '' : normalizeSingleExtension(cachedWinning);
  const provenBetterThan = normalizeSingleExtension(input.cachedProbe?.provenBetterThan);
  if (
    cachedExt != null &&
    provenBetterThan &&
    extension === provenBetterThan &&
    cachedExt !== extension
  ) {
    extension = cachedExt;
    source = 'probe-cache';
  }

  let constructedFormatMatchesContract: LiveUrlContractMatch = 'unknown';
  if (channelExt) {
    constructedFormatMatchesContract = extension === channelExt ? 'match' : 'mismatch';
  } else if (allowed.length > 0) {
    constructedFormatMatchesContract = allowed.includes(extension) ? 'match' : 'mismatch';
  } else if (preferred) {
    constructedFormatMatchesContract = extension === preferred ? 'match' : 'mismatch';
  }

  if (source === 'fallback' && allowed.length > 0 && !allowed.includes(extension)) {
    extension = preferred ?? (allowed.includes('m3u8') ? 'm3u8' : allowed[0]!);
    source = 'account-preferred';
    constructedFormatMatchesContract = 'match';
  }

  return {
    extension,
    source,
    channelContainerMetadataPresent: Boolean(channelExt),
    providerOutputMetadataPresent,
    allowedOutputFormatCount: allowed.length,
    preferredOutputFormat: preferred,
    constructedFormatMatchesContract,
  };
}

export function describeSafeLivePathShape(url: string): {
  protocol: string;
  hostnameHash: string;
  pathSegmentCount: number;
  pathShape: string;
  finalExtension: string;
  endpointFamily: string | null;
  credentialsPresentInExpectedPathPositions: boolean;
} {
  let protocol = 'invalid';
  let hostnameHash = 'invalid';
  let pathSegmentCount = 0;
  let pathShape = 'invalid';
  let finalExtension = '';
  let endpointFamily: string | null = null;
  let credentialsPresentInExpectedPathPositions = false;

  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    protocol = parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.protocol.slice(0, -1) : 'other';
    hostnameHash = hashHostname(parsed.hostname);
    pathSegmentCount = pathSegments.length;
    const last = pathSegments.at(-1) ?? '';
    finalExtension = last.includes('.') ? last.slice(last.lastIndexOf('.') + 1).toLowerCase() : '';

    const familyIndex = pathSegments.findIndex((segment) => segment === 'live' || segment === 'movie' || segment === 'series');
    if (familyIndex >= 0) {
      endpointFamily = pathSegments[familyIndex] ?? null;
      credentialsPresentInExpectedPathPositions = Boolean(
        pathSegments[familyIndex + 1] && pathSegments[familyIndex + 2],
      );
      pathShape = finalExtension
        ? `/${endpointFamily}/{user}/{pass}/{streamId}.${finalExtension}`
        : `/${endpointFamily}/{user}/{pass}/{streamId}`;
    } else if (pathSegments.length === 3) {
      credentialsPresentInExpectedPathPositions = Boolean(pathSegments[0] && pathSegments[1]);
      pathShape = finalExtension
        ? '/{user}/{pass}/{streamId}.{ext}'.replace('{ext}', finalExtension)
        : '/{user}/{pass}/{streamId}';
    } else {
      pathShape = `segments:${pathSegmentCount}`;
    }
  } catch {
    // Keep diagnostics safe when the source is malformed.
  }

  return {
    protocol,
    hostnameHash,
    pathSegmentCount,
    pathShape,
    finalExtension,
    endpointFamily,
    credentialsPresentInExpectedPathPositions,
  };
}

export function buildLiveUrlCandidates(constructedUrl: string): LiveUrlCandidate[] {
  try {
    const parsed = new URL(constructedUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const familyIndex = segments.indexOf('live');
    if (familyIndex < 0 || segments.length < familyIndex + 4) {
      return [];
    }

    const streamId = (segments[familyIndex + 3] ?? '').replace(/\.[^/.]+$/, '');
    if (!streamId) {
      return [];
    }

    const familyAndCredentials = segments.slice(0, familyIndex + 3);
    const credentialsOnly = [...segments.slice(0, familyIndex), ...segments.slice(familyIndex + 1, familyIndex + 3)];

    return [
      { label: 'live-family-ts', url: withPath(parsed, [...familyAndCredentials, `${streamId}.ts`]) },
      { label: 'live-family-m3u8', url: withPath(parsed, [...familyAndCredentials, `${streamId}.m3u8`]) },
      { label: 'live-family-no-ext', url: withPath(parsed, [...familyAndCredentials, streamId]) },
      { label: 'legacy-no-family-ts', url: withPath(parsed, [...credentialsOnly, `${streamId}.ts`]) },
    ];
  } catch {
    return [];
  }
}

export async function probeLivePlaybackUrlCandidates(input: {
  constructedUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<LiveUrlProbeResult[]> {
  const candidates = buildLiveUrlCandidates(input.constructedUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? LIVE_PROBE_TIMEOUT_MS;

  return Promise.all(candidates.map((candidate) => probeOneCandidate(candidate, fetchImpl, timeoutMs)));
}

export function logLiveUrlProbeResults(results: LiveUrlProbeResult[], winningLabel: LiveUrlCandidateLabel | null) {
  for (const result of results) {
    console.info(LIVE_URL_CONTRACT_PROBE, {
      candidateLabel: result.candidateLabel,
      httpStatus: result.httpStatus,
      contentType: result.contentType,
      classification: result.classification,
      elapsedMs: result.elapsedMs,
      selectedAsWinner: result.candidateLabel === winningLabel && result.classification === 'media',
    });
  }
}

export function interpretLiveUrlProbeResults(
  results: LiveUrlProbeResult[],
  constructedExtension: string,
): LiveUrlProbeCacheEntry {
  const constructedLabel = labelForExtension(constructedExtension);
  const constructed = results.find((item) => item.candidateLabel === constructedLabel);
  const winner = results.find((item) => isPromisingLiveProbe(item));
  const constructedFailed = !isPromisingLiveProbe(constructed);
  const provenBetter =
    Boolean(winner) &&
    constructedFailed &&
    winner!.candidateLabel !== constructedLabel;

  return {
    winningLabel: provenBetter ? winner!.candidateLabel : constructed && !constructedFailed ? constructedLabel : winner?.candidateLabel ?? null,
    winningExtension: provenBetter
      ? extensionForLabel(winner!.candidateLabel)
      : constructed && !constructedFailed
        ? constructedExtension
        : winner
          ? extensionForLabel(winner.candidateLabel)
          : null,
    provenBetterThan: provenBetter ? constructedExtension : null,
    results,
  };
}

export function scheduleLiveUrlContractProbe(input: {
  providerId: string;
  constructedUrl: string;
  constructedExtension: string;
  fetchImpl?: typeof fetch;
}) {
  const providerId = input.providerId.trim();
  if (!providerId || probeCache.has(providerId) || probeInflight.has(providerId)) {
    return probeInflight.get(providerId) ?? Promise.resolve(probeCache.get(providerId) ?? emptyProbeCache());
  }

  const work = probeLivePlaybackUrlCandidates({
    constructedUrl: input.constructedUrl,
    fetchImpl: input.fetchImpl,
  })
    .then((results) => {
      const entry = interpretLiveUrlProbeResults(results, input.constructedExtension);
      logLiveUrlProbeResults(results, entry.winningLabel);
      probeCache.set(providerId, entry);
      return entry;
    })
    .catch(() => {
      const entry = emptyProbeCache();
      probeCache.set(providerId, entry);
      return entry;
    })
    .finally(() => {
      probeInflight.delete(providerId);
    });

  probeInflight.set(providerId, work);
  return work;
}

function emptyProbeCache(): LiveUrlProbeCacheEntry {
  return {
    winningLabel: null,
    winningExtension: null,
    provenBetterThan: null,
    results: [],
  };
}

function labelForExtension(extension: string): LiveUrlCandidateLabel {
  const normalized = normalizeSingleExtension(extension);
  if (normalized === 'm3u8') {
    return 'live-family-m3u8';
  }
  if (!normalized) {
    return 'live-family-no-ext';
  }
  return 'live-family-ts';
}

function extensionForLabel(label: LiveUrlCandidateLabel): string {
  if (label === 'live-family-m3u8') {
    return 'm3u8';
  }
  if (label === 'live-family-no-ext') {
    return '';
  }
  return 'ts';
}

function isPromisingLiveProbe(result: LiveUrlProbeResult | undefined): boolean {
  return result?.classification === 'media';
}

export function classifyLiveProbeEvidence(input: {
  httpStatus?: number | null;
  contentType?: string | null;
  headBytes?: Uint8Array | null;
  timedOut?: boolean;
  failed?: boolean;
}): LiveUrlProbeClassification {
  if (input.timedOut) {
    return 'timeout';
  }
  if (input.failed) {
    return 'error';
  }

  const status = input.httpStatus ?? 0;
  if (status === 401 || status === 403 || status === 404 || status === 429 || status >= 500) {
    return 'error';
  }
  if (status > 0 && status !== 200 && status !== 206) {
    return 'error';
  }

  const contentType = safeContentType(input.contentType ?? null) ?? '';
  const bytes = input.headBytes ?? new Uint8Array();
  const ascii = decodeAscii(bytes).trim();

  if (looksLikeHtml(ascii) || contentType.includes('text/html')) {
    return 'html';
  }
  if (looksLikeJsonOrXmlError(ascii, contentType)) {
    return 'error';
  }
  if (ascii.startsWith('#EXTM3U')) {
    return 'media';
  }
  if (looksLikeMpegTs(bytes) || looksLikeFtyp(bytes)) {
    return 'media';
  }
  if (isMediaContentType(contentType) && bytes.length > 0 && !looksLikeHtml(ascii)) {
    return 'media';
  }
  if (status === 200 || status === 206) {
    return bytes.length === 0 ? 'unknown' : 'unknown';
  }
  return 'unknown';
}

async function probeOneCandidate(
  candidate: LiveUrlCandidate,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<LiveUrlProbeResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(candidate.url, {
      method: 'GET',
      signal: controller.signal,
    });
    const headBytes = await readProbeHead(response, LIVE_PROBE_HEAD_BYTES, controller.signal);
    const contentType = safeContentType(response.headers.get('content-type'));
    return {
      candidateLabel: candidate.label,
      httpStatus: response.status,
      contentType,
      classification: classifyLiveProbeEvidence({
        httpStatus: response.status,
        contentType,
        headBytes,
      }),
      elapsedMs: Math.max(0, Date.now() - startedAt),
    };
  } catch {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const timedOut = controller.signal.aborted || elapsedMs >= timeoutMs - 20;
    return {
      candidateLabel: candidate.label,
      httpStatus: null,
      contentType: null,
      classification: classifyLiveProbeEvidence({ timedOut, failed: !timedOut }),
      elapsedMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readProbeHead(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const body = response.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (received < maxBytes && !signal.aborted) {
        const { done, value } = await reader.read();
        if (done || !value) {
          break;
        }
        chunks.push(value);
        received += value.byteLength;
        if (received >= maxBytes) {
          break;
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancel races after a completed or aborted read.
      }
    }
    return concatBytes(chunks).slice(0, maxBytes);
  }

  try {
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer).slice(0, maxBytes);
  } catch {
    return new Uint8Array();
  }
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function decodeAscii(bytes: Uint8Array) {
  let text = '';
  const limit = Math.min(bytes.length, 256);
  for (let index = 0; index < limit; index += 1) {
    text += String.fromCharCode(bytes[index] ?? 0);
  }
  return text;
}

function looksLikeHtml(ascii: string) {
  return /^(<!doctype html|<html|<head|<body|<script)/i.test(ascii) || /<html[\s>]/i.test(ascii.slice(0, 256));
}

function looksLikeJsonOrXmlError(ascii: string, contentType: string) {
  if (contentType.includes('json') || contentType.includes('xml')) {
    return true;
  }
  return /^(<\?xml|\{|\[)/.test(ascii);
}

function isMediaContentType(contentType: string) {
  return (
    contentType.includes('mpegurl') ||
    contentType.includes('x-mpegurl') ||
    contentType.includes('mp2t') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('audio/')
  );
}

function looksLikeMpegTs(bytes: Uint8Array) {
  if (bytes.length === 0) {
    return false;
  }
  if (bytes.length < 188) {
    return bytes[0] === 0x47;
  }
  let hits = 0;
  const limit = Math.min(bytes.length, 188 * 6);
  for (let offset = 0; offset + 1 < limit; offset += 188) {
    if (bytes[offset] === 0x47) {
      hits += 1;
    }
  }
  return hits >= 2;
}

function looksLikeFtyp(bytes: Uint8Array) {
  if (bytes.length < 8) {
    return false;
  }
  return decodeAscii(bytes.slice(4, 8)) === 'ftyp';
}

function withPath(parsed: URL, segments: string[]) {
  const next = new URL(parsed.href);
  next.pathname = `/${segments.join('/')}`;
  return next.toString();
}

function safeContentType(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!trimmed) {
    return null;
  }
  if (/https?:|@{1}|\/{2}/i.test(trimmed)) {
    return 'redacted';
  }
  return trimmed.slice(0, 80);
}

function hashHostname(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
