# NovaCast Performance Audit & Architecture Cleanup Pass

Date: 2026-07-24  
Project: `C:\Users\tonyl\Desktop\novacast-v2`  
Constraint: Prior stabilization work preserved (notifications, focus helpers, poster traps, glass chrome, Guide debounce, FlatList tuning, HUD scaffolding).

---

## 1. Executive summary

This pass was **profile-first and measured**, not a rewrite. The largest remaining unnecessary rerenders came from **whole-store subscriptions** (especially `useProviderStore()` and the previous full `useUnifiedPlayer()` snapshot that included ~1 Hz `positionMs`), plus **NovaTvShell’s 30s clock** re-rendering the entire shell/nav tree.

**Global stores were the larger problem** than React Context. The only app-wide Context (`AppThemeProvider`) was already memoized. Notifications were already isolated via `AppNotificationProvider` + external store.

Shipped:

- Activity-only `useUnifiedPlayer()` (no progress-tick browse rerenders)
- `ShellHeaderClock` isolation
- `useProviderChrome()` for navbar/shell labels
- Live browse `preferActiveNavigationFocus={false}`
- Series duplicate `useMediaLibraryStore` removed
- Focus diagnostics: generation, cancel reason, timeout status
- HUD throttle (250ms) + richer honest metrics + image observability
- Dead detail panels removed; SearchOverlay `blurTarget` API removed
- ESLint flat-config ignores restored so `npm run lint` runs again

---

## 2. Baseline architecture map

### State systems (no Zustand)

| Domain | Mechanism | Notes |
|---|---|---|
| Providers | Module store + `useProviderStore` | Whole snapshot; runtime + bundle listeners |
| Media library | Module store + hooks | Per-provider favorites/watchlist |
| Playback | `unifiedPlayerStore` | High-frequency `positionMs` |
| Notifications | External store + host component | Not Context; already isolated |
| Theme | `AppThemeProvider` Context | Memoized on `themeId` |
| Guide memory | Screen refs + memory modules | Post-pass: focus chrome local |
| Movies/Series memory | Module memory | Focused ≠ selected IDs |
| Perf HUD | Dev-only external store | Must not feed app tree |

### Screens (baseline)

| Screen | Main subscriptions | Focus owner | Acceptable? |
|---|---|---|---|
| Home | provider + unified player activity | Screen / hero | Mostly |
| Live | provider + local browse state | Screen regions | Benchmark |
| Movies | provider + library + activity | Screen restore after overlays | Good after prior pass |
| Series | provider + **duplicate** library + model library | Same as Movies | Duplicate library was waste |
| Guide | provider + guide state (debounced) | Screen + local cells | Good after prior pass |
| Search | provider | Overlay / input | Good |
| Settings | provider (broad) | Rail preferred once | OK |
| Content Hub | provider switch fields | Overlay | OK |
| Navbar (shell) | **full provider store** + clock | Preferred focus when armed | **Risk** |
| Notification host | notification store only | Toast only when blocking | Acceptable |
| Playback overlays | full player snapshot in controller | Controls | Acceptable |

### Baseline classification

**Verified bottlenecks**

1. Browse screens subscribed to full player snapshot including progress ticks.
2. Shell clock interval re-rendered navbar + children.
3. Shell used full `useProviderStore` (bundle/runtime churn).
4. Live browse previously allowed nav preferred focus during normal browse.

**Likely risks (documented, partially deferred)**

- Many screens still call `useProviderStore()` and re-render on any provider/runtime/bundle change.
- Catalog sync progress can still fan out through screen-level hooks (`useCatalogSyncStatus`).

**Already acceptable / do not change**

- Movies/Series D-pad focus (ref/memory + memo cards)
- Guide local focus + 200ms details debounce
- Passive notifications
- Glass focus tokens (`NOVA_TV_GLASS`) without blur/scale on TV
- FlatList tuning / `getItemLayout` / sticky image failure

---

## 3. Verified bottlenecks

| Bottleneck | Evidence | Fix |
|---|---|---|
| Playback progress → browse rerenders | `setUnifiedPlayerProgress` ~1 Hz; old hook returned full state | Activity-only snapshot + cache |
| Shell clock | `setInterval(30_000)` in shell body | `ShellHeaderClock` child |
| Shell provider churn | `useProviderStore` deps include full `state`/`runtimeState` | `useProviderChrome` |
| Series double library | Screen + model both subscribed | Screen uses model booleans |
| Live nav preferred during browse | `preferActiveNavigationFocus={!searchBlocksBrowse}` | Forced `false` on browse shells |

---

## 4. State subscription changes

| Change | Eliminates |
|---|---|
| `useUnifiedPlayer` activity snapshot | Browse/screen rerenders on seek/progress |
| `useProviderChrome` | Navbar rerenders on sync/switch/runtime noise when chrome labels unchanged |
| Series `isSelectedFavorite` / `isSelectedWatchlisted` from model | Duplicate media-library subscription on SeriesScreen |
| HUD notify throttle 250ms | HUD self-inflicted React update storms |

Public store APIs / business behavior unchanged.

---

