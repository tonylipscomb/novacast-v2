export type CatalogMediaJobClassification = {
  movieOk: boolean;
  seriesOk: boolean;
  liveOk: boolean;
  movieError: string | null;
  seriesError: string | null;
  liveError: string | null;
  movieStatus: 'fulfilled' | 'rejected';
  seriesStatus: 'fulfilled' | 'rejected';
  liveStatus: 'fulfilled' | 'rejected';
  outcome: 'ok' | 'sync-partial-failed' | 'sync-failed';
  abortMovieIndex: boolean;
  abortSeriesIndex: boolean;
  notifyProviderError: boolean;
};

export function errorMessageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function settledJobErrorMessage(result: PromiseSettledResult<unknown>): string | null {
  if (result.status === 'fulfilled') {
    return null;
  }
  return errorMessageFromUnknown(result.reason);
}

export function firstSettledRejection(results: PromiseSettledResult<unknown>[]): unknown {
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  return rejected?.reason ?? new Error('catalog_sync_partial_failure');
}

export function classifyCatalogMediaJobResults(
  movieResult: PromiseSettledResult<unknown>,
  seriesResult: PromiseSettledResult<unknown>,
  liveResult?: PromiseSettledResult<unknown>,
): CatalogMediaJobClassification {
  const movieOk = movieResult.status === 'fulfilled';
  const seriesOk = seriesResult.status === 'fulfilled';
  const liveOk = liveResult ? liveResult.status === 'fulfilled' : true;
  const movieError = settledJobErrorMessage(movieResult);
  const seriesError = settledJobErrorMessage(seriesResult);
  const liveError = liveResult ? settledJobErrorMessage(liveResult) : null;
  const allOk = movieOk && seriesOk && liveOk;
  const anyOk = movieOk || seriesOk || liveOk;
  return {
    movieOk,
    seriesOk,
    liveOk,
    movieError,
    seriesError,
    liveError,
    movieStatus: movieResult.status,
    seriesStatus: seriesResult.status,
    liveStatus: liveResult?.status ?? 'fulfilled',
    outcome: allOk ? 'ok' : anyOk ? 'sync-partial-failed' : 'sync-failed',
    abortMovieIndex: !movieOk,
    abortSeriesIndex: !seriesOk,
    notifyProviderError: !movieOk,
  };
}

export async function awaitCatalogMediaJobs(
  movieJob: Promise<unknown>,
  seriesJob: Promise<unknown>,
  liveJob?: Promise<unknown>,
): Promise<CatalogMediaJobClassification & { results: PromiseSettledResult<unknown>[] }> {
  const results = liveJob
    ? await Promise.allSettled([movieJob, seriesJob, liveJob])
    : await Promise.allSettled([movieJob, seriesJob]);
  return {
    ...classifyCatalogMediaJobResults(results[0], results[1], results[2]),
    results,
  };
}
