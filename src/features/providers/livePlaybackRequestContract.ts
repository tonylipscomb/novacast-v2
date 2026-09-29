import {
  classifyLiveProbeEvidence,
  describeSafeLivePathShape,
  type LiveUrlProbeClassification,
} from './livePlaybackUrlContract.ts';

export const LIVE_REQUEST_CONTRACT_DIAG = '[NovaCast Live Request Contract]';

export type LiveRequestContractActor = 'probe' | 'media3';

export type LiveRequestContractVariantId =
  | 'baseline'
  | 'ua-vlc'
  | 'ua-exoplayer'
  | 'accept-star'
  | 'range-0-1023'
  | 'connection-close'
  | 'observe-redirect';

export type LiveRequestUserAgentCategory = 'default' | 'vlc' | 'exoplayer' | 'okhttp' | 'other';

export type LiveRequestContractSpec = {
  actor: LiveRequestContractActor;
  method: 'GET';
  userAgentCategory: LiveRequestUserAgentCategory;
  accept: string | null;
  rangePresent: boolean;
  rangeShape: string | null;
  refererPresent: boolean;
  originPresent: boolean;
  connection: string | null;
  redirectFollow: boolean;
};

export type LiveRequestContractChangedField = 'none' | 'user-agent' | 'accept' | 'range' | 'redirect' | 'connection';

export type LiveRequestContractVariant = {
  id: LiveRequestContractVariantId;
  changedField: LiveRequestContractChangedField;
  diagnosticOnly?: boolean;
  init: RequestInit;
};

export type LiveRequestContractResult = {
  variantId: LiveRequestContractVariantId;
  changedField: LiveRequestContractVariant['changedField'];
  method: 'GET';
  userAgentCategory: LiveRequestUserAgentCategory;
  userAgentHash: string | null;
  accept: string | null;
  acceptEncoding: string | null;
  rangePresent: boolean;
  rangeShape: string | null;
  refererPresent: boolean;
  originPresent: boolean;
  connection: string | null;
  redirectFollow: boolean;
  httpStatus: number | null;
  contentType: string | null;
  serverHeader: string | null;
  locationPresent: boolean;
  locationProtocol: string | null;
  locationHostnameHash: string | null;
  locationPathShape: string | null;
  redirected: boolean;
  httpToHttpsRedirect: boolean;
  hostRedirect: boolean;
  classification: LiveUrlProbeClassification;
  success: boolean;
  elapsedMs: number;
};

const LIVE_REQUEST_CONTRACT_TIMEOUT_MS = 5000;
const LIVE_REQUEST_CONTRACT_HEAD_BYTES = 1024;
const LIVE_REQUEST_CONTRACT_YIELD_MS = 80;

/** Cloud health probe already uses this ExoPlayer UA. Do not invent Smarters. */
export const LIVE_EXOPLAYER_USER_AGENT = 'ExoPlayerLib/2.18.1 (Linux; Android 12)';
export const LIVE_VLC_USER_AGENT = 'VLC/3.0.18 LibVLC/3.0.18';

const auditInflight = new Set<string>();
const auditCompleted = new Set<string>();

export function resetLivePlaybackRequestContractForTests() {
  auditInflight.clear();
  auditCompleted.clear();
}

export function describeExpectedLiveRequestContracts(): Record<LiveRequestContractActor, LiveRequestContractSpec> {
  return {
    probe: {
      actor: 'probe',
      method: 'GET',
      userAgentCategory: 'default',
      accept: null,
      rangePresent: false,
      rangeShape: null,
      refererPresent: false,
      originPresent: false,
      connection: null,
      redirectFollow: true,
    },
    media3: {
      actor: 'media3',
      method: 'GET',
      userAgentCategory: 'exoplayer',
      accept: '*/*',
      rangePresent: true,
      rangeShape: 'bytes=0-',
      refererPresent: false,
      originPresent: false,
      connection: 'keep-alive',
      redirectFollow: true,
    },
  };
}

export function listLiveRequestContractDifferences(): string[] {
  const expected = describeExpectedLiveRequestContracts();
  const differences: string[] = [];
  if (expected.probe.userAgentCategory !== expected.media3.userAgentCategory) {
    differences.push('user-agent');
  }
  if (expected.probe.accept !== expected.media3.accept) {
    differences.push('accept');
  }
  if (expected.probe.rangePresent !== expected.media3.rangePresent) {
    differences.push('range');
  }
  if (expected.probe.connection !== expected.media3.connection) {
    differences.push('connection');
  }
  return differences;
}

