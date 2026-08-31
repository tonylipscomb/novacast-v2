import { getActiveRepositoryBundle } from '@/features/providers/providerBundle';

let devCatalogRefreshTriggered = false;
let devCatalogRefreshGateLogged = false;

const LOG = '[NovaCast Dev Catalog Refresh]';

/**
 * TEMPORARY one-shot for Series retry runtime testing.
 * Gated by EXPO_PUBLIC_NOVACAST_DEBUG. Does not invalidate Movie generations,
 * checkpoints, credentials, or activation.
 */
export function maybeTriggerDevCatalogRefreshOnce() {
  const debugEnabled = process.env.EXPO_PUBLIC_NOVACAST_DEBUG === 'true';
  if (!devCatalogRefreshGateLogged) {
    devCatalogRefreshGateLogged = true;
    console.info(LOG, {
      event: 'gate-check',
      debugEnabled,
    });
  }
  if (!debugEnabled) {
    return;
  }
  if (devCatalogRefreshTriggered) {
    return;
  }

  const bundle = getActiveRepositoryBundle();
  if (!bundle) {
    return;
  }

  devCatalogRefreshTriggered = true;
  console.info(LOG, {
    event: 'triggered',
    providerId: bundle.providerId,
    requestSource: 'device-heartbeat-refresh-library',
  });

  void bundle
    .syncCatalog('device-heartbeat-refresh-library')
    .then(() => {
      console.info(LOG, {
        event: 'completed',
        providerId: bundle.providerId,
      });
    })
    .catch((error) => {
      console.warn(LOG, {
        event: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
