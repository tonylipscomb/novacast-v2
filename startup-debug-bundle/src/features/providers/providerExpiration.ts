import type { ProviderAccountMetadata, ProviderRecord } from './providerModel.ts';

export function formatProviderExpirationLabel(
  provider: ProviderRecord | null | undefined,
  accountMetadata: ProviderAccountMetadata | null | undefined,
): string {
  const expiresAt = accountMetadata?.expiresAt ?? provider?.expirationAt ?? null;
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > 0) {
    const date = new Date(expiresAt);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
  }

  return 'Expiration unavailable';
}
