import type { AppStateStatus } from 'react-native';

import { subscribeAppLifecycle } from '@/features/resilience/appLifecycle';
import { getOfflineSnapshot, subscribeOfflineStatus } from '@/features/resilience/offlineStatus';

import { enqueueAnalyticsEvent, flushNovaAnalytics } from './novaAnalytics';

let attached = false;
let detachLifecycle: (() => void) | null = null;
let detachNetwork: (() => void) | null = null;
let lastStatus: AppStateStatus | null = null;

function onLifecycle(status: AppStateStatus) {
  if (status === lastStatus) return;
  const previous = lastStatus;
  lastStatus = status;
  if (status === 'active' && previous && previous !== 'active') {
    void enqueueAnalyticsEvent('session_resumed', { metadata: { background_duration_bucket: 'unknown' } }).then(() => flushNovaAnalytics());
  } else if (status !== 'active' && previous === 'active') {
    void enqueueAnalyticsEvent('session_backgrounded').then(() => flushNovaAnalytics());
  }
}

function onNetworkChange() {
  if (getOfflineSnapshot().status === 'online') void flushNovaAnalytics();
}

export function initializeAnalyticsLifecycle() {
  if (attached) return;
  attached = true;
  detachLifecycle = subscribeAppLifecycle(onLifecycle);
  detachNetwork = subscribeOfflineStatus(onNetworkChange);
}

export function resetAnalyticsLifecycleForTests() {
  detachLifecycle?.();
  detachNetwork?.();
  detachLifecycle = null;
  detachNetwork = null;
  attached = false;
  lastStatus = null;
}
