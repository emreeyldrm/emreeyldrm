# Voyage server

NestJS 10 + TypeORM + better-sqlite3 backend. The API contract and acceptance criteria live in `../docs/ACCEPTANCE.md`.

## Run

```bash
npm install
npm run start:dev      # watch mode, http://localhost:3000, DB file ./voyage.sqlite
npm run build && npm start
npm run start:e2e      # build + PORT=3100 with an in-memory DB (used by the web Playwright suite)
npm run test:e2e       # Jest + supertest against the real AppModule, in-memory DB per spec file
npm run test:unit      # pure unit tests (search provider parsing, category mapping, details, trend scoring)
```

Environment: `PORT` (default 3000), `DB_PATH` (default `voyage.sqlite`, `:memory:` for a throwaway DB),
`JWT_SECRET` (set it outside development), `GOOGLE_PLACES_API_KEY` (optional: place search via Google Places;
otherwise Photon/OpenStreetMap), `SEARCH_PROVIDER` (`photon` | `google` | `fake`; tests and `start:e2e` use `fake`),
`E2E_TEST_HOOKS` (test only: `1` makes the `X-Test-Now` request header move the clock for Discover trend signals and
the 7-day window; set by `start:e2e` and `test/setup-env.ts`, never in production — without it the header is ignored).

## Layout

`src/auth` (register/login, JWT), `src/users` (me, search, follows, blocks), `src/lists`, `src/places`
(places, ratings, comments; `GET /places/:id` records a view; `POST /places/resolve` find-or-creates a provider place), `src/reports`, `src/discover` (`/discover/lists`,
`/discover/home` weekly trends; ranking in `discover-core.ts`, shared verbatim with `backend/src/discover-core.ts`), `src/search` (`GET /search/places`, `GET /search/nearby`; `search-core.ts`
is shared verbatim with `backend/src/search-core.ts`), `src/media` (`POST /media` raw image upload stored as a
BLOB, public `GET /media/:id`). Place details / comment photo validation lives in `src/lists/details-core.ts`, shared
verbatim with `backend/src/details-core.ts`. `src/common` holds the global auth guard
(everything except `/auth/*` and `GET /media/:id` needs a Bearer token), the `{ "error": "..." }` exception filter and SQL helpers.
Schema comes from the entities in `src/database/entities.ts` (`synchronize: true`, foreign keys with
`ON DELETE CASCADE`, so `DELETE /me` removes all of a user's data).
