import { describeSafeLivePathShape } from './livePlaybackUrlContract.ts';

export const LIVE_STREAM_ROW_DIAG = '[NovaCast Live Stream Row]';

export type LiveStreamRowStage =
  | 'xtream-api-row'
  | 'provider-channel'
  | 'sqlite-persisted'
  | 'hydrated-playback';

export type DirectSourceKind = 'empty' | 'relative' | 'http' | 'https' | 'rejected-scheme' | 'invalid';

export type DirectSourceClassification = {
  present: boolean;
  kind: DirectSourceKind;
  intendedForPlayback: boolean;
  protocol: string | null;
  hostnameHash: string | null;
  pathShape: string | null;
  pathSegmentCount: number | null;
};

const REJECTED_DIRECT_SOURCE_SCHEMES = /^(javascript|file|content|data|about|blob):/i;

export type LiveStreamRowInspection = {
  fieldNames: string[];
  streamId: string | null;
  categoryId: string | null;
  directSourcePresent: boolean;
  directSource: DirectSourceClassification;
  containerExtensionKeyPresent: boolean;
  containerExtension: string | null;
  streamType: string | null;
  customSidPresent: boolean;
  urlLikeFieldPresent: boolean;
};

const URL_LIKE_KEYS = ['direct_source', 'directSource', 'url', 'source', 'stream_url', 'streamUrl', 'playback_url'];
const loggedStages = new Set<string>();
let sampledStreamId: string | null = null;

export function resetLiveStreamRowDiagnosticsForTests() {
  loggedStages.clear();
  sampledStreamId = null;
}

export function getSampledLiveStreamId() {
  return sampledStreamId;
}

export function inspectLiveStreamRow(row: unknown): LiveStreamRowInspection {
  const record = asRecord(row);
  const fieldNames = Object.keys(record).sort();
  const containerRaw = firstDefined(record, ['container_extension', 'containerExtension', 'stream_extension', 'streamExtension']);
  const containerExtension = nonemptyString(containerRaw);
  const directSource = nonemptyString(firstDefined(record, ['direct_source', 'directSource', 'streamUrl']));
  const streamType = nonemptyString(firstDefined(record, ['stream_type', 'streamType']));
  const streamId = nonemptyString(firstDefined(record, ['stream_id', 'streamId', 'id', 'channel_id', 'channelId']));
  const categoryId = nonemptyString(firstDefined(record, ['category_id', 'categoryId']));

  return {
    fieldNames,
    streamId,
    categoryId,
    directSourcePresent: Boolean(directSource),
    directSource: classifyDirectSourceSafely(directSource),
    containerExtensionKeyPresent: hasKey(record, ['container_extension', 'containerExtension', 'stream_extension', 'streamExtension']),
    containerExtension,
    streamType,
    customSidPresent: Boolean(nonemptyString(firstDefined(record, ['custom_sid', 'customSid']))),
    urlLikeFieldPresent: URL_LIKE_KEYS.some((key) => looksLikeHttpUrl(record[key])),
  };
}

export function classifyDirectSourceSafely(value: string | null | undefined): DirectSourceClassification {
  const url = nonemptyString(value);
  if (!url) {
    return emptyDirectSourceClassification();
  }

  if (REJECTED_DIRECT_SOURCE_SCHEMES.test(url)) {
    return {
      present: true,
      kind: 'rejected-scheme',
      intendedForPlayback: false,
      protocol: url.split(':', 1)[0]?.toLowerCase() ?? 'invalid',
      hostnameHash: null,
      pathShape: null,
      pathSegmentCount: null,
    };
  }

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
    return {
      present: true,
      kind: 'relative',
      intendedForPlayback: false,
      protocol: null,
      hostnameHash: null,
      pathShape: null,
      pathSegmentCount: null,
    };
  }

  if (!/^https?:\/\//i.test(url)) {
    return {
      present: true,
      kind: 'rejected-scheme',
      intendedForPlayback: false,
      protocol: url.split(':', 1)[0]?.toLowerCase() ?? 'invalid',
      hostnameHash: null,
      pathShape: null,
      pathSegmentCount: null,
    };
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        present: true,
        kind: 'rejected-scheme',
        intendedForPlayback: false,
        protocol: parsed.protocol.replace(/:$/, ''),
        hostnameHash: null,
        pathShape: null,
        pathSegmentCount: null,
      };
    }
    const described = describeSafeLivePathShape(parsed.toString());
    const path = parsed.pathname.toLowerCase();
    const intendedForPlayback =
      Boolean(parsed.hostname) &&
      described.pathShape !== 'invalid' &&
      !/login|portal|player_api|xmltv/i.test(`${described.pathShape} ${path}`);
    return {
      present: true,
      kind: parsed.protocol === 'https:' ? 'https' : 'http',
      intendedForPlayback,
      protocol: described.protocol,
      hostnameHash: described.hostnameHash,
      pathShape: described.pathShape,
      pathSegmentCount: described.pathSegmentCount,
    };
  } catch {
    return {
      present: true,
      kind: 'invalid',
      intendedForPlayback: false,
      protocol: 'invalid',
      hostnameHash: null,
      pathShape: null,
      pathSegmentCount: null,
    };
  }
}

