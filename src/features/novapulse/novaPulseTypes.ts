import type { ImageRef } from 'expo-image';

export type NovaPulseItemType = 'movie' | 'series' | 'sports' | 'live_event' | 'announcement';

export type NovaPulseSubtype = 'featured' | 'upcoming' | 'starting_soon' | 'live' | 'final';
export type NovaPulseAnnouncementType = 'feature' | 'update' | 'beta' | 'maintenance' | 'service_alert' | 'notice' | 'promotion' | 'general';
export type NovaPulseAnnouncementPriority = 'low' | 'normal' | 'high' | 'critical';

export type NovaPulseAction = {
  type: 'play' | 'details' | 'channel' | 'none';
  target?: string;
  contentId?: string;
  seriesId?: string;
};

export type NovaPulseSportsData = {
  format?: 'team' | 'fight';
  sport?: string;
  league?: string;
  eventStage?: string;
  eventStatus?: 'TONIGHT' | 'TOMORROW' | 'UPCOMING' | 'LIVE' | 'FINAL';
  eventTitle?: string;
  competitorA?: string;
  competitorB?: string;
  awayName?: string;
  homeName?: string;
  awayScore?: string | number;
  homeScore?: string | number;
  statusText?: string;
  clockText?: string;
  network?: string;
  channelName?: string;
  channelId?: string;
  venue?: string;
  resultStatus?: 'FINAL' | 'DRAW' | 'NO_CONTEST';
  finalScoreA?: string | number;
  finalScoreB?: string | number;
  winnerName?: string;
  winnerId?: string;
  loserName?: string;
  resultMethod?: string;
  decisionType?: string;
  resultRound?: string | number;
  resultTime?: string;
  periodDetail?: string;
  wentOvertime?: boolean;
  shootout?: boolean;
  isDraw?: boolean;
  isNoContest?: boolean;
  completedAt?: string;
};

export type NovaPulseItem = {
  id: string;
  type: NovaPulseItemType;
  subtype?: NovaPulseSubtype;
  title: string;
  subtitle?: string;
  description?: string;
  badge?: string;
  posterUrl?: string;
  backdropUrl?: string;
  artworkSource?: number;
  artworkUrl?: string;
  artworkRef?: ImageRef;
  priority: number;
  startsAt?: string;
  expiresAt?: string;
  year?: number;
  genres?: string[];
  runtimeMinutes?: number;
  rating?: number;
  ratingSource?: string;
  contentRating?: string;
  releaseDate?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  catalogStatus?: 'NEW RELEASE' | 'NEW EPISODE' | 'TRENDING' | 'FEATURED' | 'COMING SOON';
  artworkFit?: 'cover' | 'contain';
  announcementType?: NovaPulseAnnouncementType;
  announcementPriority?: NovaPulseAnnouncementPriority;
  message?: string;
  secondaryText?: string;
  effectiveAt?: string;
  version?: string;
  featureName?: string;
  ctaLabel?: string;
  badgeOverride?: string;
  sports?: NovaPulseSportsData;
  action?: NovaPulseAction;
  sourceId?: string;
  sourceItemId?: string;
  publishedAt?: number;
  updatedAt?: number;
  sortPriority?: number;
  dedupeKey?: string;
};

export type NovaPulseSourceResult = {
  sourceId: string;
  items: NovaPulseItem[];
  fetchedAt?: number;
};
