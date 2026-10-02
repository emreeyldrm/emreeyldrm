# Voyage Web

React 18 + Vite + TypeScript client for the Voyage API (see `../docs/ACCEPTANCE.md`). UI text is Turkish and follows `../docs/design/*.dc.html`.

## Run
```
npm install
VITE_API_URL=http://localhost:3000 npm run dev   # http://localhost:5174 (API default: http://localhost:3000)
npm run typecheck
npm run build
```

## E2E (Playwright, AC-WEB-1..9)
```
npm run e2e
```
`playwright.config.ts` starts the NestJS server (`npm run start:e2e` in `../server`, port 3100, in-memory DB) and a build + `vite preview` on port 5174 with `VITE_API_URL=http://localhost:3100`. Chromium is taken from `PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`). Every test registers its own users with random handles.

## Notes
- Token is stored in `localStorage` (`voyage.token`); a 401 clears it and redirects to `/login`.
- The web client has no map: places are sent with provider `voyage`, providerId `<lowercased name>@<city>`, no lat/lon. `PUT /lists/:id/items` replaces the whole list, so the client always sends the full item list (existing items are rebuilt with the same scheme).
- List visibility supports only `private | public`; "Arkadaşlar" is shown disabled ("Yakında").
