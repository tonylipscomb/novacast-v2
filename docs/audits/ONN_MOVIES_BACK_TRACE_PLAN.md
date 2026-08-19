# ONN Movies / Back Trace Plan

**Branch:** `audit-movies-navigation-architecture-20260804`  
**Date:** 2026-08-04  
**Scope:** Device evidence plan only — instrumentation may be proposed later; not added in this audit.

---

## 1. Trace identity

Each test cycle uses one `traceId`:

```text
onn-<yyyyMMdd>-<HHMM>-<scenario>-<n>
```

Example: `onn-20260804-1430-detail-back-1`

Log every event as JSON with at least:

```json
{
  "traceId": "...",
  "t": 0,
  "tag": "Movies|Back|Focus|Catalog|Render",
  "event": "...",
  "payload": {}
}
```

---

## 2. Fields to capture

| Field | Source idea |
|---|---|
| active screen / route | navigation state |
| active Back layers | proposed dispatcher; today: which handler returned true |
| focused native node | TV focus diagnostics / tag |
| selectedCategoryId / selectedMovieId | model |
| focusedMovieId | model |
| catalog generation (readable / syncing / active) | readiness |
| list offset | viewportStateRef / onScroll |
| first/last visible indexes | onViewableItemsChanged |
| render/remount counts | proposed counters |
| Back consumer | handler id + priority |
| scroll command | scrollToOffset args + reason |
| focus command | requestTvFocus target |
| final restored state | movieId, offset, phase |

---

## 3. Scenario matrix

### A. Detail Back

1. Open Movies; wait ready; select populated category (e.g. 287).  
2. Scroll to nonzero offset; focus a mid-list poster.  
3. Open detail.  
4. Press Back.  
5. **Pass:** same category; same movie focused; offset within 12px of pre-open; grid mount count unchanged; `scrollToOffset` ≤2; no category reload; no `loadStatus` flip to empty.  
6. **Fail:** visible jump >12px; wrong poster; categories cleared; generation change mid-close without reason.

### B. X close

Same as A but close via overlay X.  
**Pass:** identical to Back (same consumer semantics for browse detail).

### C. Playback Back

1. From detail, Play.  
2. Back from player.  
3. **Pass:** player closes once; return to detail or browse per product rule; no double-close; Movies not blanked.  
4. Capture whether Stage 3D restore runs vs search-origin reopen.

### D. Search Back

1. Open Movies search; open result detail if applicable.  
2. Back through detail → search → browse.  
3. **Pass:** order matches Movies priority (detail before search); no route leave until stack clear; browse focus restored without catalog reload.

### E. Category navigation

1. Move across several populated categories.  
2. **Pass:** each first page from same readable generation; no zero-count categories interactive; selection never lands on count 0.

### F. Return from another main section

1. Movies → Live or Hub → back to Movies.  
2. **Pass:** reopen from SQLite snapshot without forced network; previous category if still valid; no repair loop.

### G. Refresh while detail open

1. Open detail on gen N.  
2. Trigger/wait catalog sync to N+1 (or observe natural refresh).  
3. Close detail.  
4. **Pass:** either preserve N until activate then atomic swap after close, or clearly defined policy; never show N+1 categories with N items; never unmount grid without replacement snapshot.  
5. **Fail:** empty rail mid-detail; mixed generation; scroll restore to wrong index after swap.

---

## 4. Catalog-specific ONN checks (disappear)

| Check | Pass |
|---|---|
| After install-over-update with healthy gen | No permanent “Repairing…”; rail populated |
| During preserving (syncing N+1) | Interactive gens equal; syncingCategoryGeneration may differ in logs only |
| Counts diagnostic | nonzeroCategoryCount === grouped rows > 0; not metadata length |
| Force-close relaunch | Same healthy snapshot; no repair loop |

---

## 5. Log markers to collect (existing)

- `[NovaCast Movies Catalog Readiness]`  
- `[NovaCast Movies Read Snapshot]` / Read Contract / Category Contract  
- `[NovaCast Movies Category Counts]`  
- `[NovaCast Movies Sparse Catalog Repair]`  
- `[NovaCast Movies] atomic_generation_swap_committed`  
- Movies detail focus / viewport restore logs (Stage 3D markers)  
- BackHandler eventType logs in MoviesScreen  

---

## 6. Evidence pack per cycle

1. `traceId`  
2. logcat / metro excerpt filtered by traceId/markers  
3. before/after: categoryId, movieId, offset, generation  
4. pass/fail against scenario criteria  
5. unanswered anomalies listed for engineering

---

## 7. Questions that require ONN (not answerable from code alone)

1. Magnitude of native TV focus auto-align on ONN (px per focus).  
2. Whether BlurView teardown contributes perceptible motion beyond scrollToOffset.  
3. Real frequency of catalog-ready during an open detail session.  
4. Whether repair blanking still occurs after 4.2D/E on devices with gen 6+ healthy.  
5. Exact BackHandler invocation order when player + Movies + toast are mounted together.
