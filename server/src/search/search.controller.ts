import { Controller, Get, HttpException, Query } from '@nestjs/common'
import { parseSearchQuery, searchPlaces, SearchError, type FetchLike } from './search-core'

/** GET /search/places?q=&lat=&lon= (docs/ACCEPTANCE.md, SRCH). Provider and its key come from the environment. */
@Controller('search')
export class SearchController {
  @Get('places')
  async places(@Query('q') q: unknown, @Query('lat') lat: unknown, @Query('lon') lon: unknown) {
    try {
      const query = parseSearchQuery(q, lat, lon)
      return await searchPlaces(
        { SEARCH_PROVIDER: process.env.SEARCH_PROVIDER, GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY },
        query,
        fetch as unknown as FetchLike,
      )
    } catch (e) {
      if (e instanceof SearchError) throw new HttpException(e.message, e.status)
      throw e
    }
  }
}
