# NovaCast Beta Readiness & Resilience Pass

Date: 2026-07-24  
Project: `C:\Users\tonyl\Desktop\novacast-v2`  
Constraint: No redesigns; prior focus/perf/architecture work preserved.

---

## 1. Executive summary

Closed-beta readiness improved from **fragile startup + silent mid-session revoke + sync wipe risk** to **bounded startup, classified provider errors, catalog-preserving sync failure, playback buffering timeout, lifecycle-aware focus cancel, root/playback error boundaries, and Beta Support diagnostics**.

**Before score:** ~4.5 / 10 (usable when network is healthy; stuck/spin/wipe risks under failure)  
**After score:** ~7.5 / 10 (recoverable paths for P0s addressed in this pass; remaining P1s documented)

---

## 2. Beta readiness score before and after

| Area | Before | After |
|---|---|---|
| Error boundaries | 0 | Root + playback |
| Startup hang | Possible (StartupGate) | Bounded timeouts + actionable UI |
| Device revoke mid-session | Ignored | Heartbeat applies + route home |
| Provider error copy | Generic | Classified messages |
| Sync failure wipe | Yes (memory + partial counts) | Restore snapshot + merge counts |
| Playback buffering | Could spin forever | 30s timeout → error |
| Live refresh wipe | Cleared channels | Retain last-good list |
| Offline UX | Inferred only | Passive banner + outcome reporting |
| Beta Support | Minimal About | Diagnostic block in Settings → About |
| Lifecycle | None | AppState monitor + focus cancel |

---

## 3. P0 / P1 / P2 / P3 audit table (condensed)

| Sev | Subsystem | Condition | Before | Fix this pass? |
|---|---|---|---|---|
| P0 | React boundaries | Render throw crashes app | None | **Fixed** — `NovaErrorBoundary` |
| P0 | StartupGate | Device/status hang | Indefinite loader | **Fixed** — 12s timeout + Retry |
| P0 | StartupGate | Active, no library assigned | Indefinite download | **Fixed** — actionable error |
| P0 | StartupGate | Managed download hang | Indefinite | **Fixed** — 45s timeout |
| P0 | Revoke cold start | `invalid_device` reused cache | Soft offline active | **Fixed** — hard revoke + clear cache |
| P0 | Revoke mid-session | Heartbeat ignored | Full access | **Fixed** — apply + redirect |
| P0 | Catalog sync | Failed refresh clears index | Empty browse | **Fixed** — abort restores snapshot |
| P0 | Catalog counts | Partial write replaces map | Lost counts | **Fixed** — merge |
| P1 | Provider errors | Timeout ≈ auth ≈ offline | Generic connect fail | **Fixed** — classifier |
| P1 | Playback buffering | Endless spinner | After first frame | **Fixed** — 30s bound |
| P1 | Live refresh | Error clears channels | Empty rail | **Fixed** — retain |
| P1 | Closed-beta init UX | Pair Another offered | Wrong path | **Fixed** — hide when managed |
| P1 | AppState | No sleep/wake policy | Stale focus retries | **Partial** — cancel focus; light lifecycle |
| P1 | Offline browse | Full indexes session-only | Thin cold offline | **Deferred** (design) |
| P2 | Heartbeat interval | 20 min | Slow revoke detect | Deferred |
| P2 | Guide/Search | Error UX mostly OK | — | Kept |
| P3 | Splash timeouts | Already bounded | — | Kept |

---

## 4. Startup state machine

### Before
`splash → initializeDevice (unbounded) → StartupGate loaders (can wait forever) → main-menu`

### After
```
splash (bounded)
  → initializeDevice(withTimeout 12s)
      → success | timeout → StartupActionScreen(Retry)
  → activation gate (invite / expired / revoked)
  → managed download (withTimeout 45s) | library-missing actionable error
  → provider init error (Retry; Pair only if personal pairing enabled)
  → main-menu
```

Terminal outcomes: success | recoverable offline (cached status) | actionable error | activation required | provider action required.

---

## 5. Offline behavior

