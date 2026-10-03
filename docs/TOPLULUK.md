# Voyage — Topluluk Katmanı

Uygulama kişisel gezi planından sosyal bir platforma genişliyor: yerleri puanlama,
yorum, herkese açık / özel listeler ve kullanıcılar arası mesajlaşma.

## Ürün kapsamı
- Hesap: e-posta/parola veya Apple ile giriş, kullanıcı adı, profil
- Listeler: Özel (varsayılan), Arkadaşlar, Herkese açık. Kopyalanabilir, yorumlanabilir.
- Yerler: 1-5 puan (kişi başı bir puan), yorum, yorum beğenisi, yanıt
- Keşfet: şehre göre popüler listeler, yakındaki en iyi yerler, arama
- Mesajlar: birebir sohbet, sohbette yer ve liste kartı paylaşma
- Takip: kullanıcı takip etme (arkadaşlar listesinin temeli)

## Mimari (Cloudflare)
- **Workers (Hono, TypeScript):** REST API, `backend/src/index.ts`
- **D1 (SQLite):** ilişkisel veri, şema `backend/migrations/`
- **R2:** yer ve yorum fotoğrafları (`POST /media`, `GET /media/:id`; kova `voyage-media`, bağlama `MEDIA`)
- **Durable Objects + WebSocket:** mesajlaşma (2. sürüm)
- **Giriş:** E-posta + parola (`/auth/register`, `/auth/login`) ya da "Apple ile giriş" (`/auth/apple`; iOS jetonu
  Worker Apple anahtarlarıyla doğrular). Üçü de aynı `{token, user:{id, handle, email}}` yanıtını ve 30 günlük
  oturum jetonunu (HS256) döner. Parolalar Web Crypto PBKDF2-SHA256 (100.000 yineleme, rastgele tuz) ile saklanır;
  Workers CPU sınırı nedeniyle bcrypt kullanılmaz. Silinmiş hesabın jetonu 401 alır.
- **Yetki:** Cloudflare'de satır bazlı güvenlik yok. Liste görünürlüğü, sahiplik ve engel kontrolü
  API kodunda, her sorguda yapılıyor. Yeni uç eklerken bu kontrolü atlamamak gerekir.
- Mobil uygulama (Expo, `mobile/`) listeleri cihazda çevrimdışı önbellekte tutar, senkron `PUT /lists/:id/items` ile.

### Çalıştırma
```
cd backend && npm install
npx wrangler d1 create voyage        # çıkan database_id'yi wrangler.toml'a yaz
npx wrangler r2 bucket create voyage-media   # fotoğraflar; wrangler.toml'da [[r2_buckets]] binding = "MEDIA"
npm run db:remote
npx wrangler secret put SESSION_SECRET
npm run deploy
```
Yerelde: `echo 'SESSION_SECRET=x' > .dev.vars && npm run db:local && npm run dev`

`wrangler dev` R2'yi yerelde taklit eder (`.wrangler/` altında); yerel çalıştırma için kova oluşturmak gerekmez.

Sözleşme testleri: `npm run test:contract` boş bir yerel D1 (ve taklit R2) ile Worker'ı 8790'da başlatır (`npm run start:e2e`)
ve `server/test` altındaki NestJS e2e testlerini `API_URL` ile ona karşı çalıştırır.

### API (v1)
Sözleşmenin tamamı `docs/ACCEPTANCE.md`'de; JSON alanları camelCase, hata gövdesi `{error}`.

POST /auth/register · POST /auth/login · POST /auth/apple · GET/PUT/DELETE /me · GET /lists/mine · POST /lists · PATCH/DELETE /lists/:id ·
PUT /lists/:id/items · GET /lists/:id · POST /lists/:id/copy · GET/POST /lists/:id/members · DELETE /lists/:id/members/:userId ·
GET /discover/lists?city= · GET /discover/home?city=&category= · GET /places/:id ·
PUT /places/:id/rating · GET/POST /places/:id/comments · DELETE /comments/:id ·
POST /reports · POST/DELETE /blocks/:userId · GET /users/search?q= · GET /following · POST/DELETE /follows/:userId ·
GET /search/places?q=&lat=&lon= · POST /media · GET /media/:id (oturumsuz)

Liste görünürlüğü `private | public`; yorum görünürlüğü `private | friends | public` (arkadaş = karşılıklı takip).

