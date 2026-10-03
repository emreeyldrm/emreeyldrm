import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { UserId } from '../common/current-user.decorator'
import { MessagesService } from './messages.service'

const Id = () => Param('id', new ParseIntPipe({ errorHttpStatusCode: 404 }))

/** MSG: conversations between friends (short polling, no realtime). Bodies are validated in messages-core. */
@Controller('conversations')
export class MessagesController {
  constructor(private messages: MessagesService) {}

  @Get() list(@UserId() me: number) { return this.messages.list(me) }
  @Get('unread') unread(@UserId() me: number) { return this.messages.unread(me) }
  @Post()
  async open(@UserId() me: number, @Body() body: any, @Res({ passthrough: true }) res: Response) {
    const [status, out] = await this.messages.open(me, body)
    res.status(status)
    return out
  }
  @Get(':id') get(@UserId() me: number, @Id() id: number) { return this.messages.get(me, id) }
  @Get(':id/messages') history(@UserId() me: number, @Id() id: number, @Query('after') after?: string, @Query('limit') limit?: string) {
    return this.messages.messages(me, id, after, limit)
  }
  @Post(':id/messages') send(@UserId() me: number, @Id() id: number, @Body() body: any) { return this.messages.send(me, id, body) }
  @HttpCode(200)
  @Post(':id/read') read(@UserId() me: number, @Id() id: number) { return this.messages.read(me, id) }
}