export function buildLiveRequestContractVariants(): LiveRequestContractVariant[] {
  return [
    {
      id: 'baseline',
      changedField: 'none',
      init: { method: 'GET', redirect: 'follow' },
    },
    {
      id: 'ua-vlc',
      changedField: 'user-agent',
      init: { method: 'GET', redirect: 'follow', headers: { 'User-Agent': LIVE_VLC_USER_AGENT } },
    },
    {
      id: 'ua-exoplayer',
      changedField: 'user-agent',
      init: { method: 'GET', redirect: 'follow', headers: { 'User-Agent': LIVE_EXOPLAYER_USER_AGENT } },
    },
    {
      id: 'accept-star',
      changedField: 'accept',
      init: { method: 'GET', redirect: 'follow', headers: { Accept: '*/*' } },
    },
    {
      id: 'range-0-1023',
      changedField: 'range',
      init: { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-1023' } },
    },
    {
      id: 'connection-close',
      changedField: 'connection',
      init: { method: 'GET', redirect: 'follow', headers: { Connection: 'close' } },
    },
    {
      id: 'observe-redirect',
      changedField: 'redirect',
      diagnosticOnly: true,
      init: { method: 'GET', redirect: 'manual' },
    },
  ];
}

/** Code search only. Do not invent Smarters UA or `output=ts` query URLs. */
export const LIVE_REQUEST_CONTRACT_CODEBASE_FINDINGS = {
  smartersUserAgentPrecedent: false,
  outputQueryParamLiveBuilder: false,
  playerApiStreamConstruction: false,
  getPhpLiveBuilder: false,
  inAppProbeSendsCustomHeaders: false,
  inAppProbeMethod: 'GET' as const,
  media3CustomHeadersInApp: true,
  cloudHealthUsesExoPlayerUa: true,
  cloudHealthSendsAcceptStar: true,
  cloudHealthRetriesWithoutRangeOn406: true,
};

export function classifyLiveRequestUserAgent(value: string | null | undefined): {
  category: LiveRequestUserAgentCategory;
  hash: string | null;
} {
  const ua = String(value ?? '').trim();
  if (!ua) {
    return { category: 'default', hash: null };
  }
  const lowered = ua.toLowerCase();
  let category: LiveRequestUserAgentCategory = 'other';
  if (/exoplayer/i.test(ua)) {
    category = 'exoplayer';
  } else if (/vlc|libvlc/i.test(ua)) {
    category = 'vlc';
  } else if (/okhttp/i.test(ua)) {
    category = 'okhttp';
  }
  return { category, hash: hashToken(lowered) };
}

export function describeSafeRangeHeader(value: string | null | undefined): { present: boolean; shape: string | null } {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return { present: false, shape: null };
  }
  const match = raw.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) {
    return { present: true, shape: 'invalid' };
  }
  return {
    present: true,
    shape: `bytes=${match[1] ?? ''}-${match[2] ?? ''}`,
  };
}

export function isLiveRequestContractSuccess(input: {
  httpStatus: number | null;
  classification: LiveUrlProbeClassification;
  redirected?: boolean;
}): boolean {
  if (input.classification !== 'media') {
    return false;
  }
  return input.httpStatus === 200 || input.httpStatus === 206;
}

export function countLiveRequestHeaderMutations(init: RequestInit): number {
  const headers = new Headers(init.headers);
  let mutations = 0;
  if (headers.has('User-Agent')) mutations += 1;
  if (headers.has('Accept')) mutations += 1;
  if (headers.has('Range')) mutations += 1;
  if (headers.has('Connection')) mutations += 1;
  if (init.redirect === 'manual') mutations += 1;
  return mutations;
}

export function selectProvenLiveRequestContractFix(
  results: readonly LiveRequestContractResult[],
): { variantId: LiveRequestContractVariantId; changedField: LiveRequestContractVariant['changedField'] } | null {
  const baseline = results.find((item) => item.variantId === 'baseline');
  if (baseline?.success) {
    return null;
  }
  const winner = results.find((item) => item.success && !item.variantId.startsWith('observe') && item.variantId !== 'baseline');
  if (!winner) {
    return null;
  }
  return { variantId: winner.variantId, changedField: winner.changedField };
}

