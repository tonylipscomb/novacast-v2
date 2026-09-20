export function isNovaPulseSportsRefreshAuthorized(input: {
  suppliedSecret?: string | null;
  configuredSecret?: string | null;
  bearerToken?: string | null;
  serviceRoleKey?: string | null;
}) {
  const suppliedSecret = input.suppliedSecret?.trim() ?? '';
  const configuredSecret = input.configuredSecret?.trim() ?? '';
  const bearerToken = input.bearerToken?.trim() ?? '';
  const serviceRoleKey = input.serviceRoleKey?.trim() ?? '';
  return Boolean(
    (configuredSecret && suppliedSecret && suppliedSecret === configuredSecret) ||
    (serviceRoleKey && bearerToken && bearerToken === serviceRoleKey),
  );
}
