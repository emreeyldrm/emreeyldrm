import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common'
import { UserId } from '../common/current-user.decorator'
import { CreateListDto, ReplaceItemsDto, UpdateListDto } from './lists.dto'
import { ListsService } from './lists.service'

const Id = () => Param('id', new ParseIntPipe({ errorHttpStatusCode: 404 }))

@Controller('lists')
export class ListsController {
  constructor(private lists: ListsService) {}

  @Get('mine') mine(@UserId() me: number) { return this.lists.mine(me) }
  @Post() create(@UserId() me: number, @Body() dto: CreateListDto) { return this.lists.create(me, dto) }
  @Get(':id') get(@UserId() me: number, @Id() id: number) { return this.lists.get(me, id) }
  @Patch(':id') update(@UserId() me: number, @Id() id: number, @Body() dto: UpdateListDto) { return this.lists.update(me, id, dto) }
  @Delete(':id') remove(@UserId() me: number, @Id() id: number) { return this.lists.remove(me, id) }
  @Put(':id/items') items(@UserId() me: number, @Id() id: number, @Body() dto: ReplaceItemsDto) { return this.lists.replaceItems(me, id, dto) }
}
