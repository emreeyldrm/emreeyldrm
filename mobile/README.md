# Voyage Mobile (Expo)

Expo / React Native (TypeScript, expo-router) client for the Voyage contract API
(`docs/ACCEPTANCE.md`, AC-MOB-1..25). The design follows `docs/design/*.dc.html`
(Plus Jakarta Sans, green `#2E7D5B`, orange `#F28C28`, category tint/dark colours from
`src/lib/categories.ts`).

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

## Keşfet: weekly trends (AC-MOB-26/27)

The Discover tab (`src/app/(app)/(tabs)/discover.tsx`, cards in `src/components/DiscoverCards.tsx`) calls
`GET /discover/home?city=&category=` and `GET /discover/lists?city=` for the selected city and shows, in order:
**Haftanın restoranı** (hero card), **Haftanın trendleri** (horizontal cards), **En çok beğenilenler** (category chips;
chips with a 0 count are hidden, a chip refetches with `category`), **En çok aranan** and **Popüler listeler**.
Cards show the category icon/colour, name and "4,6 · 12 puan · bu hafta 34 bakış" (`cardStats`, `src/lib/discover.ts`);
tapping opens the place page. Every section has an empty state; pull-to-refresh reloads (on web, where there is no pull
gesture, the "Yenile" button in the header does the same).

Default city: the nearest city to the device location **only if location permission was already granted** (no prompt
on open; `locationIfGranted()` in `src/lib/useDeviceLocation.ts`, waits at most 2.5 s), else the city of the most
recently updated own list, else "İstanbul". `nearestCity(lat, lon)` (`src/lib/destinations.ts`) picks the most
populous bundled city within 25 km (GeoNames lists metro districts such as Şişli separately) or, if none, the nearest.
The city field suggests cities from the bundled dataset; any typed city can be searched.

## Place details and photos (AC-MOB-21..25)

The add-place sheet has a collapsible **Detaylar** section (open by default for Yemek / Kahve / Bar):
service (Masada / Paket) with a wait range each (0-10 … 45+ dk), **Önerim** (Masada / Paket / İkisi de olur;
switches to Paket with an explanation when the dine-in wait is 30+ min and takeout exists, unless the user
picked one), favourite dishes as tags, average spend per person (currency defaults from the list city's
country via the bundled city data, fallback TRY) and up to 6 photos. Owners open a saved place with
**Düzenle** (pencil) to change category, note and details; name and location stay as saved because they
identify the place. List rows show a summary ("Paket önerilir · Masada 30-45 dk · ~12 €") and photo
thumbnails; tapping one opens a full-screen viewer. The place page's comment composer takes up to 4 photos.

Photos are picked with `expo-image-picker` (library; camera on native — on web the library is a file input),
resized to ≤ 1600 px and re-encoded as JPEG (0.7) with `expo-image-manipulator`, and uploaded as a raw body to
`POST /media` (XHR, per-photo progress). The API returns relative URLs (`/media/<id>`), which the app prefixes
with `EXPO_PUBLIC_API_URL` (`src/lib/media.ts`). iOS permission texts are set through the `expo-image-picker`
plugin in `app.config.ts`. `PUT /lists/:id/items` replaces the whole list, so every item's `details` (including
photo ids) is sent back unchanged when another item is added, edited or removed.

## Run

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<your-ip>:8787 npx expo start
```

- **Expo Go**: scan the QR code. Everything used here (expo-router, expo-location, expo-secure-store,
  expo-image-picker, expo-image-manipulator, react-native-maps, react-native-svg, AsyncStorage) ships in Expo Go.
- **Development build** (recommended for Maestro and store builds): `npx expo run:ios` / `npx expo run:android`
  (or `eas build --profile development`). Bundle id / package: `com.emreeyldrm.voyage`.
  Android builds need a Google Maps API key for react-native-maps (`GOOGLE_MAPS_ANDROID_API_KEY`, read by
  `app.config.ts`); iOS uses Apple Maps unless built with Google Maps (see TestFlight / EAS below).
- **Web**: `npx expo start --web`. react-native-maps has no web support, so the map screens use
  `*.web.tsx` fallbacks (an accessible list of pins with coordinates; coordinates are typed in to pick a location).

Backends: `cd backend && npm run dev` (Worker, port 8787) or the NestJS reference server
`cd server && npm run start:dev` (port 3000).

## Checks

```bash
npm run typecheck                 # tsc (app) + tsc (e2e + unit)
npm run test:unit                 # node-only unit tests (src/lib/takeout.ts)
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
(the API URL is baked into the build). Every test title starts with its AC id (`AC-MOB-1` … `AC-MOB-27`;
search: `e2e/mob-search.spec.ts`; details and photos: `e2e/mob-details.spec.ts`, which feeds generated PNGs to the
web file chooser; Discover trends: `e2e/mob-discover.spec.ts`, which seeds users, views, ratings and saves through
the API of the server under test; Google import: `e2e/mob-import.spec.ts`, which feeds generated Takeout CSV/JSON files
to the web file chooser).
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
| `07-place-details.yaml` | Detaylar (service, wait, auto "Paket" suggestion, favourites, spend), a photo from the gallery, summary, viewer, Düzenle |
| `08-discover.yaml` | Keşfet: empty-city states, city suggestions, Haftanın restoranı / trendler / en çok beğenilenler (chips) / en çok aranan, popular lists, pull-to-refresh, open place |
| `10-google-import.yaml` | Google'dan içe aktar: Takeout steps, pick `fixtures/Roma yemek.csv` (push it to the device first), preview, matching / "Kontrol et" / "Konumsuz ekle", summary, Google Maps link |

