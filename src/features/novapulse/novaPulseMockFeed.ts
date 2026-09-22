import type { NovaPulseItem } from './novaPulseTypes';

const NOVACAST_BACKGROUND = require('../../../assets/images/ncnewbackground.png') as number;
const NOVACAST_CARD = require('../../../assets/images/novacastnewcard.png') as number;

// Sports cards must come only from the verified sports feed; this mock source
// intentionally contains announcements and no stale game promotions.
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
];
