import { Module } from '@nestjs/common'
import { CommentsController, PlacesController } from './places.controller'
import { PlacesService } from './places.service'

@Module({ controllers: [PlacesController, CommentsController], providers: [PlacesService] })
export class PlacesModule {}
