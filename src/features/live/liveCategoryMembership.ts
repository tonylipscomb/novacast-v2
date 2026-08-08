/**
 * Single source of truth for Live TV category *membership*.
 *
 * Both the browseable channel list (`live.getChannels` / `guide.getRows`) and the
 * pre-selection category badge counts (`live.getCategoryCounts`) must decide which
 * streams belong to a category using the EXACT same rule, over the EXACT same data,
 * so a badge can never disagree with what the user actually scrolls through.
 *
 * These helpers are intentionally pure and dependency-free: the category-id
 * resolution (normalization + fallback + known-id gating) is injected as
 * `resolveCategoryId` so the caller decides the semantics once and shares it with
 * every path (browse filter + count tally).
 */

export interface LiveMembershipStream {
  category_id?: unknown;
}

export interface LiveMembershipResolved {
  readonly length: number;
}

/**
 * Filters a stream list down to the members of a single normalized category.
 * This is the browse-membership primitive reused by every category resolution path.
 */
export function filterStreamsForLiveCategory<T extends LiveMembershipStream>(
  streams: readonly T[],
  categoryId: string,
  resolveCategoryId: (value: unknown) => string,
): T[] {
  return streams.filter((stream) => resolveCategoryId(stream.category_id) === categoryId);
}

/**
 * Tallies category membership over a full stream list, producing a count per
 * category id. The tally is provably identical to running
 * {@link filterStreamsForLiveCategory}`.length` for each category because both
 * partition the streams by the same `resolveCategoryId` key.
 *
 * `resolvedOverrides` lets an already-resolved (browsed) category override the
 * derived tally with the exact membership the user was shown — including a
 * category resolved via a network request before the shared "all" list existed —
 * guaranteeing `badgeCount === resolvedBrowseableChannels.length`.
 */
export function computeLiveCategoryCounts<T extends LiveMembershipStream>(
  streams: readonly T[],
  categoryIds: Iterable<string>,
  resolveCategoryId: (value: unknown) => string,
  resolvedOverrides?: Iterable<readonly [string, LiveMembershipResolved]>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of categoryIds) {
    counts[id] = 0;
  }

  for (const stream of streams) {
    const id = resolveCategoryId(stream.category_id);
    counts[id] = (counts[id] ?? 0) + 1;
  }

  if (resolvedOverrides) {
    for (const [id, resolved] of resolvedOverrides) {
      counts[id] = resolved.length;
    }
  }

  return counts;
}
