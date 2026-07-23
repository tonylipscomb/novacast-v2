export const STARTUP_BUNDLE_INIT_ATTEMPTS = 6;

export function startupBundleInitDelayMs(attemptIndex: number) {
  if (attemptIndex <= 0) {
    return 0;
  }

  return 2000 * attemptIndex;
}

/**
 * Cold app launch often races emulator networking/Metro readiness. A single
 * failed Xtream account probe should not trap the user on the init error
 * screen when the provider is otherwise valid.
 */
export async function withStartupInitRetries<T>(
  run: () => Promise<T>,
  attempts = STARTUP_BUNDLE_INIT_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const delayMs = startupBundleInitDelayMs(attempt);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      return await run();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