### Yer arama sağlayıcısı (`GET /search/places`)
Mobil uygulamadaki Google Maps benzeri arama (harita sekmesi ve "Yer ekle" ad alanı) bu uca gider; sağlayıcı
anahtarı yalnızca sunucuda durur. Sağlayıcı kodu ve kategori eşlemesi `backend/src/search-core.ts` ile
`server/src/search/search-core.ts`'te (iki dosya birebir aynı; `server` içindeki `npm run test:unit` farkı yakalar).

- **Varsayılan: Photon** (photon.komoot.io, OpenStreetMap verisi). Anahtar gerekmez, ücretsiz; ancak herkese açık
  sunucu adil kullanım sınırlıdır, yoğun trafikte kendi Photon kurulumunuz ya da Google önerilir.
  Kaydedilen kimlik `provider = osm`, `providerId = <osm_type><osm_id>` (örn. `W24618397`).
- **Google Places API (New) — Text Search:** anahtarı gizli değişken olarak ekleyin, kod değişikliği gerekmez:
  ```
  cd backend && npx wrangler secret put GOOGLE_PLACES_API_KEY      # Worker
  GOOGLE_PLACES_API_KEY=... npm run start                           # NestJS (server/)
  ```
  Google Cloud'da "Places API (New)" açılmalı; anahtarı yalnızca bu API ile sınırlayın. İstekte alan maskesi
  (`places.id, displayName, formattedAddress, location, primaryType, types`) kullanılır; bu alanlar
  Text Search "Pro" SKU'suna girer — her arama ücretlidir (aylık ücretsiz kotanın ardından 1.000 istek başına
  onlarca USD mertebesinde; güncel fiyatı Google Maps Platform fiyat sayfasından kontrol edin, bütçe uyarısı kurun). İstemci 350 ms bekleme ve en az 2 karakterle istek sayısını düşürür.
- **Google kullanım koşulları:** Google içeriği (ad, adres, koordinat) kalıcı olarak saklanamaz; yalnızca **yer kimliği
  (place ID)** süresiz saklanabilir. Bu yüzden uzun vadede `places` tablosunda Google yerleri için kimlik esas alınmalı,
  ad/koordinat gerektiğinde Place Details ile tazelenmelidir (şu an liste kaydı ad ve koordinatı da tutuyor; Google
  açılmadan önce bu tazeleme işi eklenmeli ya da Photon'da kalınmalı). Google sonuçları gösterilirken "Google" atfı gerekir.
- Sağlayıcıyı zorlamak için `SEARCH_PROVIDER = photon | google | fake` (Worker'da `[vars]`, NestJS'te ortam değişkeni).
  Testler `fake` kullanır (`backend/scripts/start-e2e.mjs`, `server` `start:e2e` ve Jest ortamı); dış ağa çıkılmaz.
- Sağlayıcı hata verir ya da 5 sn'de yanıt vermezse uç 502 `{error}` döner; istemci "Arama şu an yapılamıyor" der ve
  elle eklemeye izin verir.

### Fotoğraflar ve yer detayları (DET)
- `POST /media` ham resim gövdesi alır (JPEG/PNG/WebP, en çok 5 MB) ve `{id, url: "/media/<id>"}` döner; kimlik
  128 bit rastgeledir. Baytlar Worker'da R2'de (anahtar = kimlik), NestJS'te `media.data` BLOB sütununda; sahibi ve türü
  `media` tablosunda. `GET /media/:id` oturum istemez (`<img>` başlık gönderemez) ve
  `Cache-Control: public, max-age=31536000, immutable` döner. Hesap silinince R2 nesneleri ve satırlar silinir.
- Liste öğesi `details` (servis, bekleme, öneri, kişi başı harcama, favoriler, fotoğraflar) ve yorum `photos`
  doğrulaması `backend/src/details-core.ts` ile `server/src/lists/details-core.ts`'te (birebir aynı; `npm run test:unit`
  farkı yakalar). Fotoğraf kimlikleri yalnızca isteği yapan kullanıcının yüklediği medya olabilir.
- Silinen listeden ya da düzenlemede çıkarılan fotoğraflar günlük temizlik işiyle silinir (aşağıda, MED).

