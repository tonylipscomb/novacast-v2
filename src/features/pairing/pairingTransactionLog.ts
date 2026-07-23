type PairingTransactionDetails = Record<string, string | number | boolean | null | undefined>;

const LOG_PREFIX = '[pairing-tx]';

export function formatPairingTransactionError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

function sanitizeDetails(details: PairingTransactionDetails = {}) {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}

/** Always logs — intended for release logcat during pairing completion diagnosis. */
export function pairingTransactionStart(step: string, details: PairingTransactionDetails = {}) {
  const sanitized = sanitizeDetails(details);
  console.log(`${LOG_PREFIX} START ${step}`, sanitized);
}

/** Always logs — intended for release logcat during pairing completion diagnosis. */
export function pairingTransactionSuccess(step: string, details: PairingTransactionDetails = {}) {
  const sanitized = sanitizeDetails(details);
  console.log(`${LOG_PREFIX} SUCCESS ${step}`, sanitized);
}

/** Always logs — intended for release logcat during pairing completion diagnosis. */
export function pairingTransactionFailure(step: string, error: unknown, details: PairingTransactionDetails = {}) {
  const formatted = formatPairingTransactionError(error);
  console.error(`${LOG_PREFIX} FAILURE ${step}`, {
    ...sanitizeDetails(details),
    message: formatted.message,
    stack: formatted.stack,
  });
}

export function runPairingTransactionStepSync<T>(
  step: string,
  fn: () => T,
  details: PairingTransactionDetails = {},
): T {
  pairingTransactionStart(step, details);
  try {
    const result = fn();
    pairingTransactionSuccess(step, details);
    return result;
  } catch (error) {
    pairingTransactionFailure(step, error, details);
    throw error;
  }
}

export async function runPairingTransactionStep<T>(
  step: string,
  fn: () => Promise<T>,
  details: PairingTransactionDetails = {},
): Promise<T> {
  pairingTransactionStart(step, details);
  try {
    const result = await fn();
    pairingTransactionSuccess(step, details);
    return result;
  } catch (error) {
    pairingTransactionFailure(step, error, details);
    throw error;
  }
}
