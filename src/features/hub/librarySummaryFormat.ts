export type LibraryCountUnit = 'titles' | 'channels';

export function formatLibraryTotal(count: number, unit: LibraryCountUnit) {
  if (count <= 0) {
    return null;
  }

  const label = unit === 'titles' ? 'Titles' : 'Channels';
  return `${count.toLocaleString()} ${label}`;
}

export function formatHubTileStat(count: number, unit: LibraryCountUnit) {
  return formatLibraryTotal(count, unit);
}

export function formatCategoryCountLabel(name: string, count: number) {
  if (count <= 0) {
    return name;
  }

  return `${name} (${count.toLocaleString()})`;
}

export function shouldShowCachedTotals(lastProviderSyncAt: number) {
  return lastProviderSyncAt > 0;
}