export function scheduleLiveRequestContractAudit(input: {
  providerId: string;
  constructedUrl: string;
  fetchImpl?: typeof fetch;
  yieldMs?: number;
}) {
  const providerId = String(input.providerId ?? '').trim();
  if (!providerId || auditCompleted.has(providerId) || auditInflight.has(providerId)) {
    return Promise.resolve();
  }
  if (!/^https?:\/\//i.test(input.constructedUrl)) {
    return Promise.resolve();
  }

  auditInflight.add(providerId);
  const work = runLiveRequestContractAudit({
    constructedUrl: input.constructedUrl,
    fetchImpl: input.fetchImpl,
    yieldMs: input.yieldMs,
  })
    .then((results) => {
      auditCompleted.add(providerId);
      logLiveRequestContractResults(results);
    })
    .catch(() => {
      auditCompleted.add(providerId);
    })
    .finally(() => {
      auditInflight.delete(providerId);
    });
  return work;
}

export async function runLiveRequestContractAudit(input: {
  constructedUrl: string;
  fetchImpl?: typeof fetch;
  yieldMs?: number;
}): Promise<LiveRequestContractResult[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const pauseMs = input.yieldMs ?? LIVE_REQUEST_CONTRACT_YIELD_MS;
  const results: LiveRequestContractResult[] = [];
  for (const variant of buildLiveRequestContractVariants()) {
    results.push(await runOneLiveRequestContractVariant(input.constructedUrl, variant, fetchImpl));
    if (pauseMs > 0) {
      await yieldMs(pauseMs);
    }
  }
  return results;
}

export function logExpectedLiveRequestContractComparison() {
  const expected = describeExpectedLiveRequestContracts();
  console.info(LIVE_REQUEST_CONTRACT_DIAG, {
    stage: 'expected-probe-vs-media3',
    probe: expected.probe,
    media3: expected.media3,
    differingFields: listLiveRequestContractDifferences(),
  });
}

function logLiveRequestContractResults(results: LiveRequestContractResult[]) {
  logExpectedLiveRequestContractComparison();
  for (const result of results) {
    console.info(LIVE_REQUEST_CONTRACT_DIAG, {
      stage: 'variant',
      variantId: result.variantId,
      changedField: result.changedField,
      method: result.method,
      userAgentCategory: result.userAgentCategory,
      userAgentHash: result.userAgentHash,
      accept: result.accept,
      acceptEncoding: result.acceptEncoding,
      rangePresent: result.rangePresent,
      rangeShape: result.rangeShape,
      refererPresent: result.refererPresent,
      originPresent: result.originPresent,
      connection: result.connection,
      redirectFollow: result.redirectFollow,
      httpStatus: result.httpStatus,
      contentType: result.contentType,
      serverHeader: result.serverHeader,
      locationPresent: result.locationPresent,
      locationProtocol: result.locationProtocol,
      locationHostnameHash: result.locationHostnameHash,
      locationPathShape: result.locationPathShape,
      redirected: result.redirected,
      httpToHttpsRedirect: result.httpToHttpsRedirect,
      hostRedirect: result.hostRedirect,
      classification: result.classification,
      success: result.success,
      elapsedMs: result.elapsedMs,
    });
  }
  const proven = selectProvenLiveRequestContractFix(results);
  console.info(LIVE_REQUEST_CONTRACT_DIAG, {
    stage: 'summary',
    provenRequestContractFix: Boolean(proven),
    provenVariantId: proven?.variantId ?? null,
    provenChangedField: proven?.changedField ?? null,
    anySuccess: results.some((item) => item.success),
  });
}

