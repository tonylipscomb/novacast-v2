export type GoldPackageLike = { id: string; name: string };
export type GoldAccountType = 'import' | 'paid';

export function resolveGoldPackageState(result: Record<string, unknown>) {
  const packages = Array.isArray(result.packages) ? result.packages as GoldPackageLike[] : [];
  return { packages, emptyReason: typeof result.emptyReason === 'string' ? result.emptyReason : '' };
}

export function canSubmitGoldImport(m3uUrl: unknown) { return typeof m3uUrl === 'string' && m3uUrl.trim().length > 0; }

export function canSubmitPaidGoldCreation(packages: unknown[], packageId: unknown, subscription: unknown) {
  return packages.length > 0 && typeof packageId === 'string' && packageId.trim().length > 0 && packageId.trim().toLowerCase() !== 'all' && typeof subscription === 'string' && ['1', '3', '6', '12'].includes(subscription.trim());
}

export function resolveGoldImportRequest(input: { m3uUrl: unknown; displayName: unknown; notes: unknown; runDiagnostics: boolean; activateIfHealthy: boolean }) {
  return { action: 'import_account', m3uUrl: String(input.m3uUrl ?? '').trim(), displayName: String(input.displayName ?? '').trim(), notes: String(input.notes ?? ''), runDiagnostics: input.runDiagnostics === true, activateIfHealthy: input.activateIfHealthy === true };
}

export function resolvePaidGoldCreationRequest(input: { subscription?: unknown; sub?: unknown; packageId: unknown; country: unknown; displayName: unknown; notes: unknown; runDiagnostics: boolean; activateIfHealthy: boolean }) {
  return { action: 'create_account', accountType: 'paid', sub: String(input.subscription ?? input.sub ?? '').trim(), packageId: String(input.packageId ?? '').trim(), country: String(input.country ?? 'US').trim().toUpperCase(), displayName: String(input.displayName ?? '').trim(), notes: String(input.notes ?? ''), runDiagnostics: input.runDiagnostics === true, activateIfHealthy: input.activateIfHealthy === true };
}

export function paidGoldCreditWarning(accountType: GoldAccountType) { return accountType === 'paid' ? 'This will use Gold reseller credits. Continue?' : ''; }
