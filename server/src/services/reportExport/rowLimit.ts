/**
 * rowLimit.ts — US-07.3-P1 synchronous export row-cap check.
 *
 * The data loader is always called with `limit: maxSyncRows + 1` (see
 * ReportDefinition.loadRows), so it never loads more than that many rows
 * into memory. This function decides, from the already-bounded fetched
 * count, whether the true result set exceeds the synchronous cap — the
 * route rejects with ROW_LIMIT_EXCEEDED rather than silently truncating to
 * `maxSyncRows` rows.
 */

export function exceedsSyncRowLimit(fetchedRowCount: number, maxSyncRows: number): boolean {
  return fetchedRowCount > maxSyncRows;
}
