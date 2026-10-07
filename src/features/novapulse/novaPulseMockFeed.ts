import type { NovaPulseItem } from './novaPulseTypes';

const NOVACAST_BACKGROUND = require('../../../assets/images/ncnewbackground.png') as number;

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
];
