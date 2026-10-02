import { Controller, Delete, Get, HttpCode, ParseIntPipe, Post, Query } from '@nestjs/common'
import { Param } from '@nestjs/common'
import { UserId } from '../common/current-user.decorator'
import { UsersService } from './users.service'

const Id = (name: string) => Param(name, new ParseIntPipe({ errorHttpStatusCode: 404 }))

@Controller()
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('me') me(@UserId() me: number) { return this.users.me(me) }
  @Delete('me') deleteMe(@UserId() me: number) { return this.users.deleteMe(me) }

  @Get('users/search') search(@UserId() me: number, @Query('q') q: string) { return this.users.search(me, q) }
  @Get('following') following(@UserId() me: number) { return this.users.following(me) }

  @HttpCode(200)
  @Post('follows/:userId') follow(@UserId() me: number, @Id('userId') t: number) { return this.users.follow(me, t) }
  @Delete('follows/:userId') unfollow(@UserId() me: number, @Id('userId') t: number) { return this.users.unfollow(me, t) }

  @HttpCode(200)
  @Post('blocks/:userId') block(@UserId() me: number, @Id('userId') t: number) { return this.users.block(me, t) }
  @Delete('blocks/:userId') unblock(@UserId() me: number, @Id('userId') t: number) { return this.users.unblock(me, t) }
}