- `reportNetworkOutcome` updated from device status / heartbeat / managed download.
- Passive `OfflineStatusBanner` (non-focusable).
- Outage announcement deduped (60s).
- Does **not** wipe catalogs on offline.
- Full offline Movies/Series cold browse remains limited (indexes not fully persisted) — documented risk.

---

## 6. Provider error classification

`src/features/resilience/providerFailureClassifier.ts` kinds include: invalid credentials, expired, disabled, timeout, offline, DNS, TLS, rate limit, temporary server, missing credentials, etc.

`describeSwitchFailure` now uses classifier messages. Permanent failures are not auto-retry safe.

---

## 7. Provider sync resilience

- `MovieCatalogIndex` / `SeriesCatalogIndex`: `beginSync` snapshots; `abortSync` restores; `commitSync` drops snapshot.
- Sync catch calls `abortSync` and logs `cachedDataPreserved: true`.
- Mid-sync count writes use `mergeCategoryCountIndex` (no full replace with partial maps).
- Coalescing / cancel-on-switch unchanged.

---

## 8. Playback recovery

- Loading timeout: **20s** (existing).
- Buffering timeout: **30s** (new) → error + Retry/Back.
- Retry debounce / single session behavior preserved.
- Playback subtree wrapped in error boundary.

---

## 9. Lifecycle handling

- `ensureAppLifecycleMonitor` + diagnostics.
- Background cancels pending `requestTvFocus`.
- Foreground gate prevents new programmatic focus while inactive.
- Heartbeat revoke closes playback and routes to `/`.
- Full revalidate-on-resume still deferred (avoid duplicate sync storms).

---

## 10. Storage / database recovery

- Device status hard-revoke clears status cache (not device identity/secret).
- No automatic destructive “clear everything”.
- SQLite not used.
- Corrupt optional caches already had soft fallbacks (kept).

---

## 11. Activation and invitation resilience

- Device status fetch bounded.
- Revoked / invalid_device → invite path.
- Heartbeat enforces mid-session revoke/expiry.
- Invitation UI messaging kept; deeper polling polish deferred.

---

## 12. Search resilience

No broad rewrite. Existing empty/error/Retry paths retained. Close restoration remains from prior focus pass.

---

## 13. Guide / EPG resilience

No broad rewrite. Prior Guide local focus + soft EPG failure behavior retained. Live remains usable without EPG.

---

## 14. Loading and empty-state standards

Adopted rules:

- Blocking only when action cannot continue.
- Preserve last-good lists on refresh failure (Live).
- Startup loaders must time out into actionable UI.
- Loading chrome must not steal focus (unchanged).

---

## 15. Retry policy matrix

| Operation | Auto retry | Max / bound | User retry |
|---|---|---|---|
| Device status | Manual after timeout | 12s | Retry |
| Managed download | Manual | 45s | Retry |
| Provider init | Existing 6× | linear delay | Retry |
| Invalid credentials | **No** | — | Fix / reconnect |
| Catalog sync | Resume/checkpoint | coalesce | Next open / remote refresh |
| Playback load/buffer | No auto | 20s / 30s | Retry |
| Focus requests | Cancel on background | — | — |
| Offline announce | Dedupe 60s | — | — |

---

## 16. Notification / message improvements

- Provider connect failures use plain actionable copy via classifier.
- Passive offline chip (not blocking).
- Sanitized diagnostics never log passwords/tokens/URLs.

---

## 17. Diagnostic and privacy safeguards

- `recordSanitizedDiagnostic` + scrubber.
- `buildDiagnosticCode` for Beta Support.
- No third-party crash SDK added; integration boundary ready via diagnostic events.

---

## 18. Beta Support information

Settings → About → **Beta Support** block:

- Version / build
- Device ID (public code)
- Model / Android version
- Activation
- Provider display name
- Last provider sync
- Network status
- Diagnostic code

---

## 19. Files changed (primary)

