export type MovieCategoryKind = 'provider' | 'smart' | 'section';

export type MovieCategorySection = 'discover' | 'provider';

export const SMART_CATEGORY_PREFIX = 'smart:';

export type MovieCategory = {
  id: string;
  /** Deterministic unique key for list rendering; use `id` for repository/API queries. */
  renderKey: string;
  name: string;
  /** Original provider label before display normalization; used for US-first ordering. */
  rawName?: string;
  count: number;
  /** Provider categories can render before their count has been resolved. */
  countKnown?: boolean;
  kind?: MovieCategoryKind;
  section?: MovieCategorySection;
  icon?: string;
  smartKey?: string;
  countryCode?: string;
  regionMarker?: 'multi';
};

export type MovieSummary = {
  id: string;
  categoryId: string;
  title: string;
  rawTitle?: string;
  countryCode?: string;
  addedAt?: number;
  releaseDate?: string | number;
  popularity?: number;
  year?: number;
  durationMinutes?: number;
  rating?: string;
  genres: string[];
  description?: string;
  director?: string;
  cast?: string[];
  audio?: string;
  subtitles?: string;
  score?: number;
  audienceScore?: number;
  externalScore?: number;
  posterStyleKey: string;
  posterUrl?: string;
  containerExtension?: string;
};

export type MoviePage = {
  items: MovieSummary[];
  totalCount: number;
  hasMore: boolean;
};
