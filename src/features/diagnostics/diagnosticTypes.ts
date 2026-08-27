export type DiagnosticContentType = 'live' | 'movie' | 'series';
export type DiagnosticEventType =
  | 'play_attempt' | 'provider_request_started' | 'provider_request_succeeded' | 'provider_request_failed'
  | 'stream_resolution_started' | 'stream_resolution_succeeded' | 'stream_resolution_failed'
  | 'player_preparing' | 'player_ready' | 'playback_loading' | 'playback_started' | 'first_frame'
  | 'buffer_start' | 'buffer_end' | 'buffering_started' | 'buffering_ended' | 'playback_error' | 'playback_stopped'
  | 'playback_completed' | 'channel_change' | 'source_timeout' | 'decoder_error'
  | 'manifest_error' | 'provider_request' | 'network_request_failure'
  | 'app_launch' | 'app_resumed' | 'app_backgrounded' | 'route_changed'
  | 'catalog_sync_started' | 'catalog_sync_completed' | 'catalog_sync_failed'
  | 'provider_assignment_changed' | 'connectivity_changed' | 'retry_started'
  | 'playback_recovered';

export type DiagnosticEvent = {
  eventType: DiagnosticEventType;
  eventAt?: string;
  sessionId?: string;
  timestamp?: string;
  deviceId?: string;
  appVersion?: string;
  buildCode?: string;
  contentType?: DiagnosticContentType;
  contentId?: string;
  contentTitle?: string;
  categoryName?: string;
  providerName?: string;
  playbackState?: string;
  playbackDurationMs?: number;
  timeToFirstFrameMs?: number;
  bufferCount?: number;
  totalBufferDurationMs?: number;
  networkConnected?: boolean;
  networkType?: string;
  streamRequestStartedAt?: string;
  firstFrameAt?: string;
  errorMessage?: string;
  errorStage?: string;
  providerAssignmentId?: string;
  managedProviderId?: string;
  streamHost?: string;
  streamId?: string;
  errorCode?: string;
  nativeErrorCode?: string;
  httpStatus?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

export type DiagnosticBatch = {
  events: DiagnosticEvent[];
  device?: Record<string, unknown>;
};
