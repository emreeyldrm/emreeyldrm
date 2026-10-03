import { Body, Controller, Delete, Get, Headers, Param, ParseIntPipe, Patch, Post, Put, Res } from '@nestjs/common'
import type { Response } from 'express'
import { UserId } from '../common/current-user.decorator'
import { AddMemberDto, CreateListDto, ReplaceItemsDto, UpdateListDto } from './lists.dto'
import { ListsService } from './lists.service'
import { requestNow } from '../common/util'
import { TEST_NOW_HEADER } from '../discover/discover-core'

const Id = (name = 'id') => Param(name, new ParseIntPipe({ errorHttpStatusCode: 404 }))

@Controller('lists')
export class ListsController {
  constructor(private lists: ListsService) {}

  @Get('mine') mine(@UserId() me: number) { return this.lists.mine(me) }
  @Post() create(@UserId() me: number, @Body() dto: CreateListDto) { return this.lists.create(me, dto) }
  @Get(':id') get(@UserId() me: number, @Id() id: number) { return this.lists.get(me, id) }
  @Patch(':id') update(@UserId() me: number, @Id() id: number, @Body() dto: UpdateListDto) { return this.lists.update(me, id, dto) }
  @Delete(':id') remove(@UserId() me: number, @Id() id: number) { return this.lists.remove(me, id) }
  @Put(':id/items') items(@UserId() me: number, @Id() id: number, @Body() dto: ReplaceItemsDto, @Headers(TEST_NOW_HEADER) testNow?: string) {
    return this.lists.replaceItems(me, id, dto, requestNow(testNow))
  }
  @Post(':id/copy') copy(@UserId() me: number, @Id() id: number, @Headers(TEST_NOW_HEADER) testNow?: string) {
    return this.lists.copy(me, id, requestNow(testNow))
  }
  @Get(':id/members') members(@UserId() me: number, @Id() id: number) { return this.lists.members(me, id) }
  @Post(':id/members')
  async addMember(@UserId() me: number, @Id() id: number, @Body() dto: AddMemberDto, @Res({ passthrough: true }) res: Response) {
    const [status, member] = await this.lists.addMember(me, id, dto)
    res.status(status)
    return member
  }
  @Delete(':id/members/:userId') removeMember(@UserId() me: number, @Id() id: number, @Id('userId') userId: number) {
    return this.lists.removeMember(me, id, userId)
  }
}
