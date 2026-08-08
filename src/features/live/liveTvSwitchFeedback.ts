/**
 * Stage 4.2S.1 — pure decision helpers for Live TV category/provider switching.
 *
 * These are intentionally free of React and native dependencies so they can be unit
 * tested directly. They encode three surgical fixes discovered by instrumentation:
 *   1. non-blocking loader visibility (no flash for fast switches),
 *   2. deterministic focus restoration after channels change,
 *   3. a left-boundary focus fallback so LEFT never drops into spatial navigation.
 */

/** Only show the content-pane loader once a switch is genuinely slow. */
export const LIVE_TV_SWITCH_LOADER_THRESHOLD_MS = 200;

export type SwitchLoaderInput = {
  /** True while channels for the current category/provider are still being loaded. */
  isLoadingChannels: boolean;
  /** Milliseconds elapsed since the switch started. */
  elapsedMs: number;
  /** Override threshold (defaults to LIVE_TV_SWITCH_LOADER_THRESHOLD_MS). */
  thresholdMs?: number;
};

/**
 * The loader appears only when a switch is still loading AND has already exceeded the
 * threshold, so fast switches never flash a spinner. It disappears the instant loading
 * ends because `isLoadingChannels` goes false.
 */
export function shouldShowSwitchLoader({
  isLoadingChannels,
  elapsedMs,
  thresholdMs = LIVE_TV_SWITCH_LOADER_THRESHOLD_MS,
}: SwitchLoaderInput): boolean {
  if (!isLoadingChannels) {
    return false;
  }
  return elapsedMs >= thresholdMs;
}

export type SwitchFocusTarget =
  | { kind: 'channel'; channelId: string }
  | { kind: 'category-rail' };

export type MinimalChannel = { id: string };

/**
 * Decide where focus should land after a category/provider switch commits new channels.
 * - Restore the previously focused channel if it still exists in the new list.
 * - Otherwise focus the first valid channel.
 * - Otherwise keep focus safely on the category rail (empty category / provider with no
 *   channels), never on an unmounted item.
 *
 * Because a provider switch produces an entirely new channel id space, a stale previous
 * id simply will not be found and the caller safely falls through to the first channel —
 * no old-provider handle can survive.
 */
export function resolveSwitchFocusTarget(
  previousChannelId: string | null | undefined,
  nextChannels: readonly MinimalChannel[],
): SwitchFocusTarget {
  if (!nextChannels.length) {
    return { kind: 'category-rail' };
  }

  if (previousChannelId && nextChannels.some((channel) => channel.id === previousChannelId)) {
    return { kind: 'channel', channelId: previousChannelId };
  }

  return { kind: 'channel', channelId: nextChannels[0].id };
}

export type LeftBoundaryInput = {
  selectedCategoryId: string | null;
  selectedCategoryHandle: number | null | undefined;
  favoritesId: string | null;
  favoritesHandle: number | null | undefined;
  firstCategoryId: string | null;
  firstCategoryHandle: number | null | undefined;
};

export type LeftBoundaryTarget = {
  handle: number | undefined;
  targetId: string | null;
  fallbackUsed: boolean;
};

/**
 * Resolve the LEFT (nextFocusLeft) target for the channel/action area.
 *
 * The bug: mid-switch the selected category row can be transiently unmounted, so its
 * native handle is null and Android falls back to spatial navigation — which skips the
 * intended Favorites/category target. This resolver returns a concrete handle whenever
 * *any* category ref is available (selected → favorites → first), so LEFT stays
 * deterministic. Only when nothing is mounted does it return undefined.
 */
export function resolveLeftBoundaryTarget(input: LeftBoundaryInput): LeftBoundaryTarget {
  if (input.selectedCategoryHandle != null) {
    return { handle: input.selectedCategoryHandle, targetId: input.selectedCategoryId, fallbackUsed: false };
  }

  if (input.favoritesHandle != null) {
    return { handle: input.favoritesHandle, targetId: input.favoritesId, fallbackUsed: true };
  }

  if (input.firstCategoryHandle != null) {
    return { handle: input.firstCategoryHandle, targetId: input.firstCategoryId, fallbackUsed: true };
  }

  return { handle: undefined, targetId: null, fallbackUsed: false };
}
