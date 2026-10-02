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
POST /reports · POST/DELETE /blocks/:userId · GET /users/search?q= · GET /following · POST/DELETE /follows/:userId

Liste görünürlüğü `private | public`; yorum görünürlüğü `private | friends | public` (arkadaş = karşılıklı takip).

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
