export type AnalyticsPrimitive = string | number | boolean | null;

export type AnalyticsMetadata = Record<string, AnalyticsPrimitive>;

export type AnalyticsEventName =
  | 'screen_view'
  | 'playback_requested'
  | 'playback_started'
  | 'playback_failed'
  | 'playback_recovered'
  | 'playback_stopped'
  | 'session_started'
  | 'session_backgrounded'
  | 'session_resumed'
  | 'session_ended';

export type AnalyticsEvent = {
  idempotencyKey: string;
  eventName: AnalyticsEventName;
  occurredAt?: string;
  route?: string;
  providerId?: string;
  contentId?: string;
  contentType?: string;
  outcome?: string;
  durationMs?: number;
  countValue?: number;
  metadata?: AnalyticsMetadata;
};

export type AnalyticsSession = {
  sessionUuid: string;
  startedAt: string;
  lastSeenAt: string;
  endedAt?: string;
  durationMs?: number;
  appVersion: string;
  appBuild?: string;
  manufacturer?: string;
  model?: string;
  platformApiLevel?: number;
  environment: 'beta' | 'production' | 'development';
  exitReason?: string;
};

export type AnalyticsDeviceState = {
  sessionUuid: string;
  lastSeenAt: string;
  currentRoute?: string;
  currentActivity?: string;
  providerState?: string;
  playbackState?: string;
  networkConnected?: boolean;
  appVersion: string;
  appBuild?: string;
};

export type AnalyticsBatch = {
  session: AnalyticsSession;
  events: AnalyticsEvent[];
  state?: AnalyticsDeviceState;
};

export type AnalyticsIngestResponse = {
  ok: boolean;
  accepted?: number;
  duplicates?: number;
  rejected?: number;
  retryable?: boolean;
  errorCategory?: string;
};
