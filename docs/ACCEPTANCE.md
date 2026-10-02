# Voyage Web: Kabul Kriterleri ve API Sözleşmesi

Bu doküman `server/` (NestJS) ve `web/` (React + Vite + TypeScript) için tek kaynaktır.
Her kabul kriteri (AC) en az bir e2e testle kapsanır. Test adı AC kimliğini içerir, örn. `AC-LST-3: ...`.

## Teknoloji
- `server/`: NestJS 10, TypeORM + better-sqlite3 (testte `:memory:`, geliştirmede dosya), class-validator,
  @nestjs/jwt, bcryptjs. Testler: Jest + supertest, `server/test/*.e2e-spec.ts`. Port 3000 (`PORT` ile değişir).
- `web/`: Vite + React 18 + TypeScript, react-router. Testler: Playwright, `web/e2e/*.spec.ts`.
  Playwright `webServer` ile sunucuyu (port 3100, bellek içi DB) ve web'i (port 5174) kendisi başlatır.
  API adresi `VITE_API_URL` (varsayılan `http://localhost:3000`). Sunucuda CORS açık.
- Tema: yeşil `#2E7D5B` ana, turuncu `#F28C28` vurgu, beyaz zemin. Kategori simge ve renkleri
  `Voyage/Models/PlaceCategory.swift` ve `project/Theme.dc.html` ile aynı.
- Tüm JSON alanları camelCase. Tarihler ISO-8601 metin.

## Veri kuralları
- Kategoriler: `food, coffee, bar, historic, museum, park, beach, hotel, airport, other`.
- Liste görünürlüğü: `private | public`. Yorum görünürlüğü: `private | friends | public` (varsayılan `public`).
- Arkadaş = karşılıklı takip. Kullanıcı adı (handle): `^[a-z0-9_]{3,20}$`, benzersiz.
- Yer kimliği istemciden gelir: `(provider, providerId)` çifti benzersiz.

## API (hepsi JSON; `/auth/*` dışındakiler `Authorization: Bearer <token>` ister, yoksa 401)
Hata gövdesi: `{ "error": "mesaj" }` (NestJS exception filter ile bu biçime çevrilir; 400/401/403/404/409/429).

| Uç | Gövde / sorgu | Yanıt |
|---|---|---|
| POST /auth/register | `{email, password(>=8), handle}` | 201 `{token, user:{id,handle,email}}`; çakışmada 409 |
| POST /auth/login | `{email, password}` | 200 `{token, user}`; yanlışsa 401 |
| GET /me | | `{id, handle, email}` |
| DELETE /me | | `{ok:true}`; kullanıcının her verisi silinir |
| GET /lists/mine | | `[{id, city, title, visibility, allowCopy, allowComments, itemCount, updatedAt}]` |
| POST /lists | `{city, title, visibility?}` | 201 `{id}` |
| PATCH /lists/:id | `{title?, visibility?, allowCopy?, allowComments?}` | `{ok:true}`; sahibi değilse 404 |
| DELETE /lists/:id | | `{ok:true}`; sahibi değilse 404 |
| PUT /lists/:id/items | `{items:[{provider, providerId, name, lat?, lon?, category?, city?, note?}]}` (en çok 500) | `{ok:true, count}`; listeyi komple değiştirir |
| GET /lists/:id | | `{id, ownerId, ownerHandle, city, title, visibility, allowCopy, allowComments, items:[{placeId, name, lat, lon, category, note, position}]}`; özel ve sahibi değilse 404 |
| GET /discover/lists?city= | | en çok 30 herkese açık liste `[{id, city, title, ownerHandle, itemCount, avgStars}]` |
| GET /places/:id | | `{place:{id,name,lat,lon,category,city}, rating:{count, avg, distribution:[{stars,n}], mine}}` |
| PUT /places/:id/rating | `{stars: 1..5 tam sayı}` | `{ok:true}` |
| GET /places/:id/comments | | `[{id, parentId, body, visibility, createdAt, authorId, author}]` (görünürlük kurallarına göre süzülmüş) |
| POST /places/:id/comments | `{body(1-1000), visibility?, parentId?}` | 201 `{id}`; dakikada 5'ten fazlaysa 429 |
| DELETE /comments/:id | | `{ok:true}`; yalnızca yazan |
| POST /reports | `{targetType: comment|list|user, targetId, reason}` | 201 `{ok:true}` |
| POST /blocks/:userId | | `{ok:true}`; iki yönlü takipleri de siler |
| DELETE /blocks/:userId | | `{ok:true}` |
| GET /users/search?q= | q en az 2 karakter, handle öneki | `[{id, handle, following, followsMe}]` (kendin ve engel ilişkisi olanlar hariç) |
| GET /following | | `[{id, handle, following:true, followsMe}]` |
| POST /follows/:userId | | `{ok:true}`; kendi, olmayan veya engelli kullanıcı için 404/400 |
| DELETE /follows/:userId | | `{ok:true}` |

