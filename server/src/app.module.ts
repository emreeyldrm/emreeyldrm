import { Module, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ENTITIES } from './database/entities'
import { AllExceptionsFilter } from './common/all-exceptions.filter'
import { AuthGuard } from './common/auth.guard'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { ListsModule } from './lists/lists.module'
import { PlacesModule } from './places/places.module'
import { ReportsModule } from './reports/reports.module'
import { DiscoverModule } from './discover/discover.module'
import { SearchModule } from './search/search.module'
import { MediaModule } from './media/media.module'

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'better-sqlite3' as const,
        database: process.env.DB_PATH || 'voyage.sqlite',
        entities: ENTITIES,
        synchronize: true,
        // better-sqlite3 driver already runs PRAGMA foreign_keys = ON; stated explicitly for clarity.
        prepareDatabase: (db: any) => db.pragma('foreign_keys = ON'),
      }),
    }),
    AuthModule,
    UsersModule,
    ListsModule,
    PlacesModule,
    ReportsModule,
    DiscoverModule,
    SearchModule,
    MediaModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ transform: true, whitelist: true }),
    },
  ],
})
export class AppModule {}
