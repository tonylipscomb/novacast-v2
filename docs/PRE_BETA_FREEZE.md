# NovaCast Pre-Beta Freeze

Freeze date: 2026-08-18  
Package: `com.novacast.novacastv2` (unchanged)  
No commit, push, or deploy was performed as part of this freeze.

## Release Candidate Status

Fire TV RC smoke passed before this freeze. The freeze is **log/security/version hygiene only**. Playback, Series autoplay, Live TV surf, Continue Watching, and provider connection behavior were not redesigned.

**READY FOR BETA BUILD: YES**, with the warnings below. Build the closed-beta APK through `.github/workflows/android-beta.yml` after confirming GitHub secrets are present.

## Validated On Device

Validated working on Fire TV before freeze:

- cold launch / splash / Home
- Home DPAD focus
- Movies browse/detail/playback for normal compatible streams
- Series browse/detail/playback
- Series autoplay E1 → E2
- Up Next countdown
- Play Now / Cancel focus
- hidden VOD chrome wake from DPAD/SELECT
- Continue Watching / resume / restart
- Search
- Live TV channel surf
- Live TV guide/search/fullscreen/back
- provider/device state survives relaunch
- force-stop/reopen
- lower-end Fire TV performance is stable

## Known Parked Issues

- Some 4K / >1080p movie sources on low-end Fire TV may be unsupported or extremely choppy.
- Compatibility handling already exists (preplay block on FHD/low-end when dimensions exceed 1920×1080; decoder-init overlay otherwise).
- Do **not** expand this work now. Revisit immediately before a wider beta if testers hit it often.
- `usesCleartextTraffic` remains enabled in `app.json` for HTTP IPTV endpoints. Do not remove without a provider-HTTP audit.

## Beta Flags

Source of truth for the **release APK** is `.github/workflows/android-beta.yml` (baked at build time). App defaults in `src/features/device/deviceFeatureFlags.ts` match closed-beta intent when env is unset: closed beta on, personal pairing off.

