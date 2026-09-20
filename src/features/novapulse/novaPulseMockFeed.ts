import type { NovaPulseItem } from './novaPulseTypes';

const NOVACAST_BACKGROUND = require('../../../assets/images/ncnewbackground.png') as number;
const NOVACAST_CARD = require('../../../assets/images/novacastnewcard.png') as number;
const NOVACAST_PLANET = require('../../../assets/images/novacast-planet.png') as number;

const upcomingStart = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

export const NOVA_PULSE_MOCK_FEED: readonly NovaPulseItem[] = [
  {
    id: 'novaview-coming-soon',
    type: 'announcement',
    subtype: 'featured',
    title: 'NovaView Is Coming',
    message: 'Watch multiple live channels at the same time with NovaCast\'s upcoming multiview experience.',
    secondaryText: 'Available soon in Beta',
    announcementType: 'feature', announcementPriority: 'normal', badgeOverride: 'COMING SOON', ctaLabel: 'Coming Soon', featureName: 'NovaView',
    artworkSource: NOVACAST_BACKGROUND,
    priority: 100,
    action: { type: 'none' },
  },
  {
    id: 'novacast-beta-update',
    type: 'announcement', subtype: 'featured', title: 'NovaCast Beta 24',
    message: 'Performance improvements, Live TV stability upgrades, and new NovaPulse features are now available.',
    version: '1.0.6-beta24', announcementType: 'update', announcementPriority: 'high', ctaLabel: 'See What\'s New', artworkSource: NOVACAST_CARD, priority: 95,
    action: { type: 'none' },
  },
  {
    id: 'novacast-maintenance-notice',
    type: 'announcement', subtype: 'featured', title: 'Scheduled Maintenance',
    message: 'NovaCast services may be briefly unavailable tonight between 2:00 AM and 2:30 AM.',
    secondaryText: 'Tonight • 2:00 AM', announcementType: 'maintenance', announcementPriority: 'critical', badgeOverride: 'SERVICE ALERT', artworkSource: NOVACAST_BACKGROUND, priority: 85,
    action: { type: 'none' },
  },
  {
    id: 'featured-movie-demo',
    type: 'movie',
    subtype: 'featured',
    title: 'Superman',
    description: 'A new chapter begins as Superman balances his Kryptonian heritage with life on Earth.',
    year: 2026, genres: ['Action', 'Adventure'], runtimeMinutes: 128, rating: 7.8, ratingSource: 'IMDb', contentRating: 'PG-13', catalogStatus: 'NEW RELEASE',
    artworkSource: NOVACAST_CARD,
    priority: 90,
    action: { type: 'details', target: '/movies' },
  },
  {
    id: 'featured-series-demo',
    type: 'series',
    subtype: 'featured',
    title: 'The Last Horizon',
    description: 'The crew reaches an abandoned orbital city hiding a dangerous secret.',
    year: 2026, genres: ['Drama', 'Sci-Fi'], seasonNumber: 2, episodeNumber: 4, episodeTitle: 'Signal Lost', rating: 8.4, ratingSource: 'IMDb', catalogStatus: 'NEW EPISODE',
    artworkSource: NOVACAST_PLANET,
    priority: 80,
    action: { type: 'details', target: '/series' },
  },
  {
    id: 'upcoming-sports-demo',
    type: 'sports',
    subtype: 'upcoming',
    title: 'Ravens vs Lions',
    subtitle: 'NFL • Monday Night Football',
    description: 'A primetime matchup under the lights.',
    startsAt: upcomingStart,
    priority: 70,
    sports: {
      format: 'team', sport: 'NFL', league: 'Monday Night Football', eventStage: 'PRIMETIME',
      awayName: 'Baltimore Ravens', homeName: 'Detroit Lions', network: 'ESPN', channelName: 'NovaCast Live TV',
    },
    action: { type: 'none' },
  },
  {
    id: 'upcoming-fight-demo',
    type: 'sports',
    subtype: 'upcoming',
    title: 'Canelo vs Crawford',
    subtitle: 'Boxing • Main Event',
    description: 'A championship fight night showcase.',
    startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    priority: 65,
    sports: {
      format: 'fight', sport: 'BOXING', league: 'Championship Fight Night', eventStage: 'MAIN EVENT',
      competitorA: 'Canelo Alvarez', competitorB: 'Terence Crawford', network: 'PPV',
    },
    action: { type: 'none' },
  },
  {
    id: 'final-sports-demo',
    type: 'sports',
    subtype: 'final',
    title: 'Metro Cup Final',
    subtitle: 'MLS • Championship',
    priority: 60,
    sports: {
      format: 'team', sport: 'MLS', league: 'Championship', eventStage: 'FINAL',
      awayName: 'Portland FC',
      homeName: 'Bay City United',
      finalScoreA: 2, finalScoreB: 1, winnerName: 'Portland FC',
      completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), network: 'NovaCast Live TV',
    },
    action: { type: 'none' },
  },
  {
    id: 'final-fight-demo',
    type: 'sports',
    subtype: 'final',
    title: 'Canelo vs Crawford',
    subtitle: 'Boxing • Main Event',
    priority: 55,
    sports: {
      format: 'fight', sport: 'BOXING', league: 'Championship Fight Night', eventStage: 'MAIN EVENT',
      competitorA: 'Canelo Alvarez', competitorB: 'Terence Crawford', winnerName: 'Canelo Alvarez', loserName: 'Terence Crawford',
      resultMethod: 'unanimous decision', resultRound: 12, resultTime: '2:14', completedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), network: 'PPV',
    },
    action: { type: 'none' },
  },
];
