import {
  Controller, Headers, HttpCode, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy, Post,
} from '@nestjs/common'
import { DataSource } from 'typeorm'
import { q, requestNow } from '../common/util'
import { TEST_NOW_HEADER } from '../discover/discover-core'
import {
  CLEANUP_BATCH, cleanupCutoff, DELETE_UNREFERENCED_MEDIA_SQL, msUntilNextRun, testHooksEnabled,
} from './cleanup-core'

/**
 * AC-MED-1: removes media that no list item and no comment references and that is older than 24 hours.
 * The SQL lives in cleanup-core.ts (identical copy in backend/, where a Cron Trigger runs it and also deletes R2 objects;
 * here the bytes are in the row).
 */
@Injectable()
export class MediaCleanupService {
  constructor(private db: DataSource) {}

  async run(at: Date = new Date()): Promise<number> {
    const cutoff = cleanupCutoff(at)
    let deleted = 0
    for (;;) {
      const rows = await q(this.db, DELETE_UNREFERENCED_MEDIA_SQL, [cutoff, CLEANUP_BATCH])
      deleted += rows.length
      if (rows.length < CLEANUP_BATCH) return deleted
    }
  }
}

/**
 * Daily timer (03:17 UTC, like the Worker's cron). Off when MEDIA_CLEANUP_DISABLED=1 (Jest sets it in
 * test/setup-env.ts); tests trigger the job through POST /test/media-cleanup instead.
 */
@Injectable()
export class MediaCleanupScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null
  private readonly log = new Logger('MediaCleanup')

  constructor(private cleanup: MediaCleanupService) {}

  static enabled(env: NodeJS.ProcessEnv = process.env) { return env.MEDIA_CLEANUP_DISABLED !== '1' }

  onApplicationBootstrap() {
    if (MediaCleanupScheduler.enabled()) this.schedule()
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule() {
    this.timer = setTimeout(async () => {
      try {
        const n = await this.cleanup.run()
        if (n) this.log.log(`${n} kullanılmayan fotoğraf silindi`)
      } catch (e) {
        this.log.error(e)
      }
      this.schedule()
    }, msUntilNextRun(new Date()))
    this.timer.unref()
  }
}

/** Test-only trigger: exists only when E2E_TEST_HOOKS=1 (Jest, start:e2e); 404 like an unknown route otherwise. */
@Controller('test')
export class MediaCleanupTestController {
  constructor(private cleanup: MediaCleanupService) {}

  @Post('media-cleanup')
  @HttpCode(200)
  async trigger(@Headers(TEST_NOW_HEADER) testNow?: string) {
    if (!testHooksEnabled(process.env.E2E_TEST_HOOKS)) throw new NotFoundException('Bulunamadı')
    return { ok: true, deleted: await this.cleanup.run(requestNow(testNow)) }
  }
}