The flows target `appId: com.emreeyldrm.voyage` (dev build). To use Expo Go instead, change `appId` to
`host.exp.exponent` and start with `- openLink: exp://<host>:8081`.

## Şehir ve ülke listesi
"Yeni liste" şehir önerileri `src/data/places-index.json` dosyasından, internetsiz çalışır. Veri
[GeoNames](https://www.geonames.org/) (CC BY 4.0) kaynaklıdır; Türkçe ve İngilizce ad eşlemeleri
`scripts/build-cities.mjs` içindeki `ALIASES` tablosundadır. Yeniden üretmek için:
`npm i --no-save all-the-cities && node scripts/build-cities.mjs`

## Google listelerini içe aktarma (AC-MOB-31..36)

Listelerim → **Google'dan içe aktar** (`src/app/(app)/import.tsx`) explains how to get a Google Takeout export
("Kaydedilenler" = one CSV per saved list, "Haritalar (yerleriniz)" = `Saved Places.json`) and lets the user pick one or
more files (`expo-document-picker`; read with `expo-file-system` `File.text()` on native, the browser `File` on web —
`src/lib/pickFiles(.web).ts`). Parsing and heuristics are pure functions in `src/lib/takeout.ts`:

- RFC 4180-style CSV (quotes, `""`, commas/newlines in fields, CRLF, BOM, case-insensitive headers, empty rows skipped);
  `Title` (or the name in a `/maps/place/<name>` URL), `Note` + `Comment`, `URL`. Exact coordinates in the URL
  (`!3d…!4d…`, `/maps/search/lat,lon`, `q=lat,lon`) are used; `@lat,lon` (viewport centre) is not.
- GeoJSON (`features[].geometry.coordinates` = `[lon, lat]`, `[0,0]` = no location; `Title`/`location.name`,
  `location.address`/`Location.Address`, `google_maps_url`/`Google Maps URL`, old `Geo Coordinates`). Places are grouped
  by nearest bundled city (or the city in the address), one preview card per city.
- City guess from the list name with the bundled city data (`Roma yemek` → Roma; `Want to go` → none) and a default
  category from type words (TR/EN/ES/IT; "Otomatik" = the search result's category).
- Matching: `/search/places` near the city centre, 2 requests at a time, progress, cancel/resume. Best result =
  name similarity (folded, type words ignored) minus a distance penalty; > 50 km from the centre or similarity < 0.5 is
  marked **Kontrol et**. The user can pick another result, search with another name or choose **Konumsuz ekle**.
  JSON places with coordinates are added without a search.
- Commit: new lists or merge into an existing list (its items are kept; `PUT` replaces the list), dedupe by provider id or
  name + ~100 m, note and `details.googleMapsUrl` (https Google Maps hosts only, same rule as the server). Over 500 items
  continue in "Title (2)", … Summary: "3 liste, 87 yer; 5 yer konumsuz".
- "Google Maps'te aç" opens `details.googleMapsUrl` as is when present (AC-MOB-36).

`npm run test:unit` runs the node-only unit tests of `takeout.ts` (`unit/`, Playwright test runner, no browser).

## TestFlight / EAS (AC-INF-2)

App identity lives in `app.config.ts` (a dynamic config, so keys can come from the environment):
name **Voyage**, scheme `voyage`, bundle id / package **`com.emreeyldrm.voyage`**, version `1.0.0`
(`ios.buildNumber` / `android.versionCode` start at 1; EAS bumps them remotely for production builds),
iPhone only (`supportsTablet: false`), `ITSAppUsesNonExemptEncryption = false` (no export-compliance
question in App Store Connect), Turkish permission texts (location, photos, camera). Icon, Android adaptive
icon and splash (green `#2E7D5B`, white pin with an orange dot) are generated by
`node scripts/generate-app-icons.mjs` (repo root) into `assets/`.

### Prerequisites

- **Apple Developer Program** membership (paid, 99 USD/yıl) on the Apple ID that will own the app. TestFlight and
  App Store builds are impossible without it; a free account can only run `npx expo run:ios` on your own device.
- An [Expo account](https://expo.dev/signup) (free tier is enough).
- **Development builds need `expo-dev-client`**: run `npx expo install expo-dev-client` in `mobile/` once
  (not installed yet; the `development` profiles below require it).

### One-time setup

```bash
cd mobile
npx eas-cli login                 # Expo account
npx eas-cli init                  # creates the EAS project; prints a project id
```

`eas init` cannot write into a dynamic config: put the printed id into `EAS_PROJECT_ID` at the top of
`app.config.ts` (or `export EAS_PROJECT_ID=…`). The first iOS build asks for your Apple ID and creates the
App ID (`com.emreeyldrm.voyage`), distribution certificate and provisioning profile for you (let EAS manage
credentials).

### Build profiles (`eas.json`)

| Profile | Use |
|---|---|
| `development` | dev client, internal distribution (install on registered devices via QR; `eas device:create` registers an iPhone) |
| `development-simulator` | same, but an iOS **simulator** build (`ios.simulator: true`; no Apple account needed for running it) |
| `preview` | internal distribution of a release build (ad hoc), for quick testing without TestFlight |
| `production` | App Store / TestFlight build; `autoIncrement` bumps the build number on every build |

```bash
npx eas-cli build --profile development --platform ios            # dev client on a device
npx eas-cli build --profile development-simulator --platform ios  # dev client for the simulator
npx eas-cli build -p ios --profile production                     # TestFlight / App Store build
npx eas-cli submit -p ios                                         # upload the latest build to App Store Connect
                                                                  # (or: eas build -p ios --profile production --auto-submit)
```

`eas.json` → `submit.production.ios` contains **placeholders** (`replace-me@example.com`, `0000000000`,
`XXXXXXXXXX`). Replace them before `eas submit`, or delete the three keys and let EAS ask interactively:

- `appleId`: the Apple ID e-mail you sign in to App Store Connect with,
- `ascAppId`: App Store Connect → Uygulamalar → Voyage → Uygulama Bilgileri → **Apple ID** (digits),
- `appleTeamId`: developer.apple.com → Membership → **Team ID** (10 characters).

The App Store Connect app record (name Voyage, bundle id `com.emreeyldrm.voyage`, primary language Turkish) is created
by `eas submit` on the first run, or manually in App Store Connect → Uygulamalar → "+".

### TestFlight

1. After `eas submit`, Apple processes the build (5–30 min); it appears in App Store Connect → Voyage → **TestFlight**.
2. **Internal testers** (up to 100 people on your App Store Connect team): TestFlight → Dahili Test → create a group,
   add users (they must be invited under Kullanıcılar ve Erişim first), enable the build. No App Review needed.
3. **External testers** (public link / e-mail) need a short Beta App Review and the "Test Bilgileri" form filled in.
4. Testers install the **TestFlight** app on their iPhone and accept the invitation.

The production build talks to the API URL inlined at build time: set `EXPO_PUBLIC_API_URL` (the deployed Worker,
`backend/.deploy.env` after `./scripts/deploy.sh`) as an EAS environment variable for the `production` environment:
`npx eas-cli env:create --environment production --name EXPO_PUBLIC_API_URL --value https://….workers.dev --visibility plaintext`.

### Google Maps (development builds)

Expo Go always shows Apple Maps. A development (or production) build can use Google Maps on iOS; the env contract,
read by `app.config.ts` at build/prebuild time:

| Variable | Where it goes | Effect |
|---|---|---|
| `GOOGLE_MAPS_IOS_API_KEY` | `ios.config.googleMapsApiKey` + `react-native-maps` plugin `iosGoogleMapsApiKey` | links the Google Maps SDK (`react-native-maps/Google` pod) and writes `GMSApiKey` into Info.plist |
| `GOOGLE_MAPS_ANDROID_API_KEY` | `android.config.googleMaps.apiKey` + plugin `androidGoogleMapsApiKey` | `com.google.android.geo.API_KEY` in AndroidManifest (Android maps are always Google) |
| `EXPO_PUBLIC_MAPS_PROVIDER` | JS bundle (`process.env`) | `google` → the app passes `PROVIDER_GOOGLE` to `<MapView>` on iOS; anything else / unset → Apple Maps. Only set `google` for builds made with `GOOGLE_MAPS_IOS_API_KEY`. |

Keys: Google Cloud Console → APIs & Services → enable **Maps SDK for iOS** / **Maps SDK for Android** → Credentials →
API key, restricted to the iOS bundle id / Android package `com.emreeyldrm.voyage` (+ SHA-1 for Android). Never commit
them; store them as EAS environment variables (secret visibility) for the `development` (and if wanted `production`)
environment:

```bash
npx eas-cli env:create --environment development --name GOOGLE_MAPS_IOS_API_KEY --value <key> --visibility secret
npx eas-cli env:create --environment development --name EXPO_PUBLIC_MAPS_PROVIDER --value google --visibility plaintext
```

For a local build: `GOOGLE_MAPS_IOS_API_KEY=<key> EXPO_PUBLIC_MAPS_PROVIDER=google npx expo run:ios`.
(The `<MapView provider>` switch itself lives in `src/`; until it reads `EXPO_PUBLIC_MAPS_PROVIDER`, iOS keeps Apple Maps.)
