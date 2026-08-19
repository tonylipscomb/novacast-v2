# Movies & TV Back Navigation — Executive Summary

**Branch:** `audit-movies-navigation-architecture-20260804`  
**Date:** 2026-08-04  
**Type:** Investigation only — documentation under `docs/audits/`. No production code modified in this audit pass.

Companion docs:

- `MOVIES_DATA_FLOW_AUDIT.md`  
- `MOVIES_STATE_OWNERSHIP_AUDIT.md`  
- `MOVIES_RENDER_LIFECYCLE_AUDIT.md`  
- `TV_BACK_HANDLER_AUDIT.md`  
- `MOVIES_TARGET_ARCHITECTURE.md`  
- `ONN_MOVIES_BACK_TRACE_PLAN.md`

---

## 1. Top five root causes

1. **Multiple competing authorities for “what is the Movies catalog”**  
   Syncing category metadata, readable item generation, active provider generation, count indexes, lastValid cache, and React state can disagree. Interactive UI historically mixed them; Stage 4.2E pins reads, but events and diagnostics still couple the layers.

2. **Empty `categories` unmounts `MoviePosterGrid`**  
   Repair, readiness waiting, and error paths set `categories=[]`. The screen gates the grid on `categories.length > 0`, so recovery logic does not “show empty posters” — it **removes the grid**. That reads as “movies disappeared.”

3. **Recovery logic stacked on recovery logic (Stage 3→4)**  
   Readiness barriers, sparse repair, capability/full-dump, distribution validation, zero-count filtering, and atomic swap each mutate selection, loadStatus, and reload triggers. A fix in one layer invalidates assumptions in another.

4. **Movies Back/detail close is a unique Stage 3D scroll+focus machine**  
   Normal close intentionally calls `scrollToOffset` and may issue a corrective scroll after native TV focus alignment. Series/Search close instantly. Users perceive Movies as “broken Back” relative to other sections.

5. **No shared TV Back coordinator**  
   ~15 independent `hardwareBackPress` listeners with bespoke priority stacks. Playback, detail, search, overlays, and exit confirm race by mount order and local conditions.

---

## 2. Why Movies regress after unrelated passes

| Mechanism | How an “unrelated” pass breaks Movies |
|---|---|
| Shared validation / repair thresholds | Tightening sparse rules blanks an active gen via repair → empty categories → grid unmount |
| Sync event fanout | `movie-categories-updated` still calls `loadCategories`; any change to write timing reshuffles UI |
| Selection resolvers | Zero-filter / first-populated / memory restore change which category loads; looks like data loss |
| Effect dependency churn | Model effects reload pages when categories/selection/status shift |
| Generation activation | New complete/ready path replaces rail+page; preserves badly if snapshot missing |
| Detail/Back entanglement | Focus restore + catalog reload concurrency produces scroll or empty flashes |

Movies is not a closed module: catalog sync, SQLite writer, readiness, repair, smart wrap, and screen orchestration share one unstable contract.

---

## 3. Why detail close visibly scrolls

Code-intended behavior, not accidental remount:

1. On close, phase `closing-viewport` **always** issues `scrollToOffset` to the saved snapshot offset (even if already near-stable).  
2. After focusing the poster, Android TV may auto-align ~one row; Movies detects drift (≤140px) and may run a **corrective** `scrollToOffset` (max 2).  
3. Overlay/Blur teardown can add perceived motion.

`MoviePosterGrid` is designed **not** to remount on detail close. Slight scroll is the restore policy.

---

## 4. Why Back differs by section

| Section | Detail / overlay close | Search order | Viewport restore |
|---|---|---|---|
| Movies | Stage 3D multi-phase | Detail before search | Yes |
| Series | Instant close + focus | Search before detail | No |
| Live | Fullscreen model | Overlay owns search Back | Fullscreen-specific |
| Search | Instant detail close | Is the search UI | Local |

There is no shared priority layer API — each screen invents Back.

---

## 5. Recommended catalog architecture