async function runOneLiveRequestContractVariant(
  url: string,
  variant: LiveRequestContractVariant,
  fetchImpl: typeof fetch,
): Promise<LiveRequestContractResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_REQUEST_CONTRACT_TIMEOUT_MS);
  const requestHeaders = new Headers(variant.init.headers);
  const userAgent = classifyLiveRequestUserAgent(requestHeaders.get('User-Agent'));
  const range = describeSafeRangeHeader(requestHeaders.get('Range'));
  const accept = sanitizeHeaderToken(requestHeaders.get('Accept'));
  const acceptEncoding = sanitizeHeaderToken(requestHeaders.get('Accept-Encoding'));
  const redirectFollow = variant.init.redirect !== 'manual';

  try {
    const response = await fetchImpl(url, {
      ...variant.init,
      method: 'GET',
      signal: controller.signal,
    });
    const headBytes = variant.diagnosticOnly
      ? new Uint8Array()
      : await readLimitedBody(response, LIVE_REQUEST_CONTRACT_HEAD_BYTES, controller.signal);
    const contentType = sanitizeHeaderToken(response.headers.get('content-type'));
    const location = describeSafeLocation(response.headers.get('location'), url);
    const classification = variant.diagnosticOnly
      ? classifyLiveProbeEvidence({
          httpStatus: response.status,
          contentType,
          failed: response.status >= 400,
        })
      : classifyLiveProbeEvidence({
          httpStatus: response.status,
          contentType,
          headBytes,
        });
    const redirected = Boolean(response.redirected) || (response.status >= 300 && response.status < 400);
    return {
      variantId: variant.id,
      changedField: variant.changedField,
      method: 'GET',
      userAgentCategory: userAgent.category,
      userAgentHash: userAgent.hash,
      accept,
      acceptEncoding,
      rangePresent: range.present,
      rangeShape: range.shape,
      refererPresent: requestHeaders.has('Referer'),
      originPresent: requestHeaders.has('Origin'),
      connection: sanitizeHeaderToken(requestHeaders.get('Connection') ?? response.headers.get('connection')),
      redirectFollow,
      httpStatus: response.status,
      contentType,
      serverHeader: sanitizeServerHeader(response.headers.get('server')),
      locationPresent: location.present,
      locationProtocol: location.protocol,
      locationHostnameHash: location.hostnameHash,
      locationPathShape: location.pathShape,
      redirected,
      httpToHttpsRedirect: location.httpToHttpsRedirect,
      hostRedirect: location.hostRedirect,
      classification,
      success: isLiveRequestContractSuccess({
        httpStatus: response.status,
        classification,
        redirected,
      }),
      elapsedMs: Math.max(0, Date.now() - startedAt),
    };
  } catch {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const timedOut = controller.signal.aborted || elapsedMs >= LIVE_REQUEST_CONTRACT_TIMEOUT_MS - 20;
    return {
      variantId: variant.id,
      changedField: variant.changedField,
      method: 'GET',
      userAgentCategory: userAgent.category,
      userAgentHash: userAgent.hash,
      accept,
      acceptEncoding,
      rangePresent: range.present,
      rangeShape: range.shape,
      refererPresent: requestHeaders.has('Referer'),
      originPresent: requestHeaders.has('Origin'),
      connection: sanitizeHeaderToken(requestHeaders.get('Connection')),
      redirectFollow,
      httpStatus: null,
      contentType: null,
      serverHeader: null,
      locationPresent: false,
      locationProtocol: null,
      locationHostnameHash: null,
      locationPathShape: null,
      redirected: false,
      httpToHttpsRedirect: false,
      hostRedirect: false,
      classification: classifyLiveProbeEvidence({ timedOut, failed: !timedOut }),
      success: false,
      elapsedMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeSafeLocation(location: string | null, sourceUrl: string) {
  const raw = String(location ?? '').trim();
  if (!raw) {
    return {
      present: false,
      protocol: null as string | null,
      hostnameHash: null as string | null,
      pathShape: null as string | null,
      httpToHttpsRedirect: false,
      hostRedirect: false,
    };
  }
  try {
    const resolved = new URL(raw, sourceUrl);
    const source = new URL(sourceUrl);
    const described = describeSafeLivePathShape(resolved.toString());
    return {
      present: true,
      protocol: described.protocol,
      hostnameHash: described.hostnameHash,
      pathShape: described.pathShape,
      httpToHttpsRedirect: source.protocol === 'http:' && resolved.protocol === 'https:',
      hostRedirect: source.hostname !== resolved.hostname,
    };
  } catch {
    return {
      present: true,
      protocol: null,
      hostnameHash: null,
      pathShape: 'relative',
      httpToHttpsRedirect: false,
      hostRedirect: false,
    };
  }
}

async function readLimitedBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
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
        // Ignore cancel races after classification.
      }
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.slice(0, maxBytes);
  }
  try {
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer).slice(0, maxBytes);
  } catch {
    return new Uint8Array();
  }
}

function sanitizeHeaderToken(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.split(';')[0]?.trim() ?? '';
  if (!trimmed || /https?:|@{1}|\/{2}|user|pass|token|auth/i.test(trimmed)) {
    return trimmed && !/https?:|user|pass|token|auth/i.test(trimmed) ? trimmed.slice(0, 64) : null;
  }
  return trimmed.slice(0, 64);
}

function sanitizeServerHeader(value: string | null | undefined): string | null {
  const token = sanitizeHeaderToken(value);
  if (!token) {
    return null;
  }
  if (/nginx|apache|caddy|openresty|cloudflare|litespeed|iis|envoy/i.test(token)) {
    return token.slice(0, 40);
  }
  return 'other';
}

function hashToken(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function yieldMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
