// Pure gate for the Live startup effect. Keyed on provider + published
// generation so a persisted initial-category change cannot restart the full
// startup pipeline for the same provider/generation.

export function computeLiveStartupKey(
  providerId: string | null | undefined,
  generation: number | null | undefined,
): string {
  return `${providerId ?? ''}:${generation ?? 0}`;
}

export function shouldRestartLiveStartup(previousKey: string | null, nextKey: string): boolean {
  return previousKey !== nextKey;
}
