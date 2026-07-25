# NovaCast Sentry diagnostics policy

Diagnostics are disabled in development and use the existing `tracesSampleRate` of `0.1` in production/beta builds. The service reports only allow-listed primitives and uses the public NovaCast device code as the Sentry user ID.

## Severity

- `error`/`fatal`: uncaught exceptions, Error Boundary failures, terminal startup/provider/playback failures, storage reset, and activation failures that prevent use.
- `warning`: degraded provider mode, unavailable EPG/search after retries, recoverable migration issues, and playback recovered after repeated retries.
- Breadcrumb/context only: normal offline transitions, cancelled pairing, playback exit, empty results/categories, focus changes, and ordinary buffering.

Fingerprints are stable classifications such as `provider_sync:<classification>`, `playback:<classification>`, `startup:<stage>`, and `activation:<classification>`; raw IDs are never included.

The `beforeSend` sanitizer redacts credential-shaped keys, authorization/cookie/token values, email addresses, query strings, provider/stream URLs, DSNs, and circular or unbounded objects while preserving stack trace fields.
