export function formatLiveTvCategoryCount(count: number | null | undefined): string {
  return count == null ? '\u2014' : count.toLocaleString();
}
