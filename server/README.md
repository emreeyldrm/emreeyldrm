# Voyage server

NestJS 10 + TypeORM + better-sqlite3 backend. The API contract and acceptance criteria live in `../docs/ACCEPTANCE.md`.

## Run

```bash
npm install
npm run start:dev      # watch mode, http://localhost:3000, DB file ./voyage.sqlite
npm run build && npm start
npm run start:e2e      # build + PORT=3100 with an in-memory DB (used by the web Playwright suite)
npm run test:e2e       # Jest + supertest against the real AppModule, in-memory DB per spec file
npm run test:unit      # pure unit tests (search provider parsing, category mapping)
```

Environment: `PORT` (default 3000), `DB_PATH` (default `voyage.sqlite`, `:memory:` for a throwaway DB),
`JWT_SECRET` (set it outside development), `GOOGLE_PLACES_API_KEY` (optional: place search via Google Places;
otherwise Photon/OpenStreetMap), `SEARCH_PROVIDER` (`photon` | `google` | `fake`; tests and `start:e2e` use `fake`).

## Layout

`src/auth` (register/login, JWT), `src/users` (me, search, follows, blocks), `src/lists`, `src/places`
(places, ratings, comments), `src/reports`, `src/discover`, `src/search` (`GET /search/places`; `search-core.ts`
is shared verbatim with `backend/src/search-core.ts`). `src/common` holds the global auth guard
(everything except `/auth/*` needs a Bearer token), the `{ "error": "..." }` exception filter and SQL helpers.
Schema comes from the entities in `src/database/entities.ts` (`synchronize: true`, foreign keys with
`ON DELETE CASCADE`, so `DELETE /me` removes all of a user's data).
