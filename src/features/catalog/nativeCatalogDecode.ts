/**
 * Default / Node / web stub — native decode unavailable.
 */
export type {
  CatalogDecodeBatchStats,
  CatalogDecodeMediaType,
  NativeCatalogRecord,
  StreamXtreamCategoryDecodeInput,
  StreamXtreamCategoryDecodeResult,
} from './nativeCatalogDecodeTypes.ts';

export { isLikelyUnfilteredCategoryDump } from './nativeCatalogDecodeTypes.ts';

export {
  isCatalogSqliteWriterOnlyDiagnosticEnabled,
  nativeRecordToMovieSummary,
  nativeRecordToSeriesSummary,
} from './nativeCatalogDecodeShared.ts';

export function isNativeCatalogDecodeAvailable(): boolean {
  return false;
}

export async function streamXtreamCategoryDecode(): Promise<never> {
  throw new Error('native_catalog_decode_unavailable');
}

export async function cancelNativeDecodeJobsForProvider(_providerId: string): Promise<number> {
  return 0;
}

export async function getNativeDecodeJobRegistrySnapshot() {
  return {
    activeJobCount: 0,
    queuedBatchCount: 0,
    oldestJobAgeMs: 0,
    cancellationCount: 0,
    completedJobCleanupCount: 0,
  };
}
