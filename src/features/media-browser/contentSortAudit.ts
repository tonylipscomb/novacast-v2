import type { ContentSortOption } from './contentSorting.ts';

export type ContentSortAuditPayload = {
  providerId: string;
  section: 'movie' | 'series';
  categoryId: string;
  sort: ContentSortOption;
  knownCategoryTotal: number;
  itemsConsideredForSort: number;
  offset: number;
  pageSize: number;
  requestGeneration: number;
  sortComplete: boolean;
  sample: { id: string; title: string; orderField: unknown }[];
};

const AUDIT_ENABLED =
  typeof __DEV__ !== 'undefined' &&
  __DEV__ &&
  (typeof process !== 'undefined' ? process.env?.NOVACAST_SORT_AUDIT !== '0' : true);

function abbreviateProviderId(providerId: string) {
  if (!providerId) {
    return 'unknown';
  }
  if (providerId.length <= 8) {
    return providerId;
  }
  return `${providerId.slice(0, 4)}…${providerId.slice(-4)}`;
}

export function logContentSortAuditPayload(payload: ContentSortAuditPayload) {
  if (!AUDIT_ENABLED) {
    return;
  }

  const truncated = payload.knownCategoryTotal > payload.itemsConsideredForSort;
  console.info('[NovaCast Sort Audit]', {
    providerId: abbreviateProviderId(payload.providerId),
    section: payload.section,
    categoryId: payload.categoryId,
    sort: payload.sort,
    knownCategoryTotal: payload.knownCategoryTotal,
    itemsConsideredForSort: payload.itemsConsideredForSort,
    sortComplete: payload.sortComplete,
    truncated,
    offset: payload.offset,
    pageSize: payload.pageSize,
    requestGeneration: payload.requestGeneration,
    sample: payload.sample,
  });

  if (truncated) {
    console.warn('[NovaCast Sort Audit] Incomplete global sort: knownCategoryTotal exceeds itemsConsideredForSort');
  }
}

export function buildSortComplete(knownCategoryTotal: number, itemsConsideredForSort: number) {
  return knownCategoryTotal === itemsConsideredForSort;
}
