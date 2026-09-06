import AsyncStorage from '@react-native-async-storage/async-storage';

export type CatalogCheckpointStage = 'movies' | 'series' | 'smart' | 'complete';

const CATALOG_SYNC_CHECKPOINT_PREFIX = '@novacast/catalog-sync-checkpoint/';

export type CatalogCheckpointResumeInput = {
  checkpointMatches: boolean;
  stage: CatalogCheckpointStage | null;
  movieIndex: number;
  seriesIndex: number;
  movieCategoryCount: number;
  seriesCategoryCount: number;
  movieCountMap?: Record<string, number>;
  seriesCountMap?: Record<string, number>;
  readableMovieGeneration: number;
};

export type CatalogCheckpointResume = {
  shouldSkipMovieSync: boolean;
  canResumeMovieCheckpoint: boolean;
  resumeMovieIndex: number;
  canResumeSeriesCheckpoint: boolean;
  resumeSeriesIndex: number;
  movieCountMap: Record<string, number>;
  seriesCountMap: Record<string, number>;
};

function copyCountMap(counts: Record<string, number> | undefined): Record<string, number> {
  return counts ? { ...counts } : {};
}

function movieIndexForStage(
  stage: CatalogCheckpointStage,
  movieIndex: number,
  movieCategoryCount: number,
): number {
  if (stage === 'movies') {
    return movieIndex;
  }
  if (stage === 'series' || stage === 'smart' || stage === 'complete') {
    return movieCategoryCount;
  }
  return 0;
}

function seriesIndexForStage(
  stage: CatalogCheckpointStage,
  seriesIndex: number,
  seriesCategoryCount: number,
): number {
  if (stage === 'series' || stage === 'smart') {
    return seriesIndex;
  }
  if (stage === 'complete') {
    return seriesCategoryCount;
  }
  return 0;
}

/**
 * Shared AsyncStorage checkpoint is provider-wide. Movie resume is valid only when
 * a readable movie SQLite generation backs it. Series resume can stay independent.
 */
export function resolveCatalogCheckpointResume(
  input: CatalogCheckpointResumeInput,
): CatalogCheckpointResume {
  const seriesCountMap = input.checkpointMatches ? copyCountMap(input.seriesCountMap) : {};
  const canResumeSeriesCheckpoint = Boolean(input.checkpointMatches && input.stage);
  const resumeSeriesIndex =
    canResumeSeriesCheckpoint && input.stage
      ? seriesIndexForStage(input.stage, input.seriesIndex, input.seriesCategoryCount)
      : 0;

  const canResumeMovieCheckpoint = Boolean(
    input.checkpointMatches &&
      input.stage &&
      Number(input.readableMovieGeneration) > 0,
  );
  const resumeMovieIndex =
    canResumeMovieCheckpoint && input.stage
      ? movieIndexForStage(input.stage, input.movieIndex, input.movieCategoryCount)
      : 0;
  const movieCountMap = canResumeMovieCheckpoint ? copyCountMap(input.movieCountMap) : {};

  return {
    shouldSkipMovieSync:
      canResumeMovieCheckpoint && input.stage === 'complete' && resumeMovieIndex >= input.movieCategoryCount,
    canResumeMovieCheckpoint,
    resumeMovieIndex,
    canResumeSeriesCheckpoint,
    resumeSeriesIndex,
    movieCountMap,
    seriesCountMap,
  };
}

export function invalidateMovieProgressInCheckpoint<T extends {
  movieIndex: number;
  movieCountMap: Record<string, number>;
}>(checkpoint: T): T {
  return {
    ...checkpoint,
    movieIndex: 0,
    movieCountMap: {},
  };
}

export async function persistInvalidatedMovieCheckpointProgress(providerId: string): Promise<boolean> {
  if (!providerId || typeof AsyncStorage.getItem !== 'function') {
    return false;
  }
  try {
    const key = `${CATALOG_SYNC_CHECKPOINT_PREFIX}${providerId}`;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw) as {
      movieIndex?: number;
      movieCountMap?: Record<string, number>;
    };
    if (!parsed || typeof parsed !== 'object') {
      return false;
    }
    const next = invalidateMovieProgressInCheckpoint({
      ...parsed,
      movieIndex: Number(parsed.movieIndex ?? 0),
      movieCountMap: parsed.movieCountMap && typeof parsed.movieCountMap === 'object' ? parsed.movieCountMap : {},
    });
    if (typeof AsyncStorage.setItem !== 'function') {
      return false;
    }
    await AsyncStorage.setItem(key, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
