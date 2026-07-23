import type { CatalogCompletenessMetadata } from './catalogCompleteness.ts';

export type SmartCategoryCatalogAuditPayload = {
  providerId: string;
  mediaType: 'movie' | 'series';
  categoryKey: string;
  candidateTotal: number;
  catalogCompleteness: CatalogCompletenessMetadata;
};

const AUDIT_ENABLED =
  typeof __DEV__ !== 'undefined' &&
  __DEV__ &&
  (typeof process !== 'undefined' ? process.env?.NOVACAST_CATALOG_AUDIT !== '0' : true);

function abbreviateProviderId(providerId: string) {
  if (!providerId) {
    return 'unknown';
  }
  if (providerId.length <= 8) {
    return providerId;
  }
  return `${providerId.slice(0, 4)}…${providerId.slice(-4)}`;
}

export function logSmartCategoryCatalogAudit(payload: SmartCategoryCatalogAuditPayload) {
  if (!AUDIT_ENABLED) {
    return;
  }

  console.info('[NovaCast Catalog Audit]', {
    providerId: abbreviateProviderId(payload.providerId),
    mediaType: payload.mediaType,
    categoryKey: payload.categoryKey,
    candidateTotal: payload.candidateTotal,
    knownCatalogTotal: payload.catalogCompleteness.knownCatalogTotal,
    itemsIndexed: payload.catalogCompleteness.itemsIndexed,
    catalogComplete: payload.catalogCompleteness.catalogComplete,
  });

  if (!payload.catalogCompleteness.catalogComplete) {
    console.warn('[NovaCast Catalog Audit] Smart category built from incomplete catalog index');
  }
}
