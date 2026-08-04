# TV Back Handler Audit

**Branch:** `audit-movies-navigation-architecture-20260804`  
**Date:** 2026-08-04  
**Scope:** Investigation only.

Findings:

- No `useFocusEffect` back callbacks in `src/`.  
- No `router.back()` usage; leave-screen navigation is almost always `router.replace(...)`.  
- Many independent `BackHandler.addEventListener('hardwareBackPress')` registrations with local priority stacks.

---

## 1. Handler inventory

| Section / component | Handler site | Registration | Enabled when | Return | State changed | Route | Focus | Scroll | Can race with |
|---|---|---|---|---|---|---|---|---|---|
| Movies | `MoviesScreen.tsx` ~1579 | mount effect | Android | true if handled | detail/search/playback close | replace home | Stage 3D restore | scrollToOffset | Player, SearchOverlay, toast, sort, guide, exit |
| Series | `SeriesScreen.tsx` ~298 | mount | Android | true if handled | search/detail/playback | replace home | simple requestTvFocus | none for detail | Player, overlays |
| Live TV | `LiveTvScreen.tsx` ~432 | mount | Android | true if handled | fullscreen / leave | `returnRoute` | fullscreen restore | channel list elsewhere | **SearchOverlay owns search Back** (Live ignores search) |
| Search screen | `SearchScreen.tsx` ~135 | mount | Android | true if handled | detail → playback → home | replace home | detail close only | search grids own scroll | Player, overlay |
| Search overlay | `SearchOverlay.tsx` ~373 | when visible | overlay visible | `onClose()` | close overlay | none | parent | none | Host screen Back |
| Unified player | `UnifiedPlayerController.tsx` ~631 | when active/closing | playback | closeUnifiedPlayback | player store | none | screens via didJustClose | none | Screen Back also checks playback |
| Guide | `GuideScreen.tsx` ~351 | mount | Android | search/filter/rail/home | local UI | replace home | local | local | overlays |
| Settings | `SettingsScreen.tsx` ~153 | mount | Android | guide swallow / home | — | replace home | — | — | toast |
| Content hub overlay | `ContentHubOverlayScreen.tsx` ~109 | mount | Android | replace main-menu | — | replace | — | — | — |
| Portal / pairing | `NovaPortalScreen.tsx` ~608 | mount | Android | pairing/panel/exit | local | exit confirm | — | — | ExitConfirm |
| Exit confirm | `ExitConfirmOverlay.tsx` ~25, ~85 | visible / hook | enabled | cancel / show / exitApp | exit UI | exit | — | — | all |
| Walkthrough | `WalkthroughOverlay.tsx` ~88 | guide visible | visible | onDismiss | dismiss | none | — | — | host |
| Notifications | `AppNotificationToast.tsx` ~120 | blocking toast | blocking | dismiss | toast | none | — | — | all |
| Sort control | `ContentSortControl.tsx` ~63 | menu open | open | close menu | sort UI | none | — | — | host screen |

Helpers: `decideMoviesBackAction` / `shouldHandleMoviesDetailBack` (`moviesPlaybackLogic.ts`); `decideLiveTvBackAction` (`liveTvFocusRestoration.ts`).

---

## 2. Movies Back priority (in-handler order)

1. Guide visible → swallow  
2. Playback closing / launching / active → `closePlayback` if active  
3. Detail open or closing → `closeDetail` (Stage 3D)  
4. Search open → `closeSearch`  
5. `decideMoviesBackAction` → close-playback / swallow / leave  
6. Nav gate → `router.replace(TV_HOME_ROUTE)`

---

## 3. Cross-section differences (why Back feels inconsistent)

| Concern | Movies | Series | Live | Search |
|---|---|---|---|---|
| Detail close | Multi-phase Stage 3D; overlay stays until confirm | Instant close + focusSelectedPoster | N/A | Instant `setDetailOpen(false)` |
| Search vs detail order | **Detail before search** | **Search before detail** | Screen ignores search; overlay handles | Is search UI |
| Viewport restore | Yes (`scrollToOffset` + latch) | No | Fullscreen-specific | Local search scroll helpers |
| Playback return | Stage 3D restore (or reopen search detail) | Simple `requestTvFocus` | Fullscreen restore swallow | `handlePlaybackClosed` |
| Leave route | `TV_HOME_ROUTE` | `TV_HOME_ROUTE` | `returnRoute` param | `TV_HOME_ROUTE` |

