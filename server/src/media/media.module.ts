import { Module } from '@nestjs/common'
import { MediaController } from './media.controller'
import { MediaCleanupScheduler, MediaCleanupService, MediaCleanupTestController } from './media-cleanup'

@Module({
  controllers: [MediaController, MediaCleanupTestController],
  providers: [MediaCleanupService, MediaCleanupScheduler],
})
export class MediaModule {}
