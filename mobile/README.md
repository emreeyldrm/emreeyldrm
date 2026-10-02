# Voyage Mobile (Expo)

Expo / React Native (TypeScript, expo-router) client for the Voyage contract API
(`docs/ACCEPTANCE.md`, AC-MOB-1..17). The design follows `docs/design/*.dc.html`
(Plus Jakarta Sans, green `#2E7D5B`, orange `#F28C28`, category tint/dark colours from
`Voyage/Models/PlaceCategory.swift`).

```
src/app/                 routes (expo-router)
  login.tsx, register.tsx
  (app)/_layout.tsx      auth guard -> /login
  (app)/(tabs)/          Keşfet · Listelerim · Mesajlar (Yakında) · Profil
  (app)/lists/[id]/      city/list detail (Liste / Harita / Plan), share.tsx, day/[day].tsx
  (app)/places/[id].tsx  rating + comments (Sadece ben / Arkadaşlar / Herkes)
  (app)/friends.tsx      search / follow, "Arkadaş" badge
src/lib/                 api client, auth, token store, plan (nearest neighbour), Google Maps links,
                         usePlaceSearch (debounced GET /search/places)
src/components/          UI kit, maps (*.web.tsx = web fallbacks), place search (PlaceSearch.tsx),
                         add-place sheet, plan view
e2e/                     Playwright specs against the web export
maestro/                 Maestro flows for native simulators/devices
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://localhost:8787` | Contract API base URL (Cloudflare Worker in `backend/`, `wrangler dev` default port). Inlined at build time. |

On a physical device or the Android emulator `localhost` is not your computer: use your LAN IP
(e.g. `EXPO_PUBLIC_API_URL=http://192.168.1.20:8787`) or `http://10.0.2.2:8787` on the Android emulator.

## Place search (AC-MOB-15..17)

The map tab (list detail → Harita) has a floating search bar. Typing (≥ 2 characters, 350 ms debounce)
calls `GET /search/places?q=&lat=&lon=` on the API; results are biased to the map centre (after the
user pans), else the centre of the list's places, else the device's last known location. Picking a
result moves the map there (`animateToRegion`), drops a temporary orange pin and shows a card with
**Listeye ekle** (opens the add sheet pre-filled with name, category and location) and
**Google Maps'te aç**. The add sheet's name field shows the same suggestions; map tap and
"Konumumu kullan" remain as alternatives, and manual entry works when there are no results or the
provider fails ("Sonuç yok" / "Arama şu an yapılamıyor").

Places saved from search keep the provider identity (`provider` = `google` | `osm` | `fake`,
`providerId`). Because `PUT /lists/:id/items` replaces the whole list, the client re-sends each
item's `provider`/`providerId` as returned by `GET /lists/:id`.

The app never sees a provider key: the API chooses the provider (Photon by default, Google Places
when `GOOGLE_PLACES_API_KEY` is set on the server — see `docs/TOPLULUK.md`). The e2e servers run
with `SEARCH_PROVIDER=fake` (fixed places in Roma, İstanbul, …; the query `__fail__` simulates a
provider error).

The session token is stored with `expo-secure-store` (Keychain / Keystore) on native and in
`localStorage` on web. The day plan (AC-MOB-12) is stored per list on the device with AsyncStorage.

## Run

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<your-ip>:8787 npx expo start
```

- **Expo Go**: scan the QR code. Everything used here (expo-router, expo-location, expo-secure-store,
  react-native-maps, react-native-svg, AsyncStorage) ships in Expo Go.
- **Development build** (recommended for Maestro and store builds): `npx expo run:ios` / `npx expo run:android`
  (or `eas build --profile development`). Bundle id / package: `app.voyage.mobile`.
  Android release builds need a Google Maps API key for react-native-maps
  (`android.config.googleMaps.apiKey` in `app.json`); iOS uses Apple Maps.
- **Web**: `npx expo start --web`. react-native-maps has no web support, so the map screens use
  `*.web.tsx` fallbacks (an accessible list of pins with coordinates; coordinates are typed in to pick a location).

Backends: `cd backend && npm run dev` (Worker, port 8787) or the NestJS reference server
`cd server && npm run start:dev` (port 3000).

## Checks

```bash
npm run typecheck                 # tsc (app) + tsc (e2e)
npx expo export --platform web    # web build
npx expo-doctor
```

## End-to-end tests (Playwright, web export)

```bash
npm run e2e                 # API = NestJS (../server, npm run start:e2e, port 3100)
npm run e2e:workers         # API = Worker  (../backend, npm run start:e2e, port 8790)
```

`playwright.config.ts` starts the API and builds the web export with the matching
`EXPO_PUBLIC_API_URL` into `web-build/`, served on port 5175. Servers are reused if already
running — stop the static server on 5175 when switching between `e2e` and `e2e:workers`
(the API URL is baked into the build). Every test title starts with its AC id (`AC-MOB-1` … `AC-MOB-17`;
search: `e2e/mob-search.spec.ts`).
Chromium is taken from `PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`) when present.

## Native flows (Maestro)

```bash
# with a dev build installed on a booted simulator/emulator and the API reachable
maestro test maestro/
```

| Flow | Covers |
|---|---|
| `01-auth.yaml` | register, logout, wrong-password error, login, session kept after relaunch |
| `02-list-add-place.yaml` | create list, add places (map tap / device location / none), category filter |
| `03-map-tab.yaml` | Harita tab, pin card, Google Maps button, open place |
| `04-plan-sort.yaml` | add to day 1, "Sırala" starts at the hotel, day map, plan persists |
| `05-comment-visibility.yaml` | rating, comments with Arkadaşlar / Sadece ben, badges, own-comment menu |
| `06-place-search.yaml` | map search bar, result card, "Listeye ekle" pre-fill, name suggestions, manual fallback |

The flows target `appId: app.voyage.mobile` (dev build). To use Expo Go instead, change `appId` to
`host.exp.exponent` and start with `- openLink: exp://<host>:8081`.