## Kabul kriterleri

### Kimlik (AUTH)
- AC-AUTH-1: Geçerli e-posta, 8+ karakterli parola ve uygun handle ile kayıt olunur; token döner.
- AC-AUTH-2: Aynı e-posta veya aynı handle ile ikinci kayıt 409 döner.
- AC-AUTH-3: Geçersiz handle (büyük harf, 3 karakterden kısa, boşluk) veya kısa parola 400 döner.
- AC-AUTH-4: Doğru bilgilerle giriş token verir; yanlış parola 401 verir.
- AC-AUTH-5: Token olmadan veya bozuk token ile korumalı uçlar 401 verir.
- AC-AUTH-6: Hesap silinince kullanıcının listeleri, puanları, yorumları ve takipleri de silinir; eski token ile `/me` 401 verir.

### Listeler (LST)
- AC-LST-1: Yeni liste varsayılan olarak `private` oluşur ve `/lists/mine` içinde görünür.
- AC-LST-2: Özel liste sahibi dışında kimseye açılmaz (404); sahibi görür.
- AC-LST-3: Liste `public` yapılınca başka kullanıcı `GET /lists/:id` ile görür ve Keşfet'te çıkar; tekrar `private` yapılınca ikisinden de kaybolur.
- AC-LST-4: Sahibi başlığı, görünürlüğü, kopyalama ve yorum izinlerini günceller; başkası güncelleyemez (404).
- AC-LST-5: `PUT /lists/:id/items` içeriği komple değiştirir, sıra korunur, aynı yer iki listede tek `places` kaydını paylaşır.
- AC-LST-6: 500'den fazla öğe, bilinmeyen kategori (`other`'a düşer) ve eksik alanlar uygun şekilde ele alınır (500+ için 400).
- AC-LST-7: Liste silinince öğeleri de silinir; başkası silemez (404).
- AC-LST-8: Sahibi ile görüntüleyen arasında engel varsa herkese açık liste görüntüleyene 404 döner ve Keşfet'te çıkmaz.

### Keşfet (DSC)
- AC-DSC-1: Yalnızca herkese açık listeler döner; `city` filtresi uygulanır; en çok 30 sonuç.
- AC-DSC-2: Her sonuçta `itemCount` ve listedeki yerlerin ortalama puanı `avgStars` bulunur (puan yoksa `null`).
- AC-DSC-3: Büyük sayıda öğesi olan liste önce gelir.

### Puan (RTG)
- AC-RTG-1: 1-5 arası tam sayı puan verilir; `GET /places/:id` ortalama, adet, dağılım ve `mine` döner.
- AC-RTG-2: Aynı kullanıcı tekrar puanlarsa önceki puanı değişir; toplam adet artmaz.
- AC-RTG-3: 0, 6, 3.5 veya metin 400 döner; olmayan yer 404 döner.

### Yorum (CMT)
- AC-CMT-1: Yorum varsayılan olarak `public` oluşur; boş veya 1000 karakterden uzun 400 döner.
- AC-CMT-2: Geçersiz `visibility` 400 döner.
- AC-CMT-3: `private` yorumu yalnızca yazan görür.
- AC-CMT-4: `friends` yorumunu yazan ve onunla karşılıklı takip eden kullanıcılar görür; tek yönlü takip yetmez; yabancı göremez.
- AC-CMT-5: `public` yorumu herkes görür.
- AC-CMT-6: Bir kullanıcı dakikada 5'ten fazla yorum yazarsa 429 alır.
- AC-CMT-7: Yalnızca yazan kendi yorumunu siler.
- AC-CMT-8: Aynı yorum 3 farklı kullanıcı tarafından şikayet edilince herkesten gizlenir (yazan dahil kimse görmez); aynı kişinin tekrar şikayeti sayılmaz.
- AC-CMT-9: Engel iki yönde de yorumları gizler; engel kalkınca görünür olur.

