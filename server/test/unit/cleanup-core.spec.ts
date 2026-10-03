import { NotFoundException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CLEANUP_CRON, CLEANUP_HOUR_UTC, CLEANUP_MINUTE_UTC, cleanupCutoff, DELETE_UNREFERENCED_MEDIA_SQL, msUntilNextRun,
  testHooksEnabled,
} from '../../src/media/cleanup-core'
import { MediaCleanupScheduler, MediaCleanupTestController } from '../../src/media/media-cleanup'

const root = join(__dirname, '..', '..', '..')

describe('cleanup-core (AC-MED-1)', () => {
  it('is byte-identical in server/ (NestJS) and backend/ (Worker)', () => {
    const nest = readFileSync(join(root, 'server', 'src', 'media', 'cleanup-core.ts'), 'utf8')
    const worker = readFileSync(join(root, 'backend', 'src', 'cleanup-core.ts'), 'utf8')
    expect(worker).toBe(nest)
  })

  it('cutoff is 24 hours before now', () => {
    expect(cleanupCutoff(new Date('2026-10-03T12:00:00.000Z'))).toBe('2026-10-02T12:00:00.000Z')
  })

  it('the SQL keeps media referenced by list item details or comments', () => {
    expect(DELETE_UNREFERENCED_MEDIA_SQL).toMatch(/json_each\(i\.details, '\$\.photos'\)/)
    expect(DELETE_UNREFERENCED_MEDIA_SQL).toMatch(/json_each\(c\.photos\)/)
    expect(DELETE_UNREFERENCED_MEDIA_SQL).toMatch(/created_at < \?1/)
    expect(DELETE_UNREFERENCED_MEDIA_SQL).toMatch(/RETURNING id/)
  })

  it('next daily run at 03:17 UTC', () => {
    expect(CLEANUP_CRON).toBe(`${CLEANUP_MINUTE_UTC} ${CLEANUP_HOUR_UTC} * * *`)
    expect(msUntilNextRun(new Date('2026-10-03T03:00:00.000Z'))).toBe(17 * 60_000)
    expect(msUntilNextRun(new Date('2026-10-03T03:17:00.000Z'))).toBe(24 * 3600_000)
    expect(msUntilNextRun(new Date('2026-10-03T23:17:00.000Z'))).toBe(4 * 3600_000)
    expect(msUntilNextRun(new Date('2026-12-31T04:00:00.000Z'))).toBe(23 * 3600_000 + 17 * 60_000)
  })

  it('test hooks are on only for exactly "1"', () => {
    expect(testHooksEnabled('1')).toBe(true)
    for (const v of [undefined, null, '', '0', 'true', ' 1']) expect(testHooksEnabled(v)).toBe(false)
  })

  it('NestJS: POST /test/media-cleanup is 404 without E2E_TEST_HOOKS=1 and never runs the job', async () => {
    const saved = process.env.E2E_TEST_HOOKS
    const run = jest.fn(async () => 3)
    const ctrl = new MediaCleanupTestController({ run } as any)
    try {
      for (const v of [undefined, '0', 'true']) {
        if (v === undefined) delete process.env.E2E_TEST_HOOKS
        else process.env.E2E_TEST_HOOKS = v
        await expect(ctrl.trigger()).rejects.toBeInstanceOf(NotFoundException)
      }
      expect(run).not.toHaveBeenCalled()
      process.env.E2E_TEST_HOOKS = '1'
      await expect(ctrl.trigger()).resolves.toEqual({ ok: true, deleted: 3 })
    } finally {
      if (saved === undefined) delete process.env.E2E_TEST_HOOKS
      else process.env.E2E_TEST_HOOKS = saved
    }
  })

  it('NestJS: the daily timer is on unless MEDIA_CLEANUP_DISABLED=1', () => {
    expect(MediaCleanupScheduler.enabled({})).toBe(true)
    expect(MediaCleanupScheduler.enabled({ MEDIA_CLEANUP_DISABLED: '1' })).toBe(false)
  })

  it('Worker wiring: cron trigger in wrangler.toml, scheduled handler, and the test endpoint gated by E2E_TEST_HOOKS', () => {
    const toml = readFileSync(join(root, 'backend', 'wrangler.toml'), 'utf8')
    expect(toml).toMatch(new RegExp(`\\[triggers\\]\\s*\\ncrons = \\["${CLEANUP_CRON.replace(/\*/g, '\\*')}"\\]`))
    expect(toml).not.toMatch(/E2E_TEST_HOOKS/)
    const index = readFileSync(join(root, 'backend', 'src', 'index.ts'), 'utf8')
    expect(index).toMatch(/async scheduled\(event: ScheduledController, env: Env, ctx: ExecutionContext\)/)
    expect(index).toMatch(/app\.post\('\/test\/media-cleanup', async \(c\) => \{\n\s+if \(!testHooksEnabled\(c\.env\.E2E_TEST_HOOKS\)\) return fail\(404/)
    // deploy.sh only rewrites database_id, so the trigger reaches wrangler.production.toml unchanged.
    expect(readFileSync(join(root, 'scripts', 'deploy.sh'), 'utf8')).toMatch(/sed "s\/\^database_id = \.\*\//)
  })
})