**Root cause of inconsistency:** each screen registers its own native Back listener with a bespoke priority list. There is no shared layer registry, so ordering and semantics drift (especially Movies Stage 3D vs Series instant close).

---

## 4. Duplicate / competing handlers

1. **Playback:** `UnifiedPlayerController` and Movies/Series/Search screens all inspect playback state — double close risk mitigated by return-true, but ownership is unclear.  
2. **Search on Live:** Live screen does not handle search; `SearchOverlay` does — correct but asymmetric vs Movies (Movies handles search in-screen).  
3. **Exit confirm + portal + host screens** can all listen; registration order depends on mount tree.  
4. **Blocking toast** can steal Back from any screen.  
5. **Movies closing phase** swallows duplicate Back while Series does not have an equivalent latch.

---

## 5. Movie Detail close (Back) — state/ref checklist

See also `MOVIES_RENDER_LIFECYCLE_AUDIT.md` §4.

| Symbol | Role on close |
|---|---|
| `browseFocusSnapshotRef` | Immutable target (movieId, index, offset, visible range) |
| `viewportStateRef` | Live offset / first / last during close |
| `detailFocusTokenRef` | Close token + snapshot |
| `scrollIssuedTokenRef` | Initial scroll issued for token |
| `viewportRestoreCountRef` | Cap 2 |
| `focusRequestCountRef` | Cap 2 |
| `viewportStableRef` | Within 12px of snapshot |
| `detailFocusPhase` | prepare → viewport → focus → confirm → restored → browse |
| `closingFocusMovieId` | Only focusable poster |
| `viewportRestoreCommand` | Drives grid `scrollToOffset` |
| `postRestoreLatch` / ref | 750ms preferred ownership |
| `lockScrollForFocusRestore` | `FlatList.scrollEnabled={!lock}` |
| `restoringBrowseFocus` | Nav preferred-focus gate |
| InteractionManager / rAF | Overlay handoff, settle, suppression release |
| `scrollToOffset` | Initial + optional corrective |
| `scrollToIndex` | **Not used** on Movies grid |

Background grid/data remain mounted while detail open **unless** a concurrent catalog/repair clears categories.

---

## 6. Snapshot-return design (proposed, not implemented)

### Normal lifecycle

```text
BROWSE → OVERLAY_OPEN → BROWSE
```

Normal close must:

- never reload data / categories / visibleMovies  
- never remount `MoviePosterGrid`  
- never call `scrollToOffset` / `scrollToIndex`  
- hide overlay and `requestTvFocus` the original mounted card  

### Exceptional fallback only when

- original card unmounted by virtualization  
- active catalog generation changed  
- selected category disappeared  
- route recreated / activity recreation after playback  

Fallback may then re-bind focus by index or one non-animated offset restore.

### Stable focus target idea

Keep a non-virtualized focus anchor (or ensure the selected index stays in the render window via `maintainVisibleContentPosition` / windowing policy) so normal close never needs corrective scrolling.

---

## 7. Shared TV Back coordinator (proposed API)

```ts
useTvBackLayer({
  id: string;
  priority: number; // critical-modal > player > detail > search > nested > route > exit
  enabled: boolean;
  onBack: () => boolean; // true = consumed
});
```

Requirements:

- One Back press → one winning enabled layer (highest priority).  
- Safe unregister on unmount.  
- No per-screen native listener races.  
- Playback explicit precedence.  
- Overlays close without route changes.  
- Route Back only if no layer handles.  
- Focus restoration belongs to the closing layer.  
- Diagnostics: `{ traceId, winnerId, priority, action }`.

### Compare to current app

| Aspect | Current | Proposed |
|---|---|---|
| Registration | N independent BackHandlers | One dispatcher + N layers |
| Priority | Ad-hoc per screen | Shared numeric policy |
| Movies vs Series | Divergent detail close | Same detail layer semantics |
| Diagnostics | Partial per-screen logs | Single consumer log |
| Focus restore | Embedded in MoviesScreen | Owned by detail layer module |

---

## 8. Provider Manager / Settings / onboarding

- Settings: simple leave-home / guide swallow.  
- Portal/pairing: nested panel + exit confirm.  
- Walkthrough: dismiss-only.  
- Provider manager paths (if hosted in hub/settings): inherit host Back; no Movies-specific restore.

No production changes in this audit.
