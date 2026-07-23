import { getActiveRepositoryBundle } from '@/features/providers/providerBundle';

const DEFAULT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 400;

/**
 * After pairing activates a provider, wait until live categories (and a first
 * channel page) are readable so Home is not empty on first paint.
 * Times out soft so navigation still proceeds if the catalog is slow.
 */
export async function waitForHomeChannelsReady(options?: { timeoutMs?: number; signal?: { cancelled: boolean } }) {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (options?.signal?.cancelled) {
      return false;
    }

    const bundle = getActiveRepositoryBundle();
    if (bundle) {
      try {
        const categories = await bundle.live.getCategories();
        if (categories.length > 0) {
          await bundle.live.getChannels(categories[0].id).catch(() => []);
          return true;
        }
      } catch {
        // Keep polling while the provider bundle finishes warming up.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return Boolean(getActiveRepositoryBundle());
}
