import type { SeriesSummary } from '@/features/media-browser/mediaTypes';
import type { MovieSummary } from '@/features/movies/movieTypes';

import type { MovieSearchResult, SeriesSearchResult } from './searchTypes';

export function movieSearchResultToSummary(result: MovieSearchResult): MovieSummary {
  return {
    id: result.id,
    categoryId: result.categoryId ?? '',
    title: result.title,
    year: result.year,
    rating: result.rating,
    genres: result.genres ?? ['Movies'],
    posterUrl: result.posterUrl,
    posterStyleKey: 'ember',
    description: 'From your NovaCast library search.',
  };
}

export function seriesSearchResultToSummary(result: SeriesSearchResult): SeriesSummary {
  return {
    id: result.id,
    seriesId: result.seriesId ?? result.id,
    categoryId: result.categoryId ?? '',
    title: result.title,
    year: result.year,
    rating: result.rating,
    genres: result.genres ?? ['Series'],
    posterUrl: result.posterUrl,
    posterStyleKey: 'ember',
  };
}