- Background sync into immutable generation N+1.  
- Single **active catalog snapshot** `{generation, categories, counts, total}` as the only interactive authority.  
- Preserve previous snapshot while refreshing; activate transactionally.  
- Nonzero rail from active item rows only.  
- Page queries pinned to snapshot generation.  
- Repair bounded; **do not blank a healthy snapshot** while waiting for a replacement (except true first-install).  
- Demote `movie-categories-updated` from interactive reload.

Details: `MOVIES_TARGET_ARCHITECTURE.md`.

---

## 6. Recommended Back architecture

Central `useTvBackLayer({ id, priority, enabled, onBack })` with priorities:

`critical-modal > player > detail > search/filter > nested > route > exit`

- One consumer per Back press.  
- Overlays close without route changes.  
- Focus restoration owned by the closing layer.  
- Normal Movies detail close = hide overlay + focus mounted card (**no scroll**).  
- Exceptional scroll only if virtualization removed the card or snapshot invalidated.

Details: `TV_BACK_HANDLER_AUDIT.md`.

---

## 7. Components to simplify / remove

| Simplify / extract | From |
|---|---|
| `MoviesCatalogSnapshotStore` | readiness + lastValid + repair UI + read snapshot |
| `MoviesBrowseController` | bulk of `useMoviesScreenModel` |
| `MovieDetailLayer` (focus policy) | Stage 3D machine in `MoviesScreen` |
| `TvBackDispatcher` | all per-screen BackHandlers |
| Stop grid unmount on repair when snapshot exists | `MoviesScreen` categories gate policy |
| Demote count-index merge complexity | model + SmartMovieDataSource |

Keep: SQLite v2 schema, native decode, capability/full-dump ingest, poster/detail visuals, unified player.

---

## 8. Ordered remediation phases

| Phase | Focus | Risk |
|---|---|---|
| **P0** | Snapshot store; never blank healthy rail during sync/repair | Medium |
| **P1** | Categories-updated ≠ interactive reload | Low–medium |
| **P2** | Snapshot-return detail close (no normal scroll) | Medium (TV focus) |
| **P3** | Shared TvBackDispatcher | Medium (app-wide) |
| **P4** | Thin MoviesScreen / model; services own sync UI orchestration | Higher |
| **P5** | Delete obsolete recovery branches after soak | Low after P0–P2 |

---

## 9. Risk level of each phase

| Phase | Risk | Notes |
|---|---|---|
| P0 | Medium | Fixes disappearances; must not strand first-install |
| P1 | Low–medium | Event semantics; easy to miss a subscriber |
| P2 | Medium | ONN focus quirks; needs device trace |
| P3 | Medium | Cross-feature Back regressions |
| P4 | High | Large move; do only after P0–P3 stable |
| P5 | Low | Cleanup |

---

## 10. Tests needed before implementation

- Preserving snapshot while N+1 syncs (no N+1 interactive categories).  
- Activation atomicity (no mixed generation render).  
- Repair with healthy previous keeps rail; without previous shows repairing.  
- Detail close: zero `scrollToOffset` when target mounted; focus id stable.  
- Detail close fallback when cell virtualized away.  
- Back dispatcher single-consumer + playback precedence.  
- Series/Live/Search Back golden orders unchanged.  
- Retain stage4 readiness / stage4e pinning / stage3d1 contracts as baselines.

---

## Baseline tests run (this audit)

```text
node --test scripts/movies-stage4-category-readiness.test.mjs
node --test scripts/movies-stage4e-atomic-generation-pinning.test.mjs
node --test scripts/movies-stage3d1-viewport-first-handoff.test.mjs
node --test scripts/movies-category-collapse-repair.test.mjs
node --test scripts/catalog-stage3c-generation-safe.test.mjs
```

**Result:** 61 passed, 0 failed. Failures were not repaired (none observed).

---

## Unanswered questions (need ONN)

1. Native focus auto-align magnitude on ONN.  
2. Whether BlurView teardown adds motion beyond scroll commands.  
3. How often catalog-ready fires during an open detail.  
4. Whether repair still blanks UI on devices that already have a healthy gen 6+.  
5. Exact multi-listener Back order with player + toast + Movies mounted.

---

## Production files changed

**None** in this audit pass. Documentation only under `docs/audits/`.
