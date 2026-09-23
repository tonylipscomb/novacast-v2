import type { ImageRef } from 'expo-image';

export type NovaPulseItemType = 'movie' | 'series' | 'sports' | 'live_event' | 'live_epg' | 'announcement';

export type NovaPulseSubtype = 'featured' | 'upcoming' | 'starting_soon' | 'live' | 'final';
export type NovaPulseAnnouncementType = 'feature' | 'update' | 'beta' | 'maintenance' | 'service_alert' | 'notice' | 'promotion' | 'general';
export type NovaPulseAnnouncementPriority = 'low' | 'normal' | 'high' | 'critical';

export type NovaPulseAction = {
  type: 'play' | 'details' | 'channel' | 'none';
  target?: string;
  contentId?: string;
  seriesId?: string;
};

export type NovaPulseRecommendationReason =
  | 'viewers_also_watched'
  | 'trending_novacast'
  | 'because_you_watched'
  | 'favorite_affinity'
  | 'watchlist_affinity'
  | 'continue_watching';

export type NovaPulseRecommendationSignals = {
  reason: NovaPulseRecommendationReason;
  behaviorScore?: number;
  affinityScore?: number;
  trendScore?: number;
  velocity?: number;
  scope?: 'global' | 'provider';
  seedCorrelationToken?: string;
  catalogMatchToken?: string;
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
  awayTeamLogoUrl?: string;
  homeTeamLogoUrl?: string;
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
  countryCode?: string;
  genres?: string[];
  runtimeMinutes?: number;
  network?: string;
  rating?: number;
  ratingSource?: string;
  contentRating?: string;
  releaseDate?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  catalogStatus?: 'RECENTLY ADDED' | 'NEW RELEASE' | 'NEW EPISODE' | 'TRENDING' | 'FEATURED' | 'COMING SOON';
  artworkFit?: 'cover' | 'contain';
  artworkKind?: 'program' | 'channel_logo' | 'fallback';
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
  /** Provider `added` lineage; carried only for Movie freshness presentation/ranking. */
  addedAt?: number;
  sortPriority?: number;
  dedupeKey?: string;
  recommendation?: NovaPulseRecommendationSignals;
  channelId?: string;
  channelCategoryId?: string;
  channelName?: string;
  channelLogoUrl?: string;
  programTitle?: string;
  programDescription?: string;
  programStartAt?: number;
  programEndAt?: number;
  timingReason?: 'on_now' | 'up_next' | 'tonight';
  channelReason?: 'favorite_channel' | 'recent_channel';
  progress?: number;
};

export type NovaPulseSourceResult = {
  sourceId: string;
  items: NovaPulseItem[];
  fetchedAt?: number;
};