export function persistableLiveDirectSource(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export function resolveUsableLiveDirectSource(value: string | null | undefined): string | null {
  const raw = nonemptyString(value);
  if (!raw) {
    return null;
  }
  const classified = classifyDirectSourceSafely(raw);
  return classified.intendedForPlayback ? raw : null;
}

export function logLiveDirectSourcePlaybackDecision(input: {
  streamId: string | number;
  rawDirectSource?: string | null;
  selectedAsPlaybackSource: boolean;
  sourcePrecedence: string;
}) {
  const classified = classifyDirectSourceSafely(input.rawDirectSource);
  console.info(LIVE_STREAM_ROW_DIAG, {
    stage: 'playback-source',
    streamId: String(input.streamId).trim(),
    directSourcePresent: classified.present,
    protocol: classified.protocol,
    hostnameHash: classified.hostnameHash,
    pathShape: classified.pathShape,
    selectedAsPlaybackSource: input.selectedAsPlaybackSource,
    sourcePrecedence: input.sourcePrecedence,
    directSourceKind: classified.kind,
    intendedForPlayback: classified.intendedForPlayback,
  });
}

function emptyDirectSourceClassification(): DirectSourceClassification {
  return {
    present: false,
    kind: 'empty',
    intendedForPlayback: false,
    protocol: null,
    hostnameHash: null,
    pathShape: null,
    pathSegmentCount: null,
  };
}

export function logSampledLiveStreamRow(stage: LiveStreamRowStage, row: unknown, extra: Record<string, unknown> = {}) {
  const inspection = inspectLiveStreamRow(row);
  if (!sampledStreamId && inspection.streamId) {
    sampledStreamId = inspection.streamId;
  }
  if (sampledStreamId && inspection.streamId && inspection.streamId !== sampledStreamId && stage !== 'xtream-api-row') {
    return inspection;
  }
  if (loggedStages.has(stage)) {
    return inspection;
  }
  loggedStages.add(stage);

  console.info(LIVE_STREAM_ROW_DIAG, {
    stage,
    sampledStreamId: sampledStreamId ?? inspection.streamId,
    sampledStreamIdMatch: !sampledStreamId || inspection.streamId === sampledStreamId,
    fieldNames: inspection.fieldNames,
    streamId: inspection.streamId,
    categoryId: inspection.categoryId,
    directSourcePresent: inspection.directSourcePresent,
    directSourceIntendedForPlayback: inspection.directSource.intendedForPlayback,
    directSourceKind: inspection.directSource.kind,
    directSourceProtocol: inspection.directSource.protocol,
    directSourceHostnameHash: inspection.directSource.hostnameHash,
    directSourcePathShape: inspection.directSource.pathShape,
    containerExtensionKeyPresent: inspection.containerExtensionKeyPresent,
    containerExtension: inspection.containerExtension,
    streamType: inspection.streamType,
    customSidPresent: inspection.customSidPresent,
    urlLikeFieldPresent: inspection.urlLikeFieldPresent,
    ...extra,
  });

  return inspection;
}

export function logSampledLiveStreamHint(stage: LiveStreamRowStage, hint: Partial<LiveStreamRowInspection> & Record<string, unknown>) {
  if (loggedStages.has(stage)) {
    return;
  }
  loggedStages.add(stage);
  const streamId = nonemptyString(hint.streamId);
  if (!sampledStreamId && streamId) {
    sampledStreamId = streamId;
  }
  console.info(LIVE_STREAM_ROW_DIAG, {
    stage,
    sampledStreamId: sampledStreamId ?? streamId,
    fieldNames: Array.isArray(hint.fieldNames) ? hint.fieldNames : [],
    streamId,
    categoryId: nonemptyString(hint.categoryId),
    directSourcePresent: Boolean(hint.directSourcePresent),
    containerExtensionKeyPresent: Boolean(hint.containerExtensionKeyPresent),
    containerExtension: nonemptyString(hint.containerExtension) ?? null,
    streamType: nonemptyString(hint.streamType) ?? null,
    customSidPresent: Boolean(hint.customSidPresent),
    urlLikeFieldPresent: Boolean(hint.urlLikeFieldPresent),
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function hasKey(record: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function firstDefined(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (record[key] != null) {
      return record[key];
    }
  }
  return undefined;
}

function nonemptyString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function looksLikeHttpUrl(value: unknown) {
  if (typeof value !== 'string') {
    return false;
  }
  return /^https?:\/\//i.test(value.trim());
}
