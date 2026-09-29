export type MovieCatalogIngestionStrategy = 'full-dump-stream-category' | 'filtered-per-category';

export type MovieCatalogCompletionInput = {
  strategy: MovieCatalogIngestionStrategy;
  filteringReliable: boolean;
  movieCategoryCount: number;
  categoryLoopFinished: boolean;
  categoryDataObserved: boolean;
  fullDumpCompleted: boolean;
  decodedStreamCount: number;
  distinctContentIds: number;
  distinctStreamCategoryIds: number;
  missingCategoryIdCount: number;
  categoryAssignmentFinished: boolean;
  sqliteWriterEnabled: boolean;
  cancelled: boolean;
  staleGeneration: boolean;
  fatalError: boolean;
};

export type MovieCatalogCompletionDecision = {
  publish: boolean;
  categoryCrawlTerminal: boolean;
  completionDecision: 'publish' | 'reject';
  completionReason: string;
};

export function decideMovieCatalogCompletion(
  input: MovieCatalogCompletionInput,
): MovieCatalogCompletionDecision {
  const categoryCrawlTerminal = Boolean(input.categoryLoopFinished && input.categoryDataObserved);

  if (input.cancelled || input.staleGeneration) {
    return {
      publish: false,
      categoryCrawlTerminal,
      completionDecision: 'reject',
      completionReason: 'cancelled-or-stale',
    };
  }
  if (input.fatalError) {
    return {
      publish: false,
      categoryCrawlTerminal,
      completionDecision: 'reject',
      completionReason: 'fatal-decode-or-write',
    };
  }

  if (input.strategy === 'full-dump-stream-category') {
    if (!input.sqliteWriterEnabled) {
      return {
        publish: false,
        categoryCrawlTerminal,
        completionDecision: 'reject',
        completionReason: 'sqlite-writer-invalid',
      };
    }
    if (!input.fullDumpCompleted) {
      return {
        publish: false,
        categoryCrawlTerminal,
        completionDecision: 'reject',
        completionReason: 'full-dump-not-completed',
      };
    }
    if (input.decodedStreamCount <= 0 || input.distinctContentIds <= 0) {
      return {
        publish: false,
        categoryCrawlTerminal,
        completionDecision: 'reject',
        completionReason: 'full-dump-empty',
      };
    }
    if (!input.categoryAssignmentFinished || input.distinctStreamCategoryIds <= 0) {
      return {
        publish: false,
        categoryCrawlTerminal,
        completionDecision: 'reject',
        completionReason: 'category-assignment-invalid',
      };
    }
    return {
      publish: true,
      categoryCrawlTerminal,
      completionDecision: 'publish',
      completionReason: 'full-dump-succeeded',
    };
  }

  if (input.movieCategoryCount > 0 && !categoryCrawlTerminal) {
    return {
      publish: false,
      categoryCrawlTerminal,
      completionDecision: 'reject',
      completionReason: 'category-crawl-not-terminal-or-empty',
    };
  }

  return {
    publish: true,
    categoryCrawlTerminal,
    completionDecision: 'publish',
    completionReason: 'category-crawl-terminal',
  };
}
