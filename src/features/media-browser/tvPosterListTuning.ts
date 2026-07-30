/**
 * Shared TV list tuning for Movies / Series poster grids.
 * Measured for ONN / Fire Stick class devices — keep removeClippedSubviews off
 * (clipping caused poster recycle focus/art glitches on Android TV).
 */
export const TV_POSTER_LIST_TUNING = {
  windowSize: 5,
    initialRows: 3,
  lookAheadRows: 2,
maxToRenderPerBatch: 8,
  updateCellsBatchingPeriod: 32,
  onEndReachedThreshold: 0.65,
  removeClippedSubviews: false as const,
};

/** Approximate row height for getItemLayout (poster 2:3 + title/meta + gaps). */
export function estimatePosterRowHeight(columnWidth: number) {
  const posterHeight = columnWidth * (3 / 2);
  return Math.round(posterHeight + 52);
}
