import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { UserId } from '../common/current-user.decorator'
import { CreateCommentDto, RatingDto } from './places.dto'
import { PlacesService } from './places.service'

const Id = () => Param('id', new ParseIntPipe({ errorHttpStatusCode: 404 }))

@Controller('places')
export class PlacesController {
  constructor(private places: PlacesService) {}

  @Get(':id') get(@UserId() me: number, @Id() id: number) { return this.places.get(me, id) }
  @Put(':id/rating') rate(@UserId() me: number, @Id() id: number, @Body() dto: RatingDto) { return this.places.rate(me, id, dto.stars) }
  @Get(':id/comments') comments(@UserId() me: number, @Id() id: number) { return this.places.comments(me, id) }
  @Post(':id/comments') addComment(@UserId() me: number, @Id() id: number, @Body() dto: CreateCommentDto) { return this.places.addComment(me, id, dto) }
}

@Controller('comments')
export class CommentsController {
  constructor(private places: PlacesService) {}

  @Delete(':id') remove(@UserId() me: number, @Id() id: number) { return this.places.deleteComment(me, id) }
}