### Liste kopyalama ve ortak listeler (CPY, COL)
Sözleşme ve yetki tablosu `docs/ACCEPTANCE.md`'de. Kararlar `backend/src/collab-core.ts` ile `server/src/lists/collab-core.ts`'te
(birebir aynı; `npm run test:unit` farkı yakalar): her liste ucu `ACCESS_SQL` ile (liste, istek yapan) için sahiplik, üyelik,
görünürlük ve engeli okur, sonra `requireView / requireEditor / requireOwner / requireCopy / requireRemoveMember` ile karar verir.
- `list_members(list_id, user_id, role='editor', added_at)` (`migrations/0006_list_members.sql`; NestJS `ListMember`). Liste,
  hesap silinince ve iki kişi arasında engel olunca üyelikler silinir.
- Üye yalnızca sahibin arkadaşı (karşılıklı takip) olabilir, en çok 20. Üye öğeleri değiştirir; ayarlar, silme ve üye ekleme
  sahibindir (üyeye 403). `GET /lists/mine` üye olunan listeleri de `role` ve `ownerHandle` ile döner.
- Fotoğraflar: üyenin eklediği fotoğraf kendi medyası olmalı; yeniden kaydederken aynı yerde zaten duran (başkasının)
  fotoğraf kimlikleri korunabilir (`photosNeedingOwnership`).
- Kopya (`POST /lists/:id/copy`): özel, "<başlık> (kopya)", öğeler sıra/kategori/not/detaylarıyla, fotoğraflar hariç. Kopyalayan
  için her yer bir "kaydetme" sinyali (kişi + yer için bir kez); asıl sahibe sinyal yazılmaz.

### Fotoğraf temizliği (MED)
Günlük iş (Worker: `scheduled` + `wrangler.toml` `[triggers] crons = ["17 3 * * *"]`, UTC; NestJS: 03:17 UTC zamanlayıcı,
`MEDIA_CLEANUP_DISABLED=1` kapatır) hiçbir `list_items.details.photos` ve `comments.photos` içinde geçmeyen, 24 saatten eski
medyayı siler: koşul `DELETE … RETURNING id` içinde değerlendirilir (arada bağlanan fotoğraf kalır), Worker dönen kimliklerin
R2 nesnelerini siler. SQL `cleanup-core.ts`'te (iki sunucuda aynı). `scripts/deploy.sh` yalnızca `database_id` satırını
değiştirdiği için tetikleyici `wrangler.production.toml`'a aynen geçer. Testte işi `POST /test/media-cleanup` tetikler
(yalnızca `E2E_TEST_HOOKS=1`; `server/test/media-cleanup.e2e-spec.ts`). Yerelde: `npx wrangler dev --test-scheduled` ve
`curl "localhost:8787/__scheduled?cron=17+3+*+*+*"`.

### Keşfet: haftanın trendleri (TRD)
`GET /discover/home?city=&category=` "Haftanın restoranı", "Haftanın trendleri", "En çok beğenilenler" (kategori
çipleri), "En çok aranan" bölümlerini ve çip sayılarını döner (sözleşme: `docs/ACCEPTANCE.md`, TRD). Sıralama ve
puanlama `backend/src/discover-core.ts` ile `server/src/discover/discover-core.ts`'te (birebir aynı; `npm run test:unit`
farkı yakalar, formüller orada birim testli).

- **Sinyaller** (`place_events` tablosu, `migrations/0005_place_events.sql`; NestJS'te `PlaceEvent` varlığı):
  - görüntüleme: `GET /places/:id` her açılışta `INSERT OR IGNORE`; benzersiz anahtar (yer, kişi, `view`, gün) →
    kişi + yer için günde en çok 1 (gün UTC, `YYYY-MM-DD`).
  - kaydetme: `PUT /lists/:id/items` isteğinden önce o listede olmayan her yer; anahtar (yer, kişi, `save`, `''`) →
    kişi + yer için toplamda en çok 1 (aynı listeyi yeniden kaydetmek, ikinci liste, çıkarıp geri eklemek sayılmaz).
  - puanlar (`ratings.updated_at`) ve gizlenmemiş `public` yorumlar (`comments.created_at`, yanıtlar dahil).
  - Pencere: `[istek anı − 7 gün, istek anı]` (kayan). Sinyaller SQL'de bu pencerede toplanır (`HOME_SQL`; dizin
    `place_events(place_id, created_at)`), puanlama JS'te yapılır. Şehir eşleşmesi büyük/küçük harf ve aksan duyarsızdır
    (İ/I/ı/i aynı; `foldCity`, search-core `fold` ile aynı kural): kayıtlı şehir yazılışlarından eşleşenler bulunur,
    sorgu bunlarla `places.city` üzerinden yapılır. Yerin şehri `places.city`'dir (yeri ilk kaydeden listenin öğe `city`'si).
