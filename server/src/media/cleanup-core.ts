// Daily cleanup of unreferenced media (docs/ACCEPTANCE.md, AC-MED-1).
//
// THIS FILE IS SHARED VERBATIM between server/src/media/cleanup-core.ts (NestJS) and
// backend/src/cleanup-core.ts (Cloudflare Worker). Edit one, then copy it over the other:
//   cp server/src/media/cleanup-core.ts backend/src/cleanup-core.ts
// server/test/unit/cleanup-core.spec.ts fails if the two copies differ.
//
// Pure values and functions only: no framework, database or runtime dependencies.

/** Media younger than this is never removed (an upload may be about to be attached to an item or comment). */
export const MEDIA_RETENTION_MS = 24 * 60 * 60 * 1000
/** Rows deleted per statement; the job loops until a batch comes back short. */
export const CLEANUP_BATCH = 500
/** Worker Cron Trigger (backend/wrangler.toml) and the NestJS timer: every day at 03:17 UTC. */
export const CLEANUP_CRON = '17 3 * * *'
export const CLEANUP_HOUR_UTC = 3
export const CLEANUP_MINUTE_UTC = 17

/** Media created before this instant may be removed. */
export const cleanupCutoff = (now: Date): string => new Date(now.getTime() - MEDIA_RETENTION_MS).toISOString()

/**
 * Deletes (and returns the ids of) at most ?2 media rows created before ?1 that no list item (`details.photos`) and
 * no comment (`photos`) references. The condition is evaluated in the DELETE itself, so a photo attached between
 * listing and deleting is kept. The Worker then removes the returned ids from R2.
 */
export const DELETE_UNREFERENCED_MEDIA_SQL = `DELETE FROM media WHERE id IN (
     SELECT m.id FROM media m
     WHERE m.created_at < ?1
       AND NOT EXISTS (SELECT 1 FROM list_items i, json_each(i.details, '$.photos') p WHERE p.value = m.id)
       AND NOT EXISTS (SELECT 1 FROM comments c, json_each(c.photos) p WHERE p.value = m.id)
     LIMIT ?2)
   RETURNING id`

/** Test-only endpoints (POST /test/media-cleanup) exist only when E2E_TEST_HOOKS is exactly '1'. */
export const testHooksEnabled = (env: string | null | undefined): boolean => env === '1'

/** Milliseconds from `now` until the next daily run at hh:mm UTC (NestJS timer; never 0). */
export function msUntilNextRun(now: Date, hour = CLEANUP_HOUR_UTC, minute = CLEANUP_MINUTE_UTC): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute))
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime() - now.getTime()
}
