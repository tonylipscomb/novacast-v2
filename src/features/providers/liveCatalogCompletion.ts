import { fallbackProviderCategoryId } from './categoryNormalization.ts';
import { logSampledLiveStreamRow } from './liveStreamRowDiagnostics.ts';

export type LiveCatalogIngestionStrategy = 'full-dump-stream-category';

export const LIVE_UNKNOWN_CATEGORY_ID = fallbackProviderCategoryId('live');

export type LiveCatalogCompletionInput = {
  strategy: LiveCatalogIngestionStrategy;
  fullDumpCompleted: boolean;
  decodedLiveCount: number;
  distinctLiveStreamIds: number;
  categoryAssignmentFinished: boolean;
  cancelled: boolean;
  staleGeneration: boolean;
  fatalError: boolean;
};

export type LiveCatalogCompletionDecision = {
  publish: boolean;
  completionDecision: 'publish' | 'reject';
  completionReason: string;
};

export function canonicalLiveStreamId(record: {
  contentId?: string | null;
  streamId?: string | null;
}): string {
  const streamId = typeof record.streamId === 'string' ? record.streamId.trim() : '';
  if (streamId) {
    return streamId;
  }
  return typeof record.contentId === 'string' ? record.contentId.trim() : '';
}

export function derivedLiveCategoryName(categoryId: string): string {
  const id = String(categoryId ?? '').trim();
  if (!id || id === LIVE_UNKNOWN_CATEGORY_ID) {
    return 'Unknown';
  }
  return `Live ${id}`;
}

export function assignLiveStreamCategoryId(rawCategoryId: unknown): string {
  const id = String(rawCategoryId ?? '').trim();
  return id || LIVE_UNKNOWN_CATEGORY_ID;
}

export function unknownLiveStreamCategoryIds(
  metadataCategoryIds: Iterable<string>,
  streamCategoryIds: Iterable<string>,
): string[] {
  const known = new Set(
    Array.from(metadataCategoryIds)
      .map((id) => String(id).trim())
      .filter(Boolean),
  );
  const unknown: string[] = [];
  for (const raw of streamCategoryIds) {
    const id = String(raw).trim();
    if (id && id !== LIVE_UNKNOWN_CATEGORY_ID && !known.has(id)) {
      unknown.push(id);
    }
  }
  unknown.sort();
  return unknown;
}

export function mergeLiveMetadataWithDumpCategories(input: {
  metadata: Array<{ id: string; name: string }>;
  streamCategoryIds: Iterable<string>;
  missingCategoryIdCount: number;
}): {
  categories: Array<{ id: string; name: string; derived: boolean }>;
  streamCategoryIdsMissingFromMetadata: string[];
  unknownCategoryAssignedCount: number;
} {
  const metadata = input.metadata
    .map((category) => ({
      id: String(category.id ?? '').trim(),
      name: String(category.name ?? '').trim() || derivedLiveCategoryName(String(category.id ?? '')),
      derived: false,
    }))
    .filter((category) => category.id);
  const known = new Set(metadata.map((category) => category.id));
  const missing = unknownLiveStreamCategoryIds(known, input.streamCategoryIds);
  const derived = missing.map((id) => ({
    id,
    name: derivedLiveCategoryName(id),
    derived: true,
  }));
  const categories = [...metadata, ...derived];
  if (input.missingCategoryIdCount > 0 && !known.has(LIVE_UNKNOWN_CATEGORY_ID)) {
    categories.push({
      id: LIVE_UNKNOWN_CATEGORY_ID,
      name: derivedLiveCategoryName(LIVE_UNKNOWN_CATEGORY_ID),
      derived: true,
    });
  }
  return {
    categories,
    streamCategoryIdsMissingFromMetadata: missing,
    unknownCategoryAssignedCount: missing.length + (input.missingCategoryIdCount > 0 ? 1 : 0),
  };
}

