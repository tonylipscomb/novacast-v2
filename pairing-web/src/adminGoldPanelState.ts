export type GoldPackageLike = { id: string; name: string };

export function resolveGoldPackageState(result: Record<string, unknown>) {
  const packages = Array.isArray(result.packages) ? result.packages as GoldPackageLike[] : [];
  return {
    packages,
    emptyReason: typeof result.emptyReason === 'string' ? result.emptyReason : '',
  };
}

export function canSubmitGoldAccount(packages: unknown[], packageId: unknown) {
  return packages.length > 0 && typeof packageId === 'string' && packageId.trim().length > 0;
}