## 5. Context changes

| Context | Finding | Action |
|---|---|---|
| `AppThemeProvider` | Value already memoized | None |
| Notifications | Not Context; host-only | None |
| Playback | Not in app Context | Keep out of Context (confirmed) |

No new Context architecture added.

---

## 6. Focus ownership before and after

### Hierarchy

`App → Navbar (NovaTvShell) → Screen → Region → Item`

### Ownership (after)

| Transition | Owner |
|---|---|
| Initial empty-grid entry | Navbar preferred focus only when `shouldPreferNavigationFocus` (grid empty, no overlays) |
| Movies/Series browse D-pad | Native Pressable (no `requestTvFocus`) |
| Detail/search/playback close | Screen restore via `requestTvFocus` + `resolvePosterRestorationId` |
| Live category → channels | Live screen `requestTvFocus` |
| Guide cell move | Native + `GuideLocalFocusPressable`; restore via `focusNativeViewWhenReady` |
| Blocking notification | Toast only |
| Overlay open focus | Overlay path (detail/search) |

### Navbar

Must not compete with poster restoration: `preferActiveNavigationFocus={false}` on Live browse; Movies/Series continue using `shouldPreferNavigationFocus`.

### Diagnostics enhancements

Every `requestTvFocus` now records:

- source, region, item, reason
- generation/token
- status: `executed` | `cancelled` | `ignored` | `timeout`
- cancelReason: `superseded` | `caller` | `inactive` | `timeout`

---

## 7. Navbar isolation changes

| Trigger | Before | After |
|---|---|---|
| Poster focus move | No (already) | No |
| Guide cell move | No (already) | No |
| Provider sync/runtime | Could re-render shell | Chrome snapshot stable unless displayed label/id/expiration changes |
| 30s clock | Full shell | Clock child only |
| Notifications | Host only | Host only |
| Playback progress | Via screens using old hook | Activity-only on screens; shell not subscribed to player |

Visual/nav design unchanged.

---

## 8. Dead / duplicated state removed

| Item | Action |
|---|---|
| `MovieDetailPanel.tsx` | Deleted (unused; overlay owns details) |
| `SeriesDetailPanel.tsx` | Deleted |
| `MediaDetailPanel.tsx` | Deleted |
| `SearchOverlay.blurTarget` prop | Removed (API dead after blur removal) |
| SeriesScreen `focusedSeriesId` → grid | Pass `null`; grid prop unused for render |
| SeriesScreen duplicate library store | Removed |

Kept intentionally: focused vs selected IDs (real distinction for restore).

---

## 9. Selector and derived-data improvements

- Provider chrome snapshot referentially stable when displayed fields unchanged.
- Unified player activity snapshot referentially stable across progress ticks.
- No FlashList / catalog cache redesign.
- Memory tradeoff: continue avoiding duplicate full catalog materialization; FlatList windowing remains the browse boundary.

---

## 10. FlatList / mounting findings

Unchanged from prior pass; reconfirmed by policy:

- Stable `item.id` keys; append-only pagination
- `TV_POSTER_LIST_TUNING` + `getItemLayout`
- `removeClippedSubviews={false}` (Android TV clipping/focus risk)
- **FlatList remains appropriate** — no FlashList migration without ONN measurements

Deferred: FlashList evaluation only after ONN HUD shows blanking / remount evidence.

---

## 11. GPU / overdraw findings

Glass focus (`NOVA_TV_GLASS`) is already TV-lite:

- translucent fill + border
- no blur on moving focus
- no scale / shadow on TV (`NOVA_TV_LITE_FOCUS`)

Suspected residual overdraw: large backdrop artwork under translucent overlays (detail/search) — acceptable for brand; do not redesign this pass.

No glass redesign performed.

---

## 12. Image pipeline findings

Kept `TvRemoteImage` (RN `Image`):

- memo + stable `source`
- sticky failure by URI
- pending counter
- new observability: mounts, failures, source changes, duplicate URI hits (host/path fingerprint only — **no credentials / full query strings**)

**expo-image migration not justified** yet — no measured decode win vs remount/network.

---

## 13. HUD refinements

Flag: `EXPO_PUBLIC_TV_PERF_HUD=1` + `__DEV__`

- Throttled subscribe (250ms)
- Latest focus source/region/reason/generation
- Focus req/s, poster renders/s, Guide cell renders/s
- Image pending/fails/mounts/dup hits
- UI FPS via rAF; **JS FPS n/a**; **Memory n/a** (honest labels)
- Inactive in production; does not write application state

---

## 14. ESLint repair

- Project uses ESLint 9 + flat `eslint.config.js`
- Expanded `ignores` for `.expo`, `android`, `ios`, export-check trees, `startup-debug-bundle`
- `npm run lint` **runs** (config failure fixed)

Remaining: **pre-existing rule violations** (react-hooks `set-state-in-effect` / `refs`) — not introduced by this pass; not mass-fixed.

---

## 15. Files changed (primary)

