/** Pure URI helpers for TV remote images (no React Native imports). */

export function normalizeTvRemoteImageUri(uri?: string | null): string | null {
  const trimmed = uri?.trim();
  return trimmed ? trimmed : null;
}