export function decideLiveCatalogCompletion(
  input: LiveCatalogCompletionInput,
): LiveCatalogCompletionDecision {
  if (input.cancelled || input.staleGeneration) {
    return {
      publish: false,
      completionDecision: 'reject',
      completionReason: 'cancelled-or-stale',
    };
  }
  if (input.fatalError) {
    return {
      publish: false,
      completionDecision: 'reject',
      completionReason: 'fatal-decode-or-write',
    };
  }
  if (!input.fullDumpCompleted) {
    return {
      publish: false,
      completionDecision: 'reject',
      completionReason: 'full-dump-not-completed',
    };
  }
  if (input.decodedLiveCount <= 0 || input.distinctLiveStreamIds <= 0) {
    return {
      publish: false,
      completionDecision: 'reject',
      completionReason: 'full-dump-empty',
    };
  }
  if (!input.categoryAssignmentFinished) {
    return {
      publish: false,
      completionDecision: 'reject',
      completionReason: 'category-assignment-invalid',
    };
  }
  return {
    publish: true,
    completionDecision: 'publish',
    completionReason: 'full-dump-succeeded',
  };
}

export function extractLiveNativeRecordPlaybackFields(raw: unknown): {
  streamExtension: string | null;
  directSource: string | null;
} {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  return {
    streamExtension: nonemptyPlaybackField(record.container_extension ?? record.containerExtension),
    directSource: nonemptyPlaybackField(record.direct_source ?? record.directSource),
  };
}

function nonemptyPlaybackField(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export function nativeRecordToLiveChannel(
  record: {
    contentId?: string | null;
    categoryId?: string | null;
    title?: string | null;
    artworkUrl?: string | null;
    streamExtension?: string | null;
    directSource?: string | null;
    providerSortOrder?: number | null;
  },
  index: number,
): {
  id: string;
  categoryId: string;
  number: number;
  name: string;
  shortName: string;
  current: string;
  next: string;
  following: string;
  description: string;
  resolution: string;
  audio: string;
  remaining: string;
  progress: number;
  tone: string;
  currentStart: string;
  currentEnd: string;
  logoUrl?: string;
  containerExtension?: string;
  streamUrl?: string;
} {
  const id = canonicalLiveStreamId(record);
  const categoryId = assignLiveStreamCategoryId(record.categoryId);
  const name = String(record.title ?? '').trim() || `Channel ${index + 1}`;
  const channel = {
    id,
    categoryId,
    number: Number.isFinite(Number(record.providerSortOrder)) ? Number(record.providerSortOrder) : index + 1,
    name,
    shortName: name.slice(0, 16),
    current: '',
    next: 'Next program unavailable',
    following: 'Following program unavailable',
    description: 'No program information available.',
    resolution: String(record.streamExtension ?? '') === 'm3u8' ? 'FHD' : 'HD',
    audio: 'Stereo',
    remaining: 'Live',
    progress: 0,
    tone: '#173B67',
    currentStart: 'Now',
    currentEnd: 'Later',
    logoUrl: record.artworkUrl ?? undefined,
    containerExtension: record.streamExtension ?? undefined,
    streamUrl: record.directSource ?? undefined,
  };
  logSampledLiveStreamRow('provider-channel', {
    stream_id: channel.id,
    category_id: channel.categoryId,
    container_extension: channel.containerExtension,
    containerExtension: channel.containerExtension,
    direct_source: channel.streamUrl,
    streamUrl: channel.streamUrl,
  });
  return channel;
}

export function logLiveFullDumpSync(fields: Record<string, unknown>) {
  console.info(
    '[NovaCast Live Full Dump Sync]',
    JSON.stringify({
      strategy: 'full-dump-stream-category',
      ...fields,
    }),
  );
}

export const LIVE_PUBLICATION_TRACE = '[NovaCast Live Publication Trace]';

export function logLivePublicationTrace(event: string, fields: Record<string, unknown> = {}) {
  console.info(
    LIVE_PUBLICATION_TRACE,
    JSON.stringify({
      event,
      providerId: fields.providerId ?? null,
      requestSource: fields.requestSource ?? null,
      rawCount: fields.rawCount ?? null,
      distinctCount: fields.distinctCount ?? null,
      publishedCount: fields.publishedCount ?? null,
      skipReason: fields.skipReason ?? null,
      generation: fields.generation ?? null,
      ...fields,
    }),
  );
}
