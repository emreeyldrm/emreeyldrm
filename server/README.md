# Voyage server

NestJS 10 + TypeORM + better-sqlite3 backend. The API contract and acceptance criteria live in `../docs/ACCEPTANCE.md`.

## Run

```bash
npm install
npm run start:dev      # watch mode, http://localhost:3000, DB file ./voyage.sqlite
npm run build && npm start
npm run start:e2e      # build + PORT=3100 with an in-memory DB (used by the web Playwright suite)
npm run test:e2e       # Jest + supertest against the real AppModule, in-memory DB per spec file
```

Environment: `PORT` (default 3000), `DB_PATH` (default `voyage.sqlite`, `:memory:` for a throwaway DB),
`JWT_SECRET` (set it outside development).

## Layout

`src/auth` (register/login, JWT), `src/users` (me, search, follows, blocks), `src/lists`, `src/places`
(places, ratings, comments), `src/reports`, `src/discover`. `src/common` holds the global auth guard
(everything except `/auth/*` needs a Bearer token), the `{ "error": "..." }` exception filter and SQL helpers.
Schema comes from the entities in `src/database/entities.ts` (`synchronize: true`, foreign keys with
`ON DELETE CASCADE`, so `DELETE /me` removes all of a user's data).