- **Formüller:**
  - trend puanı = görüntüleme + 3×kaydetme + 2×puan + 2×yorum (7 gün); 0 olan yer `trending`'e girmez.
  - en çok aranan = görüntüleme + kaydetme (7 gün); 0 olan girmez.
  - en çok beğenilen: Bayes ortalaması `(Σyıldız + 3×3.5) / (n + 3)`, tüm zamanların puanları, en az 1 puan;
    `category` yalnızca bu bölümü süzer. Kartta `avgStars` ham ortalamadır (1 ondalık), `score` ağırlıklı ortalama (2 ondalık).
  - eşitlikte: daha çok puan adedi, sonra ad (aksansız, küçük harf), sonra kimlik.
  - haftanın restoranı: `food` kategorisinde, trend puanı > 0, en az 1 puanlı ve ağırlıklı ortalaması ≥ 3.5 olanlardan
    trend sırası en yüksek olan; yoksa `null`. (Puansız yerin Bayes ortalaması tam 3.5 olduğundan "en az 1 puan" şartı
    eklendi.)
  - `categoryCounts`: o şehirde gösterilebilen ve herhangi bir bölüme girebilen (7 günde sinyali ya da en az bir puanı
    olan) yer sayısı; mobil uygulama sayısı 0 olan çipi gizler.
- **Gizlilik:** yalnızca arama sağlayıcısından gelen yerler (`provider ≠ voyage`) ya da en az bir herkese açık listede
  geçen yerler döner (`isDiscoverable`); yalnızca özel listelerde elle eklenmiş yer hiçbir bölümde görünmez. Kimin
  baktığı/kaydettiği hiçbir uçta dönmez, yalnızca sayılar. Engel ilişkisi sayıları etkilemez (topluluk istatistiği).
  Hesap silinince (`DELETE /me`) kişinin sinyalleri, puanları ve yorumları silinir; sayılar düşer.