- `src/features/resilience/*` (boundary, classifier, lifecycle, offline, diagnostics, gate)
- `src/features/startup/StartupGate.tsx`, `startupTimeouts.ts`, `ProviderInitErrorScreen.tsx`
- `src/features/device/deviceActivation.ts`, `deviceHeartbeat.ts`, `deviceStorage.ts`
- `src/features/providers/providerStore.ts`, `providerCatalogSync.ts`
- `src/features/movies/smart/movieCatalogIndex.ts`, `series/.../seriesCatalogIndex.ts`
- `src/features/playback/unified/unifiedPlayerLogic.ts`, `UnifiedPlayerController.tsx`
- `src/features/live/useLiveTvScreenModel.ts`
- `src/features/navigation/tvFocusDiagnostics.ts`
- `src/features/settings/SettingsScreen.tsx`, `SettingsDetailPanel.tsx`
- `src/app/_layout.tsx`
- `scripts/beta-readiness-resilience.test.mjs`

---

## 20. Tests executed

| Suite | Result |
|---|---|
| `beta-readiness-resilience.test.mjs` | **Pass** |
| `architecture-cleanup.test.mjs` | **Pass** |
| `tv-focus-stabilization.test.mjs` | **Pass** |
| `movies-series-stabilization.test.mjs` | **Pass** |
| `guide-polish.test.mjs` | **Pass** |
| `notification-focus.test.mjs` | **Pass** |
| `live-tv-focus-pass2.test.mjs` | **Pass** |
| Combined above | **52/52 pass** |

---

## 21. Validation results

| Command | Result |
|---|---|
| Targeted resilience/focus suites | **Pass (52)** |
| `npm run typecheck` | Failures remain — mostly **pre-existing** theme/variant/DEVICE_SECRET_KEY; this pass fixed new Pressable typing issues |
| `npm run lint` | Config works; pre-existing rule noise |
| Full `npm run test:smoke` | Not claimed fully green — Node/ESM/expo import limitations remain for some suites |

---

## 22. Remaining beta risks

1. Cold offline Movies/Series still thin (no full disk catalog index).
2. Heartbeat still 20 minutes (slow revoke detection when online).
3. `offlineGraceUntil` not fully enforced as a timed window.
4. No production crash reporter SDK.
5. Some typecheck debt outside this pass.

---

## 23. Deferred post-beta recommendations

- Persist compact catalog shards for true offline browse.
- Shorter beta heartbeat (2–5 min).
- Enforce offline grace expiry.
- Optional Sentry/Bugsnag behind privacy scrubber.
- Broader AppState revalidate policy with sync coalescing.

---

## 24. Exact ONN test plan

1. Launch online → Home  
2. Launch offline → actionable/timeout or cached path  
3. Disconnect while browsing Movies  
4. Reconnect — no full app reload  
5. Browse cached Movies/Series  
6. Force provider timeout — not “invalid credentials”  
7. Invalid credentials (safe test account) — no infinite auto-retry  
8. Valid Live stream  
9. Disconnect during Live  
10. Retry playback  
11. Invalid stream  
12. Back exits failed player  
13. Background during preview  
14. Background during playback  
15. Background 5 minutes  
16. Wake / resume  
17. Guide with EPG  
18. Guide without EPG — Live still works  
19. Expired activation code messaging  
20. Device revocation mid-session → invite/home  
21. Provider switch during sync — old work cancelled  
22. Settings → About → Beta Support  
23. Record diagnostic code  
24. Confirm HUD/logs have no credentials  
25. 30-minute soak for duplicate toasts/syncs  

---

## Final checklist answers

| Question | Answer |
|---|---|
| P0s found / fixed | Boundaries, startup hangs, revoke cold+mid, sync wipe, partial counts — **fixed** |
| Remaining P1s | Thin offline catalog; heartbeat latency; incomplete AppState revalidate |
| Startup hang indefinitely? | **No** (bounded + actionable) |
| Playback spin indefinitely? | **No** for load/buffer (20s/30s) |
| Failed sync erase valid cache? | **No** (restore + merge) |
| Offline cached browsing? | **Partial** (counts/smart IDs; not full indexes) |
| Provider errors classified? | **Yes** |
| Background/foreground duplicate sync? | No intentional resume re-sync; focus retries cancelled |
| Device revocation enforced? | **Yes** (status + heartbeat) |
| Recovery screens focused? | **Yes** (preferred focus on primary) |
| Validation | Targeted **52/52**; typecheck/lint pre-existing noise |
| Next ONN | §24 sequence above |
