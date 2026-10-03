import { Controller, Get, HttpException, Query } from '@nestjs/common'
import { parseNearbyQuery, parseSearchQuery, searchNearby, searchPlaces, SearchError, type FetchLike } from './search-core'

const env = () => ({ SEARCH_PROVIDER: process.env.SEARCH_PROVIDER, GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY })

/** GET /search/places?q=&lat=&lon=&lang= (docs/ACCEPTANCE.md, SRCH). Provider and its key come from the environment. */
@Controller('search')
export class SearchController {
  @Get('places')
  async places(@Query('q') q: unknown, @Query('lat') lat: unknown, @Query('lon') lon: unknown, @Query('lang') lang: unknown) {
    try {
      const query = parseSearchQuery(q, lat, lon, lang)
      return await searchPlaces(
        env(),
        query,
        fetch as unknown as FetchLike,
      )
    } catch (e) {
      if (e instanceof SearchError) throw new HttpException(e.message, e.status)
      throw e
    }
  }

  /** GET /search/nearby?lat=&lon=&lang= (TAP): named places around a tapped map point, nearest first. */
  @Get('nearby')
  async nearby(@Query('lat') lat: unknown, @Query('lon') lon: unknown, @Query('lang') lang: unknown) {
    try {
      return await searchNearby(env(), parseNearbyQuery(lat, lon, lang), fetch as unknown as FetchLike)
    } catch (e) {
      if (e instanceof SearchError) throw new HttpException(e.message, e.status)
      throw e
    }
  }
}