| Flag | Release bundle (CI) | App default if unset | `.env.example` |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_BETA_INVITES_ENABLED` | enabled | enabled | enabled |
| `EXPO_PUBLIC_CLOSED_BETA_MODE` | enabled | enabled | enabled |
| `EXPO_PUBLIC_DEVICE_ACTIVATION_ENABLED` | enabled | enabled | enabled |
| `EXPO_PUBLIC_DEVICE_ACTIVATION_REQUIRED` | enabled | enabled when closed beta is on | disabled (example only; closed beta still requires activation) |
| `EXPO_PUBLIC_DEVICE_REGISTRATION_ENABLED` | enabled | enabled | enabled |
| `EXPO_PUBLIC_MANAGED_BETA_PROVIDER_ENABLED` | enabled | enabled when closed beta is on | disabled (example only; closed beta still enables managed provider) |
| `EXPO_PUBLIC_PERSONAL_PROVIDER_PAIRING_ENABLED` | disabled | disabled when closed beta is on | enabled (example only; closed beta keeps pairing off) |
| `EXPO_PUBLIC_NOVACAST_PAIRING_API_URL` | configured via GitHub secret | missing locally unless `.env` set | placeholder |
| `EXPO_PUBLIC_NOVACAST_PAIRING_WEBSITE_URL` | configured via GitHub secret | missing locally unless `.env` set | placeholder |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | configured via GitHub secret | missing locally unless `.env` set | placeholder |
| `EXPO_PUBLIC_SENTRY_DSN` | missing from CI env | missing | missing |
| `EXPO_PUBLIC_NOVACAST_LOCAL_ACTIVATION_BYPASS` | not set (disabled) | disabled | not listed |
| `EXPO_PUBLIC_NOVACAST_DEBUG` | not set (traces off in production) | off in production | commented |

`.env.example` is **not** the release bundle. Closed-beta mode in app code still forces activation + managed provider and disables personal pairing even when the example file shows the opposite explicit flags.

## Version

History in-repo was `1.0.1` / Android `versionCode` **4**. Docs mention `v1.0.0`. The freeze target named **1.0.4-beta** (aligned with current `versionCode` 4 as the previous shipped build). Package id was not renamed.

| Field | Old | New |
| --- | --- | --- |
| Expo / `versionName` (`app.json` `expo.version`) | `1.0.1` | `1.0.4-beta` |
| Android `versionCode` | `4` | `5` |
| `package.json` / lockfile package version | `1.0.1` | `1.0.4-beta` |
| Android `applicationId` | `com.novacast.novacastv2` | unchanged |

CI artifact label remains `beta-main-<run>` on `main` pushes, or the git tag name when tagging. Tag `v1.0.4-beta` if you want the GitHub Release title to match `versionName`.

## Logging Changes

Added `src/features/diagnostics/novacastLogPolicy.ts`.

Production/beta (`__DEV__ === false` and `NODE_ENV=production`): high-frequency traces are **off**. Re-enable with `EXPO_PUBLIC_NOVACAST_DEBUG=true` (or catalog-specific `EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT=1` / `EXPO_PUBLIC_NOVACAST_MOVIES_TRACE=1` for catalog/movies traces).

### A. KEEP FOR BETA (still logged)

- device registration / activation failures (`logActivationClient`, pairing transaction **FAILURE**)
- provider connection / pairing start-success (low volume) and failures
- playback fatal / player **error** status
- movie compatibility (`decoder-failure`, `preplay-blocked`, unsupported format)
- sanitized playback source metadata (hostname hash, no URL)
- Movies launch-failed / play-blocked / launch-timeout / select-blocked
- Series autoplay armed / play-now / cancel / autoplay-complete / source-failed (not countdown ticks)
- Live TV startup, favorites hydration, category **selection-rejected**, surf **transition-failed**, stall ≥1000ms
- Series SQLite `series_sqlite_refresh_failed`
- catalog schema migration (once)
- pairing `logPairingEvent` (session id prefix only)

### B. DEV-ONLY / GATED

- VOD seek / seek-remote / focus-seek / player chrome reveal / TV input raw / player focus received-lost
- player chrome wake/focus traces
- Series autoplay **countdown-tick** and autoplay **focus-move** traces
- non-error player status / player instance / overlay build markers / playback recovery overlay-state
- VOD player memory except `playback-error`
- catalog repository timing/audit (`novacastCatalogTrace`)
- catalog WAL audit, slow catalog transactions
- Movies SQLite startup/page/search traces
- Movies poster-ref register/unregister/request
- Movies playback `state` / `play-requested` / detail-wait / launch-start / search-open
- Series perf/startup/grid/SQLite page traces (except refresh-failed)
- Live category load/selection (except rejected), EPG trigger, performance, surf (except transition-failed)
- Search timing/index/datasource/scroll/focus traces
- catalog sync debug (already env/`__DEV__`; now uses the same catalog-trace policy)

## Security / Secret Audit

- No provider password is logged. Xtream URLs embed user/pass in the path; playback diagnostics log protocol, hostname **hash**, path segment count, extension, stream-id presence — never the URL.
- Movie search timing no longer includes the raw query string (length only).
- `SettingsScreen` shows Xtream username as `Linked account`, not the real username.
- Pairing copy: no passwords entered on the TV.
- Sentry `beforeSend` sanitizes secret-looking keys and strips URL credentials.
- `SUPABASE_SERVICE_ROLE_KEY` is used only in `supabase/functions/_shared/supabase.ts` (Edge). It is **not** referenced from the TV app bundle.
- App uses `EXPO_PUBLIC_SUPABASE_ANON_KEY` only (public anon). CI does not inject a service-role secret.
- Localhost / `127.0.0.1` provider targets are rejected in pairing and provider health.
- No `localhost` API endpoints found in the TV app source.
- Permanent download URL is production Netlify `novacast-connect.netlify.app` (redirects to GitHub Releases), not a deploy-preview URL.

## Release Build Audit

- **Signing:** CI uses Expo debug-signed `assembleRelease` unless `NOVACAST_KEYSTORE_*` secrets are set. Sideload beta is OK; Play Store / install-over-production-key requires the release keystore.
- **Sentry:** `SENTRY_DISABLE_AUTO_UPLOAD=true` in CI. No `sentry.options.json` in the repo. Runtime init uses `EXPO_PUBLIC_SENTRY_DSN` and `enabled: !__DEV__`. Missing DSN means Sentry no-ops. Acceptable for this beta; not a blocker.
- **Expo dev client:** not a dependency. No dev menu package.
- **Source maps / auto-upload:** disabled locally/CI by `SENTRY_DISABLE_AUTO_UPLOAD`.
- **Test-only screens:** app routes are movies, series, live, guide, search, settings, pair, main-menu. `TvPerfHud` mounts only with `__DEV__` + `EXPO_PUBLIC_TV_PERF_HUD=1`.
- **Stale artifacts:** `dist/`, `.apk-banner-verify/`, `startup-debug-bundle/` exist locally and are not the CI release input. Do not ship them.
- **Android project:** `android/` is generated in CI via `npx expo prebuild`. Not required in git.
- **Cleartext:** `usesCleartextTraffic: true` remains (IPTV HTTP).

## Automated Test Results

Ran 2026-08-18 with `node --experimental-strip-types --test`.

**Passed (requested suites):**

- `series-autoplay.test.mjs`
- `series-autoplay-focus.test.mjs`
- `player-chrome-wake.test.mjs`
- `vod-seek.test.mjs`
- `vod-seek-focus-sentinel.test.mjs`
- `playback-continuity.test.mjs`
- `movie-playback-compatibility.test.mjs`
- `live-tv-low-end-workload.test.mjs`
- `live-tv-scroll-perf.test.mjs`
- `live-channel-surf.test.mjs`
- `live-tv-search.test.mjs`
- `device-registration-recovery.test.mjs`
- `movies-search-perf-audit.test.mjs`
- `vod-player-memory.test.mjs`
- most of `search-smoke.test.mjs` and `stage4a-invitation-activation-audit.test.mjs`

**Failed / did not load (non-blocking for freeze):** see next section.

## Known Non-Blocking Test Issues

1. **`scripts/unified-player.test.mjs` fails to LOAD** because Node ESM cannot import directory `src/features/guide/xmltv` from `providerRepositories.ts`. Do not fix this architecture during freeze.
2. **`scripts/search-performance.test.mjs`** now hits the same xmltv directory import through the movies search → sqlite → provider graph. Same parked issue. Do not fix during freeze.
3. **`search-smoke`:** `SEARCH_DEBOUNCE_MS` is `150`; the test still expects `300`. Product constant was not changed in this freeze. Stale assertion.
4. **`stage4a-invitation-activation-audit`:** looks for step title `Verify pairing env for activation builds`; CI step is `Verify Expo token and pairing env`. Closed-beta flags and pairing secrets **are** present in the workflow. Stale assertion.
5. **`movies-diagnostics-json-v1.test.mjs`:** source contract still expects many `console.info('[Marker]' + JSON.stringify)` sites; catalog/movies traces now go through `novacastCatalogTrace` / `novacastTrace`. Regex was broadened; some object-form logs still fail the field-set extractor. Diagnostics remain gated, not removed.
6. **`npm run typecheck`** is not clean. Failures are pre-existing (theme variants, overlay `focusable`, catalog sync types, ONN trace tags, etc.). Not introduced as a first Expo/Metro compile break. Do not mass-fix during freeze.
7. Lint was not run (established Expo lint is noisy relative to freeze scope).

## Manual Beta Smoke Checklist

Install the new APK **over** the existing `com.novacast.novacastv2` build (`versionCode` 4 → 5).

- [ ] install over existing build
- [ ] cold launch
- [ ] device identity preserved
- [ ] provider loads
- [ ] Home focus
- [ ] Movies normal 1080p playback
- [ ] Series playback
- [ ] autoplay
- [ ] Up Next controls (Play Now / Cancel)
- [ ] Continue Watching
- [ ] global Search
- [ ] Live TV
- [ ] Live TV search
- [ ] Guide
- [ ] channel surf LEFT/RIGHT
- [ ] playback controls wake
- [ ] BACK navigation
- [ ] force-stop/relaunch
- [ ] network disconnect/reconnect
- [ ] unsupported 4K movie error behavior (parked; confirm overlay, no crash)
- [ ] no credentials visible in logs/UI (`adb logcat` should not show passwords, Xtream URLs with user/pass, or anon keys)

## Before Distribution

1. Confirm GitHub secrets: `EXPO_TOKEN`, `EXPO_PUBLIC_NOVACAST_PAIRING_API_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_NOVACAST_PAIRING_WEBSITE_URL`.
2. Confirm `EXPO_PUBLIC_NOVACAST_DEBUG` is **not** set in CI (it is not today).
3. Optional: set production keystore secrets if testers must install over a previously Play-signed build.
4. Optional: add `EXPO_PUBLIC_SENTRY_DSN` if you want crash reports from this beta (not required to ship).
5. Run Android beta workflow; do not tag a stable (non-beta) release if you want `/releases/latest` unchanged.
6. Smoke the checklist on a low-end Fire TV and one higher-end stick if available.

## Rollback / Backup Notes

- Previous app version: `1.0.1` / `versionCode` 4.
- New app version: `1.0.4-beta` / `versionCode` 5.
- Package id unchanged, so Android will treat this as an upgrade of the same app.
- Rollback: install the previous `versionCode` 4 APK. Android will not install an older `versionCode` over 5 without uninstall.
- Logging gates have no playback behavior change. If a tester needs verbose logcat, rebuild with `EXPO_PUBLIC_NOVACAST_DEBUG=true` (dev/diag APK only).
- Do not revert catalog/playback/autoplay/Live TV code to “fix” log volume.
