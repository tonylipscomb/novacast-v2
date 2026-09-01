export type GoldPackageLike = { id: string; name: string };
export type GoldAccountType = 'demo' | 'paid';

export const GOLD_DEMO_SUBSCRIPTION = '99';
export const GOLD_ALL_PACKAGES = 'all';

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

export function canSubmitGoldCreation(accountType: GoldAccountType, packages: unknown[], packageId: unknown) {
  return accountType === 'demo'
    ? packageId === GOLD_ALL_PACKAGES || (typeof packageId === 'string' && packageId.trim().length > 0)
    : canSubmitGoldAccount(packages, packageId);
}

export function resolveGoldCreationRequest(accountType: GoldAccountType, subscription: unknown, packageId: unknown) {
  return accountType === 'demo'
    ? { sub: GOLD_DEMO_SUBSCRIPTION, pack: packageId === GOLD_ALL_PACKAGES ? GOLD_ALL_PACKAGES : String(packageId ?? '').trim() }
    : { sub: String(subscription ?? '').trim(), pack: String(packageId ?? '').trim() };
}

export function paidGoldCreditWarning(accountType: GoldAccountType) {
  return accountType === 'paid' ? 'This will use Gold reseller credits. Continue?' : '';
}
