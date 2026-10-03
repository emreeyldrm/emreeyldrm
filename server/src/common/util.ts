import { resolveNow } from '../discover/discover-core'

export const now = () => new Date().toISOString()

/**
 * Request clock for TRD signals and the 7-day window: the X-Test-Now header is honoured ONLY when the env var
 * E2E_TEST_HOOKS=1 (start:e2e script and Jest setup); production never sets it, so the header is ignored there.
 */
export const requestNow = (header: string | undefined): Date => resolveNow(header, process.env.E2E_TEST_HOOKS)

export const CATEGORIES = ['food', 'coffee', 'bar', 'historic', 'museum', 'park', 'beach', 'hotel', 'airport', 'other']

/** SQL predicate: a block exists in either direction between two SQL expressions. */
export const blockedBetween = (a: string, b: string) =>
  `EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = ${a} AND bk.blocked_id = ${b})
                                      OR (bk.blocker_id = ${b} AND bk.blocked_id = ${a}))`

export const bool = (v: unknown) => v === 1 || v === true

/**
 * Runs raw SQL. better-sqlite3 does not accept repeated numbered parameters (?1 used twice) from an array,
 * so `?N` placeholders are expanded into plain `?` with the parameter list rebuilt in order of appearance.
 */
export function q(runner: { query(sql: string, params?: any[]): Promise<any> }, sql: string, params: any[] = []): Promise<any[]> {
  const out: any[] = []
  const text = sql.replace(/\?(\d+)/g, (_m, n) => { out.push(params[Number(n) - 1]); return '?' })
  return runner.query(text, out.length ? out : params)
}
