import { Body, Controller, Injectable, Module, Post } from '@nestjs/common'
import { IsIn, IsInt, IsNotEmpty, IsString } from 'class-validator'
import { DataSource } from 'typeorm'
import { UserId } from '../common/current-user.decorator'
import { Report } from '../database/entities'
import { now, q } from '../common/util'

export class CreateReportDto {
  @IsIn(['comment', 'list', 'user']) targetType: 'comment' | 'list' | 'user'
  @IsInt() targetId: number
  @IsString() @IsNotEmpty() reason: string
}

@Injectable()
export class ReportsService {
  constructor(private db: DataSource) {}

  async create(me: number, dto: CreateReportDto) {
    await this.db.getRepository(Report).insert({
      reporterId: me, targetType: dto.targetType, targetId: dto.targetId, reason: dto.reason.slice(0, 500), createdAt: now(),
    })
    // 3 distinct reporters hide a comment from everyone until reviewed.
    if (dto.targetType === 'comment') {
      await q(this.db, 
        `UPDATE comments SET hidden = 1 WHERE id = ?1 AND
           (SELECT COUNT(DISTINCT reporter_id) FROM reports WHERE target_type = 'comment' AND target_id = ?1) >= 3`,
        [dto.targetId])
    }
    return { ok: true }
  }
}

@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Post() create(@UserId() me: number, @Body() dto: CreateReportDto) { return this.reports.create(me, dto) }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
