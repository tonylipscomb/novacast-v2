import { getMovieCatalogIndex } from '../movies/smart/movieCatalogIndex.ts';
import { getSeriesCatalogIndex } from '../series/smart/seriesCatalogIndex.ts';

import { liveChannelIndexSize } from './liveChannelIndex.ts';
import { guideProgramIndexSize } from './guideProgramIndex.ts';

export type SearchIndexReadiness = {
  moviesReady: boolean;
  seriesReady: boolean;
  liveReady: boolean;
  guideReady: boolean;
  anyReady: boolean;
  movieIndexSize: number;
  seriesIndexSize: number;
  liveIndexSize: number;
  guideIndexSize: number;
};

export function getSearchIndexReadiness(providerId: string): SearchIndexReadiness {
  const movieIndexSize = getMovieCatalogIndex(providerId).size;
  const seriesIndexSize = getSeriesCatalogIndex(providerId).size;
  const liveIndexSize = liveChannelIndexSize(providerId);
  const guideIndexSize = guideProgramIndexSize(providerId);

  const moviesReady = movieIndexSize > 0;
  const seriesReady = seriesIndexSize > 0;
  const liveReady = liveIndexSize > 0;
  const guideReady = guideIndexSize > 0;

  return {
    moviesReady,
    seriesReady,
    liveReady,
    guideReady,
    anyReady: moviesReady || seriesReady || liveReady || guideReady,
    movieIndexSize,
    seriesIndexSize,
    liveIndexSize,
    guideIndexSize,
  };
}
