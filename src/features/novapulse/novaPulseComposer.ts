import type { NovaPulseItem } from './novaPulseTypes';
import type { NovaPulseSource } from './novaPulseSources';

const SLOT_ORDER: NovaPulseItem['type'][] = ['movie', 'series', 'sports', 'sports', 'announcement'];

function dedupeKey(item: NovaPulseItem) {
  return item.dedupeKey ?? `${item.type}:${item.sourceItemId ?? item.title.trim().toLowerCase()}`;
}

function unique(items: readonly NovaPulseItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(dedupeKey(item))) return false;
    seen.add(dedupeKey(item));
    return true;
  });
}

export function composeNovaPulseFeed(sources: readonly NovaPulseSource[], maxItems = 5) {
  const all = unique(sources.flatMap((source) => {
    try {
      return source.getItems().items ?? [];
    } catch {
      return [];
    }
  }));
  const selected: NovaPulseItem[] = [];
  const used = new Set<string>();
  for (const slot of SLOT_ORDER) {
    const candidate = all.find((item) => item.type === slot && !used.has(dedupeKey(item)));
    if (candidate) {
      selected.push(candidate);
      used.add(dedupeKey(candidate));
    }
    if (selected.length >= maxItems) break;
  }
  if (selected.length < maxItems) {
    for (const item of all) {
      if (selected.length >= maxItems) break;
      if (used.has(dedupeKey(item))) continue;
      selected.push(item);
      used.add(dedupeKey(item));
    }
  }
  return selected.slice(0, maxItems);
}

export function preserveNovaPulseIndex(items: readonly NovaPulseItem[], previousId: string | null, previousIndex: number) {
  if (!items.length) return 0;
  const preserved = previousId ? items.findIndex((item) => item.id === previousId) : -1;
  return preserved >= 0 ? preserved : Math.min(Math.max(previousIndex, 0), items.length - 1);
}
