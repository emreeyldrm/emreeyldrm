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
- **R2:** profil ve liste fotoğrafları (sonraki adım)
- **Durable Objects + WebSocket:** mesajlaşma (2. sürüm)
- **Giriş:** E-posta + parola (`/auth/register`, `/auth/login`) ya da "Apple ile giriş" (`/auth/apple`; iOS jetonu
  Worker Apple anahtarlarıyla doğrular). Üçü de aynı `{token, user:{id, handle, email}}` yanıtını ve 30 günlük
  oturum jetonunu (HS256) döner. Parolalar Web Crypto PBKDF2-SHA256 (100.000 yineleme, rastgele tuz) ile saklanır;
  Workers CPU sınırı nedeniyle bcrypt kullanılmaz. Silinmiş hesabın jetonu 401 alır.
- **Yetki:** Cloudflare'de satır bazlı güvenlik yok. Liste görünürlüğü, sahiplik ve engel kontrolü
  API kodunda, her sorguda yapılıyor. Yeni uç eklerken bu kontrolü atlamamak gerekir.
- iOS tarafı SwiftData'yı çevrimdışı önbellek olarak tutar, senkron `PUT /lists/:id/items` ile.

### Çalıştırma
```
cd backend && npm install
npx wrangler d1 create voyage        # çıkan database_id'yi wrangler.toml'a yaz
npm run db:remote
npx wrangler secret put SESSION_SECRET
npm run deploy
```
Yerelde: `echo 'SESSION_SECRET=x' > .dev.vars && npm run db:local && npm run dev`

Sözleşme testleri: `npm run test:contract` boş bir yerel D1 ile Worker'ı 8790'da başlatır (`npm run start:e2e`)
ve `server/test` altındaki NestJS e2e testlerini `API_URL` ile ona karşı çalıştırır.

### API (v1)
Sözleşmenin tamamı `docs/ACCEPTANCE.md`'de; JSON alanları camelCase, hata gövdesi `{error}`.

POST /auth/register · POST /auth/login · POST /auth/apple · GET/PUT/DELETE /me · GET /lists/mine · POST /lists · PATCH/DELETE /lists/:id ·
PUT /lists/:id/items · GET /lists/:id · GET /discover/lists?city= · GET /places/:id ·
PUT /places/:id/rating · GET/POST /places/:id/comments · DELETE /comments/:id ·
POST /reports · POST/DELETE /blocks/:userId · GET /users/search?q= · GET /following · POST/DELETE /follows/:userId ·
GET /search/places?q=&lat=&lon=

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

## Veri modeli (sunucu)
- profiles(id, handle, display_name, avatar_url)
- lists(id, owner_id, city, title, visibility[private|public], allow_copy, allow_comments)
- list_items(list_id, place_id, category, note, position)
- places(id, provider_place_id, name, lat, lon, category)  // yer kimliği: Apple/Google yer kimliği
- ratings(place_id, user_id, stars)  // benzersiz (place_id, user_id)
- comments(id, place_id | list_id, user_id, body, parent_id, created_at)
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