### Sosyal (SOC)
- AC-SOC-1: Kullanıcı başka birini takip eder ve bırakır; `/following` listesi buna göre değişir.
- AC-SOC-2: Kendini takip etme 400, olmayan kullanıcıyı takip 404 döner.
- AC-SOC-3: Handle önekiyle arama (en az 2 karakter) çalışır, kendini ve engel ilişkisi olanları göstermez; `following` ve `followsMe` doğrudur.
- AC-SOC-4: Engellemek iki yöndeki takipleri siler ve engelli kullanıcıyı takip etmeyi engeller.
- AC-SOC-5: Engel kaldırılabilir.

### Web arayüzü (WEB)
- AC-WEB-1: Kayıt ve giriş formları çalışır; hatalar (çakışma, yanlış parola) ekranda görünür; çıkış yapılır; yenilemeden sonra oturum korunur.
- AC-WEB-2: Giriş yapmayan kullanıcı korumalı sayfalarda giriş sayfasına yönlenir.
- AC-WEB-3: "Listelerim" sayfasında liste oluşturulur, yer eklenir (ad, kategori, not), kategori filtresi çalışır, yerler kategori simgesi ve renkleriyle görünür.
- AC-WEB-4: Liste "Herkese açık" yapılır; başka bir kullanıcı Keşfet'te şehir araması ile bulur ve açar.
- AC-WEB-5: Yer sayfasında 1-5 yıldız verilir, ortalama ve adet güncellenir.
- AC-WEB-6: Yer sayfasında yorum yazılır; "Sadece ben / Arkadaşlar / Herkes" seçici vardır; görünürlük rozeti yorumda görünür; arkadaş olmayan kullanıcı "Arkadaşlar" yorumunu görmez, arkadaş olunca görür.
- AC-WEB-7: Profil/Arkadaşlar sayfasında kullanıcı aranır, takip edilir; karşılıklı olunca "Arkadaş" etiketi çıkar.
- AC-WEB-8: Yorumdan "Şikayet et" ve "Engelle" yapılır; engellenen kullanıcının yorumu kaybolur.
- AC-WEB-9: Hesap silme onay penceresiyle çalışır ve kullanıcıyı giriş sayfasına döndürür.

## Sunucu: Cloudflare Workers (`backend/`)
Mobil uygulamanın sunucusu Workers'tır. NestJS (`server/`) ile aynı sözleşmeyi uygular ve
`server/test` altındaki aynı e2e testler `API_URL` ile Workers'a karşı da çalışır (`backend` içinde `npm run test:contract`).
Ek olarak `POST /auth/apple {identityToken}` Apple ile girişi destekler (e-posta/parola ile aynı `{token, user}` yanıtı).
Parolalar Web Crypto PBKDF2 ile saklanır (Workers CPU sınırı nedeniyle bcrypt değil).

### Mobil uygulama (MOB) — Expo / React Native (`mobile/`)
AC-MOB-1..9, AC-WEB-1..9 ile aynı davranışları mobil arayüzde karşılar (kayıt/giriş, yönlendirme, Listelerim,
herkese açık liste ve Keşfet, puan, görünürlüklü yorum, arkadaşlar, şikayet/engel, hesap silme). Ek olarak:
- AC-MOB-10: Alt sekmeler Keşfet / Listelerim / Mesajlar (Yakında) / Profil; tasarım `docs/design/*.dc.html` ile uyumlu.
- AC-MOB-11: Şehir detayında Liste / Harita / Plan sekmeleri vardır; Harita sekmesi koordinatlı yerleri kategori renk ve simgesiyle pin olarak gösterir (web derlemesinde haritanın yerine koordinat listesi gösterilebilir).
- AC-MOB-12: Plan sekmesinde yerler günlere atanır, gün içinde sıralanır ve "Sırala" en yakın komşu sırasına dizer (otel varsa ondan başlar); günlük kuş uçuşu mesafe gösterilir. Plan cihazda saklanır.
- AC-MOB-13: Her yerin "Google Maps'te aç" eylemi doğru `https://www.google.com/maps/search/?api=1&query=...` bağlantısını açar (koordinat varsa koordinatla, yoksa adla).
- AC-MOB-14: Yer eklerken konum, haritaya dokunarak ya da cihaz konumuyla seçilebilir; konum vermeden de eklenebilir.
