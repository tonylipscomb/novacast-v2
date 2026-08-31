import { readXtreamFailureDetails } from './xtreamTransientRetry.ts';

export type ProviderBoundaryErrorCategory =
  | 'authorization'
  | 'provider'
  | 'timeout'
  | 'network'
  | 'malformed-response'
  | 'cancelled'
  | 'unknown';

function diagnosticsEnabled() {
  return (
    (typeof __DEV__ !== 'undefined' && __DEV__) ||
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_NOVACAST_DEBUG === 'true')
  );
}

export function classifyProviderBoundaryError(error: unknown): {
  httpStatus: number | null;
  errorCategory: ProviderBoundaryErrorCategory;
  errorName: string;
} {
  const details = readXtreamFailureDetails(
    error instanceof Error ? error : { name: 'ProviderBoundaryError', message: String(error) },
  );
  let errorCategory: ProviderBoundaryErrorCategory = 'unknown';

  switch (details.classification) {
    case 'http_auth':
      errorCategory = 'authorization';
      break;
    case 'http_retryable':
    case 'http_other':
      errorCategory = 'provider';
      break;
    case 'timeout_or_abort':
      errorCategory = 'timeout';
      break;
    case 'network_failure':
      errorCategory = 'network';
      break;
    case 'empty_body':
    case 'html_or_non_json':
    case 'truncated_json':
    case 'malformed_json':
    case 'response_too_large':
      errorCategory = 'malformed-response';
      break;
    default:
      if (error instanceof Error && error.name === 'AbortError') {
        errorCategory = 'cancelled';
      }
  }

  return {
    httpStatus: details.httpStatus,
    errorCategory,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  };
}

export function logProviderBoundary(
  label: string,
  payload: Record<string, unknown>,
) {
  if (!diagnosticsEnabled()) {
    return;
  }

  console.info(label, JSON.stringify(payload));
}

export function safeProviderRuntimeFlags(input: {
  managedProviderId?: unknown;
  providerRecord?: unknown;
  credentials?: unknown;
  providerBase?: unknown;
  assignmentSource?: string;
}) {
  return {
    managedProviderIdPresent: Boolean(input.managedProviderId),
    providerRecordPresent: Boolean(input.providerRecord),
    providerCredentialBundlePresent: Boolean(input.credentials),
    providerBasePresent: Boolean(input.providerBase),
    assignmentSource: input.assignmentSource ?? 'provider-bundle',
  };
}