- `src/features/playback/unified/useUnifiedPlayer.ts`
- `src/components/nova/NovaTvShell.tsx`
- `src/features/providers/providerStore.ts` (`useProviderChrome`)
- `src/features/live/LiveTvScreen.tsx` (nav preferred focus)
- `src/features/series/SeriesScreen.tsx`, `useSeriesScreenModel.ts`, `SeriesPosterGrid.tsx`
- `src/features/movies/components/MoviePosterGrid.tsx`
- `src/features/navigation/tvFocusDiagnostics.ts`
- `src/features/perf/tvPerfStore.ts`, `TvPerfHud.tsx`, `tvImageObservability.ts`
- `src/components/media/TvRemoteImage.tsx`
- `src/features/guide/GuideLocalFocusPressable.tsx`
- `src/features/search/SearchOverlay.tsx`
- `eslint.config.js`
- `scripts/architecture-cleanup.test.mjs`, `scripts/run-smoke-tests.mjs`
- Deleted: `MovieDetailPanel.tsx`, `SeriesDetailPanel.tsx`, `MediaDetailPanel.tsx`
- Smoke compatibility: relative imports in `ContentPolicyService.ts`, `.ts` extension in `deviceActivation.ts`

---

## 16. Tests and validation results

| Command | Result |
|---|---|
| Focus / architecture suites (targeted) | **54/54 pass** (`architecture-cleanup`, `tv-focus-stabilization`, `movies-series-stabilization`, `live-tv-focus-pass2`, `guide-polish`, `notification-focus`) |
| `npm run typecheck` | Failures present — **mostly pre-existing** (theme variant typing, `DEVICE_SECRET_KEY`, borderRadius duplicates). Guide ref typing fixed in this pass. |
| `npm run lint` | **Config OK**; **52 errors / 67 warnings** pre-existing rule noise |
| `npm run test:smoke` (full) | Mixed: many suites pass; some fail on Node ESM/`node_modules` type-stripping when device/expo graphs are pulled — **environment limitation**, not a regression of focus/HUD logic |

New coverage: navbar cannot override restore; restoration prefers focused ID; HUD off by default; focus cancel/timeout diagnostics.

---

## 17. Before / after render measurements

Device FPS/render counts were not captured on ONN in this pass (no APK rebuild). Expected deltas from architecture:

| Event | Before | After |
|---|---|---|
| Playback progress tick | Browse screens using `useUnifiedPlayer` re-render | No (activity snapshot stable) |
| Shell clock tick | Full shell + children | Clock text only |
| Provider runtime/sync with same chrome labels | Shell re-render | No (chrome cache) |
| Series library toggle | Two library subscriptions | One (model) |
| Poster/Guide D-pad | Unchanged (already local) | Unchanged |

ONN HUD should be used to confirm numbers (§20).

---

## 18. Remaining risks

- Broad `useProviderStore()` still used by most screens (narrowing deferred beyond chrome).
- Catalog sync status hooks can still refresh screen chrome messages.
- Full smoke under Node 24 + `--experimental-strip-types` is fragile when Expo native modules enter the graph.
- Typecheck debt outside this pass remains.

---

## 19. Deferred recommendations

1. Selector-style `useProviderStore(selector)` for screen-level fields.
2. ONN-measured FlashList trial only if HUD shows remount/blanking.
3. ONN-measured expo-image trial only if decode time dominates pending images.
4. Clean remaining ESLint react-hooks violations incrementally.
5. Add a Node smoke import map / loader for `@/` if smoke must load app modules broadly.

---

## 20. Exact ONN device test plan

1. Install current debug build (user-driven; **not rebuilt in this pass**).
2. Set `EXPO_PUBLIC_TV_PERF_HUD=1` for a Metro debug session.
3. **Live TV**: category switch → channel focus; D-pad browse; confirm HUD focus req/s stays near 0 during browse.
4. **Movies/Series**: rapid poster moves; confirm navbar does not flicker; open/close detail/search/playback; exact poster restore.
5. **Guide**: rapid horizontal/vertical; details update after ~200ms idle; cell renders local.
6. **Playback**: start movie; confirm browse screen under player does not spin on progress (watch HUD / React Profiler if attached).
7. **Images**: note pending/fail/dup counters while scrolling large categories; correlate blanking with network vs remount.
8. **Notifications**: passive toast appears without stealing focus; blocking toast still works.
9. Compare subjective smoothness to Live TV benchmark.

---

## Final response checklist (prompt §16 summary)

- Largest unnecessary rerenders: whole provider + full player progress subscriptions; shell clock.
- Stores vs Context: **stores larger**.
- Navbar isolation: **improved** (chrome + clock).
- Programmatic focus paths: `requestTvFocus` remains on restore/Live/search/notification paths (~17 call sites across 6 modules); Guide/playback still use `focusNativeViewWhenReady` in places.
- Dead state removed: unused detail panels, blurTarget API, Series duplicate library, unused focusedSeriesId wiring.
- GPU-heavy glass: **not found** (already lite).
- FlatList: **still appropriate**.
- Image migration: **not justified**.
- Validation: targeted focus/architecture **pass**; lint config **fixed**; full smoke/typecheck have pre-existing/environment noise.
- Next ONN: §20 plan above.
