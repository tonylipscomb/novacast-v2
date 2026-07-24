/**
 * Shared provider failure classifier.
 * Maps raw errors to actionable user copy without leaking credentials or URLs.
 */

export type ProviderFailureKind =
  | 'invalid_credentials'
  | 'expired_account'
  | 'account_disabled'
  | 'unreachable'
  | 'dns'
  | 'timeout'
  | 'tls'
  | 'malformed_url'
  | 'blocked'
  | 'rate_limited'
  | 'malformed_payload'
  | 'empty_account'
  | 'partial_catalog'
  | 'unauthorized_stream'
  | 'temporary_server'
  | 'offline'
  | 'missing_credentials'
  | 'unknown';

export type ClassifiedProviderFailure = {
  kind: ProviderFailureKind;
  title: string;
  message: string;
  /** Stable code for diagnostics / Beta Support — never a secret. */
  code: string;
  retryable: boolean;
  autoRetrySafe: boolean;
};

function readMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '';
}

export function classifyProviderFailure(error: unknown, context?: { providerLabel?: string }): ClassifiedProviderFailure {
  const raw = readMessage(error);
  const lower = raw.toLowerCase();
  const label = context?.providerLabel?.trim() || 'this provider';

  if (/secure credentials|missing connection details|incomplete/i.test(raw)) {
    return {
      kind: 'missing_credentials',
      title: 'Provider connection incomplete',
      message: 'This provider is missing secure connection details. Open Provider Manager and reconnect it.',
      code: 'provider_missing_credentials',
      retryable: false,
      autoRetrySafe: false,
    };
  }

  if (/abort|timed?\s*out|timeout|etimedout|network request failed/i.test(lower)) {
    if (/offline|network request failed|failed to fetch|enetunreach|enotfound/i.test(lower)) {
      return {
        kind: 'offline',
        title: 'Device offline',
        message: 'This device is offline. NovaCast will reconnect when internet access returns.',
        code: 'device_offline',
        retryable: true,
        autoRetrySafe: true,
      };
    }
    return {
      kind: 'timeout',
      title: 'Provider took too long',
      message: 'The provider took too long to respond. Try again in a moment.',
      code: 'provider_timeout',
      retryable: true,
      autoRetrySafe: true,
    };
  }

  if (/enotfound|getaddrinfo|dns/i.test(lower)) {
    return {
      kind: 'dns',
      title: 'Provider host not found',
      message: `NovaCast could not find the server for ${label}. Check the provider address and try again.`,
      code: 'provider_dns',
      retryable: true,
      autoRetrySafe: false,
    };
  }

  if (/certificate|ssl|tls|cert/i.test(lower)) {
    return {
      kind: 'tls',
      title: 'Secure connection failed',
      message: 'NovaCast could not establish a secure connection to the provider. Try again later.',
      code: 'provider_tls',
      retryable: true,
      autoRetrySafe: false,
    };
  }

  if (/401|403|unauthorized|forbidden|invalid.*(user|pass|login|credential)|auth.?fail/i.test(lower)) {
    return {
      kind: 'invalid_credentials',
      title: 'Could not sign in',
      message: 'NovaCast could not sign in to this provider. Check the username and password.',
      code: 'provider_invalid_credentials',
      retryable: false,
      autoRetrySafe: false,
    };
  }

  if (/expired|expir/i.test(lower)) {
    return {
      kind: 'expired_account',
      title: 'Provider account expired',
      message: 'This provider account appears to be expired. Contact your provider to renew it.',
      code: 'provider_expired',
      retryable: false,
      autoRetrySafe: false,
    };
  }

  if (/disabled|banned|suspended|blocked/i.test(lower)) {
    return {
      kind: 'account_disabled',
      title: 'Provider account unavailable',
      message: 'This provider account is unavailable. Contact your provider for help.',
      code: 'provider_disabled',
      retryable: false,
      autoRetrySafe: false,
    };
  }

  if (/429|rate.?limit|too many requests/i.test(lower)) {
    return {
      kind: 'rate_limited',
      title: 'Provider is busy',
      message: 'The provider asked NovaCast to slow down. Wait a moment, then try again.',
      code: 'provider_rate_limited',
      retryable: true,
      autoRetrySafe: true,
    };
  }

  if (/5\d\d|bad gateway|service unavailable|internal server/i.test(lower)) {
    return {
      kind: 'temporary_server',
      title: 'Provider temporarily unavailable',
      message: 'The provider had a temporary problem. Try again in a moment.',
      code: 'provider_temporary',
      retryable: true,
      autoRetrySafe: true,
    };
  }

  if (/malformed|invalid url|unsupported protocol/i.test(lower)) {
    return {
      kind: 'malformed_url',
      title: 'Provider address looks wrong',
      message: 'The provider server address looks invalid. Open Provider Manager and check it.',
      code: 'provider_malformed_url',
      retryable: false,
      autoRetrySafe: false,
    };
  }

  if (/json|unexpected token|malformed.*payload|parse/i.test(lower)) {
    return {
      kind: 'malformed_payload',
      title: 'Unexpected provider response',
      message: 'The provider returned data NovaCast could not understand. Try again later.',
      code: 'provider_malformed_payload',
      retryable: true,
      autoRetrySafe: false,
    };
  }

  if (/unreachable|econnrefused|econnreset|ehostunreach/i.test(lower)) {
    return {
      kind: 'unreachable',
      title: 'Provider unreachable',
      message: `NovaCast could not reach ${label}. Check your internet connection and try again.`,
      code: 'provider_unreachable',
      retryable: true,
      autoRetrySafe: true,
    };
  }

  return {
    kind: 'unknown',
    title: 'Unable to connect',
    message: `NovaCast could not connect to ${label}. Try again, or open Provider Manager if the problem continues.`,
    code: 'provider_unknown',
    retryable: true,
    autoRetrySafe: true,
  };
}

export function isPermanentProviderFailure(kind: ProviderFailureKind): boolean {
  return (
    kind === 'invalid_credentials' ||
    kind === 'expired_account' ||
    kind === 'account_disabled' ||
    kind === 'missing_credentials' ||
    kind === 'malformed_url'
  );
}
