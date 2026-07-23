import type { SearchMatchTier } from './searchRanking';

export type SearchScope = 'all' | 'live' | 'movie' | 'series' | 'guide';

export type SearchLoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export type SearchPageRequest = {
  providerId: string;
  query: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
};

export type SearchPageResult<T> = {
  items: T[];
  totalCount: number;
  hasMore: boolean;
};

export type SearchResultBase = {
  id: string;
  providerId: string;
  title: string;
  matchTier?: SearchMatchTier;
};

export type LiveSearchResult = SearchResultBase & {
  type: 'live';
  subtitle?: string;
  channelNumber?: number;
  logoUrl?: string;
  tone?: string;
  categoryId?: string;
  currentProgram?: string;
};

export type MovieSearchResult = SearchResultBase & {
  type: 'movie';
  year?: number;
  posterUrl?: string;
  genres?: string[];
  rating?: string;
  categoryId?: string;
};

export type SeriesSearchResult = SearchResultBase & {
  type: 'series';
  year?: string;
  posterUrl?: string;
  genres?: string[];
  rating?: string;
  seriesId?: string;
  categoryId?: string;
  episodeHint?: string;
};

export type GuideSearchResult = SearchResultBase & {
  type: 'guide';
  channelId: string;
  channelName: string;
  programId: string;
  startsAt?: number;
  endsAt?: number;
  description?: string;
  status?: 'live' | 'upcoming' | 'ended';
};

export type SearchResult = LiveSearchResult | MovieSearchResult | SeriesSearchResult | GuideSearchResult;

export type GroupedSearchResults = {
  live: SearchPageResult<LiveSearchResult>;
  movie: SearchPageResult<MovieSearchResult>;
  series: SearchPageResult<SeriesSearchResult>;
  guide: SearchPageResult<GuideSearchResult>;
};

export type SearchHistoryEntry = {
  query: string;
  timestamp: number;
};
