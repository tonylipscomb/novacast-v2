
def patch_catalog_repository() -> None:
    path = ROOT / "src/features/catalog/catalogRepository.ts"
    text = path.read_text(encoding="utf-8")

    resolver = """
export async function resolveReadableCategoryGeneration(
  providerId: string,
  mediaType: CatalogMediaType,
): Promise<number> {
  const db = await getCatalogDatabase();
  const categoriesTable = catalogCategoriesTable(mediaType);
  const state = await getCatalogSyncState(providerId, mediaType);
  const provider = await getCatalogProvider(providerId);
  const currentAttemptGeneration = state?.generation ?? 0;
  const currentStatus = state?.status ?? null;
  const lastCompletedGeneration = provider?.catalogGeneration ?? 0;

  const countValidCategoryRows = async (generation: number) => {
    if (generation <= 0) {
      return 0;
    }
    const row = await db.getFirst<{ row_count: number | string }>(
      `SELECT COUNT(*) AS row_count
       FROM ${categoriesTable}
       WHERE provider_id = ? AND media_type = ? AND sync_generation = ?
         AND TRIM(COALESCE(category_id, '')) != ''
         AND TRIM(COALESCE(category_name, '')) != ''`,
      [providerId, mediaType, generation],
    );
    return asNumber(row?.row_count);
  };

  let resolvedCategoryGeneration = 0;
  let categoryRowCount = 0;
  let reason:
    | 'current-sync-category-generation'
    | 'completed-category-generation'
    | 'no-readable-category-generation' = 'no-readable-category-generation';

  if (currentAttemptGeneration > 0) {
    const rows = await countValidCategoryRows(currentAttemptGeneration);
    if (rows > 0) {
      resolvedCategoryGeneration = currentAttemptGeneration;
      categoryRowCount = rows;
      reason = 'current-sync-category-generation';
    }
  }

  if (reason === 'no-readable-category-generation' && lastCompletedGeneration > 0) {
    const rows = await countValidCategoryRows(lastCompletedGeneration);
    if (rows > 0) {
      resolvedCategoryGeneration = lastCompletedGeneration;
      categoryRowCount = rows;
      reason = 'completed-category-generation';
    }
  }

  if (reason === 'no-readable-category-generation') {
    const row = await db.getFirst<{ sync_generation: number | string; row_count: number | string }>(
      `SELECT sync_generation, COUNT(*) AS row_count
       FROM ${categoriesTable}
       WHERE provider_id = ? AND media_type = ?
         AND TRIM(COALESCE(category_id, '')) != ''
         AND TRIM(COALESCE(category_name, '')) != ''
       GROUP BY sync_generation
       ORDER BY sync_generation DESC
       LIMIT 1`,
      [providerId, mediaType],
    );
    const newestGeneration = asNumber(row?.sync_generation);
    const rows = asNumber(row?.row_count);
    if (newestGeneration > 0 && rows > 0) {
      resolvedCategoryGeneration = newestGeneration;
      categoryRowCount = rows;
      reason = 'completed-category-generation';
    }
  }

  console.info(
    '[NovaCast Category Read Generation] ' +
      JSON.stringify({
        providerId,
        mediaType,
        currentAttemptGeneration,
        currentStatus,
        lastCompletedGeneration,
        resolvedCategoryGeneration,
        categoryRowCount,
        reason,
      }),
  );

  return resolvedCategoryGeneration;
}

"""

    marker = "const resolveActiveGeneration = resolveReadableCatalogGeneration;"
    must_contain(text, marker, "catalogRepository")
    if "resolveReadableCategoryGeneration" not in text:
        text = text.replace(marker, resolver + marker, 1)
        print("inserted resolveReadableCategoryGeneration")
    else:
        print("resolveReadableCategoryGeneration already present")

    old_sig = """export async function getCatalogCategoryCounts(
  providerId: string,
  mediaType: CatalogMediaType,
  options?: { generation?: number },
): Promise<Array<{ categoryId: string; categoryName: string; itemCount: number; sortOrder: number | null }>> {
  const db = await getCatalogDatabase();
  const generation = options?.generation ?? (await resolveActiveGeneration(providerId, mediaType));
  if (generation <= 0) {
    return [];
  }"""
    new_sig = """export async function getCatalogCategoryCounts(
  providerId: string,
  mediaType: CatalogMediaType,
  options?: { generation?: number; includeZeroCountCategories?: boolean },
): Promise<Array<{ categoryId: string; categoryName: string; itemCount: number; sortOrder: number | null }>> {
  const db = await getCatalogDatabase();
  const generation = options?.generation ?? (await resolveActiveGeneration(providerId, mediaType));
  const includeZeroCountCategories = Boolean(options?.includeZeroCountCategories);
  if (generation <= 0) {
    return [];
  }"""
    if "includeZeroCountCategories" not in text:
        must_contain(text, old_sig, "getCatalogCategoryCounts sig")
        text = text.replace(old_sig, new_sig, 1)
    else:
        print("includeZeroCountCategories already in options")

    old_filter = """    // Stage 3C.2: production browse only lists categories that can load posters.
    // Collapsed metadata-all fallback was diagnostic-only and is no longer applied.
    const merged = mapped.filter((row) => row.itemCount > 0);"""
    new_filter = """    // Category-rail readiness may include zero-count rows while items are still syncing.
    // Item pages remain gated by resolveReadableCatalogGeneration separately.
    const merged = includeZeroCountCategories
      ? mapped.filter((row) => row.categoryId.trim() && row.categoryName.trim())
      : mapped.filter((row) => row.itemCount > 0);"""
    if "includeZeroCountCategories\n      ? mapped.filter" not in text:
        must_contain(text, old_filter, "category counts filter")
        text = text.replace(old_filter, new_filter, 1)

    old_reason = """          reason: looksCollapsed
            ? 'grouped-items-v2-collapsed-diagnostic'
            : 'grouped-items-v2-merge',"""
    new_reason = """          reason: looksCollapsed
            ? 'grouped-items-v2-collapsed-diagnostic'
            : includeZeroCountCategories
              ? 'grouped-items-v2-metadata-including-zero'
              : 'grouped-items-v2-merge',"""
    if "grouped-items-v2-metadata-including-zero" not in text:
        must_contain(text, old_reason, "category counts reason")
        text = text.replace(old_reason, new_reason, 1)

    atomic_write(path, text)
