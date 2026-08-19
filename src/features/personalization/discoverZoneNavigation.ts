export const DISCOVERY_ZONE_ORIGIN = 'discovery-zone' as const;

export type DiscoverZoneDetailOrigin = typeof DISCOVERY_ZONE_ORIGIN;

export type DetailLaunchOrigin = 'browse' | 'search' | 'home' | DiscoverZoneDetailOrigin;

export const DISCOVERY_NAV_LOG = '[NovaCast Discovery Navigation]';

export function shouldReturnToDiscoverZone(origin: string | null | undefined) {
  return origin === DISCOVERY_ZONE_ORIGIN;
}

export function shouldRestoreBrowseFocusAfterDetailClose(origin: string | null | undefined) {
  return origin !== DISCOVERY_ZONE_ORIGIN && origin !== 'search';
}

export function logDiscoverZoneDetailOpen(fields: {
  mediaType: 'movie' | 'series';
  itemId: string | null;
  origin?: DiscoverZoneDetailOrigin;
}) {
  console.info(DISCOVERY_NAV_LOG, {
    event: 'detail-open',
    mediaType: fields.mediaType,
    origin: fields.origin ?? DISCOVERY_ZONE_ORIGIN,
    itemId: fields.itemId,
  });
}

export function logDiscoverZoneDetailBack(fields: {
  itemId: string | null;
  origin?: DiscoverZoneDetailOrigin;
  destination?: DiscoverZoneDetailOrigin;
}) {
  console.info(DISCOVERY_NAV_LOG, {
    event: 'detail-back',
    origin: fields.origin ?? DISCOVERY_ZONE_ORIGIN,
    destination: fields.destination ?? DISCOVERY_ZONE_ORIGIN,
    itemId: fields.itemId,
  });
}