- **Test kancası:** `E2E_TEST_HOOKS=1` iken (yalnızca `backend/scripts/start-e2e.mjs` `--var E2E_TEST_HOOKS:1`,
  NestJS `npm run start:e2e` ve Jest `test/setup-env.ts` ayarlar) `X-Test-Now: <ISO tarih>` başlığı isteğin saatini
  değiştirir: `GET /places/:id` ve `PUT /lists/:id/items` sinyali o zamanla yazar, `GET /discover/home` pencereyi o ana
  göre hesaplar. Böylece testler 7 günden eski sinyal üretir. Üretimde değişken hiç ayarlanmaz (`wrangler.toml`'da
  yoktur), başlık yok sayılır; `resolveNow` ve bu bağlantılar `server/test/unit/discover-core.spec.ts`'te test edilir.
  Testler: `server/test/trends.e2e-spec.ts` (AC-TRD-1..8; NestJS içinde ve `npm run test:contract` ile Worker'a karşı).

### Mesajlaşma (MSG)
Arkadaşlar (karşılıklı takip) arasında birebir sohbet; yer ve liste eki. Sözleşme, hata sırası ve uygulama notları
`docs/ACCEPTANCE.md` "Mesajlaşma (MSG)" bölümünde. Kurallar ve SQL `messages-core.ts`'te (Worker `backend/src/`, NestJS
`server/src/messages/`; birebir aynı, `server/test/unit/messages-core.spec.ts` farkı yakalar). Worker uçları ayrı bir Hono
alt uygulamasıdır (`backend/src/routes/messages.ts`, `index.ts`'te oturum ara katmanından sonra `app.route('/conversations', …)`).
- Tablolar (`migrations/0007_messages.sql`; NestJS `Conversation`, `ConversationMember`, `Message`): `conversations(id, pair_key
  UNIQUE, created_at)`, `conversation_members(conversation_id, user_id, last_read_at, last_read_id)`, `messages(id,
  conversation_id, sender_id, body, attachment_type NULL|place|list, attachment_id, created_at)`.
- Gerçek zaman yok: uygulama açık sohbeti 3 sn'de bir `GET …/messages?after=<son id>` ile, sohbet listesini ve sekme rozetini
  (`GET /conversations/unread`) 15 sn'de bir yoklar. Workers'ta WebSocket/Durable Object gerekmez; ileride gerekirse
  sohbet başına bir Durable Object eklenebilir.
- Gizlilik: liste eki her okuyan için ayrı değerlendirilir; göremeyeceği liste yalnızca "Özel liste" olarak döner (başlık,
  şehir ya da yer sayısı sızmaz). Açarken liste kuralları (`GET /lists/:id`) yine uygulanır.
- Güvenlik: dakikada 30 mesaj; engel ya da arkadaşlığın bitmesi gönderimi durdurur (403), geçmiş okunur kalır. Hesap
  silinince sohbetler iki taraf için de silinir.
- Bildirim: anlık bildirim (APNs/FCM) yok; geliştirme derlemesi ve APNs anahtarı olunca `expo-notifications` ile mesaj
  gönderiminde push eklenecek. O zamana kadar rozet ve listeler yoklamayla güncellenir.
- Mobil: Mesajlar sekmesi (sohbet listesi, rozet), `chat/[id]` sohbet ekranı (Chat.dc.html), yer sayfası ve harita yer kartında
  "Mesajla gönder" (`components/SendToFriend.tsx`; liste paylaşım ekranı aynı `SendToFriendButton`'ı `{type: 'list'}` ile kullanır).
  Testler: `server/test/messages.e2e-spec.ts` (AC-MSG-1..4; NestJS ve Worker), `mobile/e2e/mob-messages.spec.ts`
  (AC-MOB-40..42), `mobile/unit/chat.spec.ts`.

## Veri modeli (sunucu)
- profiles(id, handle, display_name, avatar_url)
- lists(id, owner_id, city, title, visibility[private|public], allow_copy, allow_comments)
- list_items(list_id, place_id, category, note, position, details JSON)
- list_members(list_id, user_id, role[editor], added_at)  // ortak listeler (COL)
- media(id, owner_id, content_type, size, created_at)  // baytlar R2'de; 24 saatten eski, kullanılmayanlar günlük silinir
- places(id, provider_place_id, name, lat, lon, category)  // yer kimliği: Apple/Google yer kimliği
- ratings(place_id, user_id, stars)  // benzersiz (place_id, user_id)
- place_events(place_id, user_id, kind[view|save], day, created_at)  // benzersiz (place_id, user_id, kind, day); Keşfet trendleri
- comments(id, place_id | list_id, user_id, body, parent_id, photos JSON, created_at)
- follows(follower_id, followee_id)
- conversations / messages(id, conversation_id, sender_id, body, attachment_type, attachment_id)
- reports(id, reporter_id, target_type, target_id, reason), blocks(blocker_id, blocked_id)

## Dikkat edilecekler
1. **Google içeriği:** Google Places puanı, yorumu ve fotoğrafı kendi veritabanında saklanamaz.
   Puan ve yorumlar Voyage kullanıcılarından gelir; yer yalnızca kimlik, ad, koordinat olarak tutulur.
2. **App Store (UGC kuralı 1.2):** Kullanıcı içeriği olan uygulamada şikayet etme, kullanıcı
   engelleme, uygunsuz içerik filtresi ve hesap silme zorunlu. Hepsi ilk sürüme girmeli.
3. **Gizlilik:** Liste varsayılan Özel. Konum ve gittiği yerler ancak liste açılırsa görünür.
   KVKK/GDPR için hesap ve veri silme akışı gerekir.
4. **Sahte puan:** Kişi başı bir puan, yeni hesaplara hız sınırı, şikayet edilen yorumlar gizlenir.

## Aşamalar
1. Hesap + liste yükleme/senkron (özel listeler bulutta)
2. Herkese açık listeler + Keşfet + puan/yorum + şikayet/engelleme
3. Takip + mesajlaşma
4. Bildirimler, "yakınımdaki kayıtlı yerler", paylaşılan ortak düzenleme

## Plan iyileştirmeleri (PLN): yürüme süresi, açılış saatleri, bütçe
Sözleşme `docs/ACCEPTANCE.md` → "Plan iyileştirmeleri (PLN)" (AC-PLN-1..2, AC-MOB-43..45).

- **Uçlar (oturum gerekli):** `GET /routes/walk?points=lat,lon;…` (2–25 nokta → bacaklar + toplam metre/saniye) ve
  `GET /places/:id/hours` (OSM `opening_hours` metni ya da `null`). Worker: `backend/src/routes/plan.ts` (index.ts'e tek satırla
  bağlı), NestJS: `server/src/plan/plan.module.ts`. Sağlayıcı mantığı `plan-core.ts`, iki sunucuda birebir aynı
  (`server/test/unit/plan-core.spec.ts` farkı yakalar; sağlayıcılar sahte `fetch` ile birim testli).
- **Önbellek:** `place_hours` tablosu (Worker `migrations/0008_place_hours.sql`; NestJS açılışta aynı `CREATE TABLE IF NOT
  EXISTS`'i çalıştırır, tablo TypeORM varlığı değildir). Yer başına 7 gün; "saat yok" sonucu da saklanır; sağlayıcı hata verirse
  süresi dolmuş satır sunulur. Rotalar sunucuda saklanmaz: mobil uygulama günün durak imzasıyla (`/routes/walk?points=…` adresi)
  cihazda saklar, çevrimdışıyken oradan gösterir, hiç yoksa kuş uçuşuna düşer.
- **Ayarlar (Worker `wrangler secret put` / `[vars]`, NestJS ortam değişkeni):**
  `GOOGLE_ROUTES_API_KEY` (yoksa `GOOGLE_PLACES_API_KEY` kullanılır; Routes API projede etkin olmalı),
  `ROUTING_URL` (varsayılan `https://routing.openstreetmap.de/routed-foot`), `OVERPASS_URL` (varsayılan
  `https://overpass-api.de/api/interpreter`), zorlamak için `ROUTING_PROVIDER=fake|osrm|google`, `HOURS_PROVIDER=fake|osm|google`.
  Testler `ROUTING_PROVIDER=fake HOURS_PROVIDER=fake` ile çalışır (`server/test/setup-env.ts`, `npm run start:e2e`,
  `backend/scripts/start-e2e.mjs`).
- **Kullanım koşulları:** routing.openstreetmap.de (FOSSGIS) ve overpass-api.de ücretsiz, gönüllü sunuculardır: düşük hacim,
  tanımlayıcı `User-Agent` (gönderiliyor), toplu/sürekli istek yok. Üretimde kullanıcı sayısı artınca kendi OSRM (foot profili)
  ve Overpass örneğini kurmak ya da Google anahtarlarını vermek gerekir. Overpass yükü 7 günlük önbellekle sınırlıdır; rota
  isteği her yeni gün sırası için bir kez (istemci önbelleği) gider. Google Routes/Place Details ücretlidir (alan maskesi yalnızca
  gereken alanları ister: `routes.legs.distanceMeters,routes.legs.duration`, `regularOpeningHours`). Google Maps Platform
  koşulları Places içeriğinin saklanmasına izin vermediği için Google kaynaklı saatler `place_hours`'a yazılmaz (her istek
  Google'a gider; 7 günlük önbellek yalnızca OSM/Overpass için). Bu koşullar hukuken ayrıca gözden geçirilmeli.
- **Sınırlar:** Gerçek sağlayıcılar bu ortamda (dış ağ kapalı) yalnızca sahte `fetch` ile denendi; canlı yanıt biçimleri
  doğrulanmadı. Google `periods` OSM metnine çevrilir (gece yarısını aşan aralık `18:00-02:00`, çok günlü aralık bölünür);
  yalnızca yerelleştirilmiş `weekdayDescriptions` varsa ve özel günler/tatiller için saat yok sayılır (`null`). Mobil ayrıştırıcı
  (`mobile/src/lib/openingHours.ts`) yaygın OSM sözdizimini destekler; ay/hafta seçicileri, `sunrise`, `10:00+` gibi biçimlerde
  rozet gösterilmez. Saat dilimi koordinata en yakın gömülü şehrin ülkesinden bulunur (tek saat dilimli ülkeler); ABD, Rusya,
  Brezilya gibi çok saat dilimli ülkelerde cihaz saati kullanılır ve yer sayfasında "cihaz saatine göre" yazar.
- **Bütçe** tamamen istemcide (`mobile/src/lib/budget.ts`): plan günlerindeki yerlerin `details.spendPerPerson`/`currency`
  değerleri para birimine göre ayrı toplanır (çevrim yapılmaz), harcaması girilmemiş yer sayısı belirtilir.
