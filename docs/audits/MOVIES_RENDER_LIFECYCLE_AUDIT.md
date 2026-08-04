# Movies Render Lifecycle Audit

**Branch:** `audit-movies-navigation-architecture-20260804`  
**Date:** 2026-08-04  
**Scope:** Investigation only. Instrumentation proposed, not added.

---

## 1. Component tree

```text
MoviesScreen
  → useMoviesScreenModel (state owner)
  → MovieCategoryRail
  → MoviePosterGrid (FlatList key={columns})
       → MoviePosterCard (memo)
  → MovieDetailOverlay (BlurView + card; blurTarget=browseLayerRef)
  → Search / playback / guide overlays (siblings)
```

---

## 2. Remount and identity analysis

| Risk | Location | Assessment |
|---|---|---|
| Grid unmount when `categories.length === 0` | `MoviesScreen.tsx` (~2902) | **Hard unmount** — posters vanish entirely |
| FlatList `key={columns}` | `MoviePosterGrid.tsx` (~503) | Remount on column count change only |
| No `extraData` on FlatList | MoviePosterGrid | Focus props via renderItem deps; cell re-render, not remount |
| `keyExtractor = item.id` | MoviePosterGrid | Stable |
| `data={movies}` new array | model `updateVisibleMovies` | Recycle / content replace; logged as data identity change |
| `MoviePosterCard` memo | compares focusable / forceFocused / preferred | Re-renders during close focus pin |
| Overlay mount window | stays mounted through closing phases | Unmounts at `browse-restored` |
| BlurView | full-screen over browse layer | `focusable={false}`; handoff sets blur `pointerEvents='none'` |
| Browse `pointerEvents` | none while detail open; auto while closing | Allows target poster focus under overlay |
| Detail is overlay, not route | same MoviesScreen parent | Does **not** change route; can change PE / focusability / chrome |

**Verdict:** Normal detail open/close is designed to avoid FlatList remount. Visible scroll is from restore pipeline (see Audit G in executive summary / Back audit), not key remount. Unrelated catalog/repair paths can still unmount the grid by clearing categories.

---

## 3. Detail open/close vs data

| Question | Answer |
|---|---|
| Does open Detail reload categories? | No (by design) |
| Does open Detail clear visibleMovies? | No |
| Does close Detail call getMoviesPage? | No (unless concurrent catalog-ready / reload) |
| Does close Detail remount MoviePosterGrid? | No (intended) |
| Does background grid stay mounted? | Yes while `categories.length > 0` and overlay mounted |
| Can catalog-ready during detail mutate browse? | **Yes** — atomic swap can replace categories/movies while overlay open |

---

## 4. Movie Detail close sequence (category 287, scrolled, Back)

Chronological (browse path; not search-origin):

### Open

1. `handleSelectMovie` writes `browseFocusSnapshotRef` (movieId, index, verticalOffset, first/last visible).  
2. `detailOpen=true`, `detailFocusPhase='detail-open'`.  
3. Overlay mounts; browse `pointerEvents='none'`. Snapshot immutable.

### Back → `closeDetail`

4. Guard: only if phase === `'detail-open'` (`canBeginMoviesDetailClose`). Duplicate Back during closing swallowed.  
5. `beginDetailFocusClose('detail-close')`:
   - new `detailFocusTokenRef`
   - reset `scrollIssuedTokenRef`, `viewportRestoreCountRef=0`, `focusRequestCountRef=0`, `viewportStableRef=false`, etc.
   - `closingFocusMovieId=snapshot.movieId`, `restoringBrowseFocus=true`
   - phase → `closing-prepare`
   - **`detailOpen` stays true** (overlay remains)

### Close driver

6. **`closing-prepare`**: rAF focus overlay close target → phase `closing-viewport`; overlay `focusHandoffActive`.  
7. **`closing-viewport`**: **always** issues initial `viewportRestoreCommand` → grid `scrollToOffset({ offset: snapshot.verticalOffset, animated: false })` even if already “stable”.  
8. Settle / onScroll ack within 12px → `viewportStableRef` → phase `closing-focus`.  
9. **`closing-focus`**: `lockScrollForFocusRestore=true`; `requestTvFocus` to target poster (only that card focusable).  
10. Poster `onFocus` → `completeDetailFocusRestore`:
    - if focus OK but offset drifted (native TV row align ≤140px): optional **corrective** `scrollToOffset` (max 2 restores)
    - else confirm → phase `browse-restored`, `detailOpen=false`, post-restore latch 750ms, unlock scroll, clear closing pin

### Sources of slight scroll

1. Intentional initial `scrollToOffset` re-assert (code comment: TV may have drifted; same-offset may not emit onScroll).  
2. Native TV focus auto-align (~one row) after poster focus → corrective scroll.  
3. Tolerance band (12px) can leave residual jitter.  
4. Overlay/Blur teardown perception (secondary).

**Not primary:** FlatList remount, `scrollToIndex` (Movies grid does not use it).

---

## 5. Proposed render counters (do not add in this pass)

Instrument (dev-only) render counts + mount/unmount for:

- MoviesScreen  
- MovieCategoryRail  
- MoviePosterGrid  
- first visible poster  
- selected poster  
- MovieDetailOverlay  

### Trace cycles

| Cycle | Expect |
|---|---|
| Initial Movies open | Screen/rail/grid mount once; posters mount for first page |
| Category selection | Rail re-render; grid data replace; not remount unless columns change |
| Detail open | Overlay mount; grid **no remount**; posters may re-render focus props |
| Detail close | Overlay handoff; **1–2 scrollToOffset**; focus requests ≤2; grid no remount |
| Playback open/close | Player layer; then Movies restore pipeline (or search reopen) |
| Catalog-ready | Possible atomic categories+movies replace; grid should not remount; data identity changes |

Pass criteria for detail close: `MoviePosterGrid` mount count unchanged; `scrollToOffset` count ≤2; final offset within 12px of snapshot; focus on snapshot movieId.

---

## 6. What should leave MoviesScreen / model (preview)

See `MOVIES_TARGET_ARCHITECTURE.md`. Render-wise:

- Detail close should not own a multi-phase scroll machine in the screen for the **normal** path.  
- Catalog activation should not tear down the grid while a healthy snapshot exists.  
- Focus restoration exceptional path only when virtualization unmounted the card.
