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

## API (hepsi JSON; `/auth/*` ve `GET /media/:id` dışındakiler `Authorization: Bearer <token>` ister, yoksa 401)
Hata gövdesi: `{ "error": "mesaj" }` (NestJS exception filter ile bu biçime çevrilir; 400/401/403/404/409/413/415/429).

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
| PUT /lists/:id/items | `{items:[{provider, providerId, name, lat?, lon?, category?, city?, note?, details?}]}` (en çok 500; `details` bkz. DET) | `{ok:true, count}`; listeyi komple değiştirir |
| GET /lists/:id | | `{id, ownerId, ownerHandle, city, title, visibility, allowCopy, allowComments, items:[{placeId, provider, providerId, name, lat, lon, category, note, position, details}]}`; özel ve sahibi değilse 404 |
| GET /discover/lists?city= | | en çok 30 herkese açık liste `[{id, city, title, ownerHandle, itemCount, avgStars}]` |
| GET /places/:id | | `{place:{id,name,lat,lon,category,city}, rating:{count, avg, distribution:[{stars,n}], mine}}` |
| PUT /places/:id/rating | `{stars: 1..5 tam sayı}` | `{ok:true}` |
| GET /places/:id/comments | | `[{id, parentId, body, visibility, createdAt, authorId, author, photos}]` (görünürlük kurallarına göre süzülmüş) |
| POST /places/:id/comments | `{body(0-1000), visibility?, parentId?, photos?(≤4)}` (metin ya da fotoğraf gerekli) | 201 `{id}`; dakikada 5'ten fazlaysa 429 |
| DELETE /comments/:id | | `{ok:true}`; yalnızca yazan |
| POST /reports | `{targetType: comment|list|user, targetId, reason}` | 201 `{ok:true}` |
| POST /blocks/:userId | | `{ok:true}`; iki yönlü takipleri de siler |
| DELETE /blocks/:userId | | `{ok:true}` |
| GET /users/search?q= | q en az 2 karakter, handle öneki | `[{id, handle, following, followsMe}]` (kendin ve engel ilişkisi olanlar hariç) |
| GET /following | | `[{id, handle, following:true, followsMe}]` |
| GET /search/places?q=&lat=&lon= | q en az 2 karakter; lat/lon isteğe bağlı (ikisi birlikte) | en çok 8 `[{provider, providerId, name, address, lat, lon, category}]`; sağlayıcı hatasında 502 (bkz. SRCH) |
| POST /follows/:userId | | `{ok:true}`; kendi, olmayan veya engelli kullanıcı için 404/400 |
| DELETE /follows/:userId | | `{ok:true}` |
| POST /media | ham resim gövdesi, `Content-Type: image/jpeg\|png\|webp`, ≤5 MB | 201 `{id, url}`; 415 / 413 / 400 (bkz. DET) |
| GET /media/:id | oturum istemez | resim baytları, `Cache-Control: public, max-age=31536000, immutable`; yoksa 404 |

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
- AC-MOB-13: Her yerin "Google Maps'te aç" eylemi yeri **adıyla** açar, böylece Google Maps kendi yer işaretini
  gösterir: `https://www.google.com/maps/search/?api=1&query=<Ad, adres ya da şehir>` (arama sonucunda adres, listede
  listenin şehri; ad zaten şehri içeriyorsa tekrar edilmez). Google kaynaklı yerlerde `&query_place_id=<id>` eklenir.
  iOS'ta Google Maps uygulaması yüklüyse `comgooglemaps://?q=<sorgu>&center=<lat>,<lon>` ile açılır (koordinat yalnızca
  yakınlık ipucu), açılamazsa web bağlantısına düşer.
- AC-MOB-14: Yer eklerken konum, haritaya dokunarak ya da cihaz konumuyla seçilebilir; konum vermeden de eklenebilir.

### Yer arama (SRCH)
Sunucu uç noktası (Workers ve NestJS aynı): `GET /search/places?q=&lat=&lon=` (oturum gerekli).
- `q` en az 2 karakter; `lat`/`lon` verilirse sonuçlar o konuma yakın olanlara ağırlık verir (ikisi birlikte ve
  geçerli aralıkta olmalı, yoksa 400).
- Yanıt: en çok 8 sonuç `[{provider, providerId, name, address, lat, lon, category}]`. `category` sağlayıcının
  yer türünden bizim 10 kategoriden birine eşlenir (eşlenemezse `other`). `provider`: `google` (Google yer kimliği),
  `osm` (Photon; `providerId` = OSM türü + kimliği, örn. `N123`) ya da `fake`.
- Kaydedilen yer kimliğini korur: `GET /lists/:id` öğelerinde `provider`/`providerId` döner; istemci listeyi
  `PUT /lists/:id/items` ile yeniden yazarken bunları aynen gönderir.
- Sağlayıcı ortam değişkeniyle seçilir: `GOOGLE_PLACES_API_KEY` varsa Google Places (New) Text Search,
  yoksa Photon (photon.komoot.io, OpenStreetMap). Testlerde `SEARCH_PROVIDER=fake` sabit örnek veri döner
  (Roma, İstanbul ve birkaç şehirde ~14 yer; `q=__fail__` sağlayıcı hatasını taklit eder). `SEARCH_PROVIDER` ile
  `photon` ya da `google` da zorlanabilir. Sağlayıcıya istek 5 sn'de zaman aşımına uğrar.
  Sağlayıcı hatasında 502 `{error}` döner. Anahtar istemciye hiç gönderilmez.
- AC-SRCH-1: Geçerli aramada sonuçlar sözleşme biçiminde döner; kategoriler eşlenmiştir.
- AC-SRCH-2: `q` 2 karakterden kısaysa 400; oturumsuz istek 401.
- AC-SRCH-3: `lat`/`lon` verildiğinde yakın sonuç önce gelir (fake sağlayıcı mesafeye göre sıralar).

Mobil:
- AC-MOB-15: Harita sekmesinin üstünde Google Maps benzeri bir arama çubuğu vardır; yazdıkça (bekleme ile) öneri
  listesi açılır; bir öneriye dokununca harita oraya gider, geçici bir pin ve alt kartta ad, adres, kategori,
  "Listeye ekle" ve "Google Maps'te aç" görünür.
- AC-MOB-16: "Listeye ekle" yer ekleme penceresini ad, kategori ve konumla dolu açar; kaydedilen yer sağlayıcının
  kimliğini (`provider`, `providerId`) korur ve haritada kalıcı pin olur.
- AC-MOB-17: Yer ekleme penceresinde de ad alanı arama önerileri gösterir; öneri seçilince konum ve kategori dolar.
  Arama sonucu yoksa ya da sağlayıcı hata verirse kullanıcı elle eklemeye devam edebilir.
- AC-MOB-18: Arama varsayılan olarak cihaz konumuna göre yapılır (izin ilk aramada istenir) ve sonuçlar en yakından
  en uzağa sıralanır (sunucu sağlayıcıdan geniş bir havuz alıp mesafeye göre sıralar). Yer ekleme penceresinde
  "Yakınımda" ve liste şehri (ör. "Roma") seçenekleri vardır; şehir seçilince sonuçlar o şehre göre sıralanır.
  Liste boşken harita kullanıcının konumunda açılır.
- AC-MOB-19: "Yeni liste" formundaki şehir alanı yazdıkça şehir ve ülke önerir. Veri uygulamaya gömülüdür
  (GeoNames: nüfusu 15.000+ şehirler, Türkiye'de 1.000+; ülkeler ve İngiltere/İskoçya/Galler/Kuzey İrlanda),
  internetsiz çalışır. Türkçe, İngilizce ve yerel adlarla, büyük/küçük harf ve aksan duyarsız eşleşir
  ("Ist"/"ist" → İstanbul, "eng" → İngiltere/England, "ing" → İngiltere, "rome" → Roma, "cologne" → Köln).
  Tam ad eşleşmesi önce gelir. Öneri seçmek zorunlu değildir; listede olmayan bir yer elle yazılabilir.

### Yer arama: tür kelimeleri ve dil
- `GET /search/places` isteğe bağlı `lang` (2 harf, cihaz dili) alır; Google'da `languageCode`, Photon'da
  desteklenen dillerde (en, de, fr) `lang` olarak gönderilir; geçersiz değer yok sayılır.
- AC-SRCH-4: Sorgudaki tür kelimesi (restaurant/restoran/ristorante, cafe/kafe, bar/pub, hotel/otel, museum/müze/museo,
  park, beach/plaj/playa, airport/havalimanı …) ayrılır; kalan ad o türün süzgeciyle aranır ve bu sonuçlar düz
  aramadan önce gelir. "Restaurant la campana" adı "Cervecería La Campana" olan restoranı bulur.
- AC-MOB-20: Uygulama aramalarda cihaz dilini gönderir; yer ekleme penceresinde "restaurant la campana" yazınca
  Madrid listesinde "Cervecería La Campana" önerilir.

## Yer detayları ve fotoğraflar (DET)

### API (Workers ve NestJS aynı)
- Liste öğesine isteğe bağlı `details` nesnesi eklenir (`PUT /lists/:id/items` girdisinde, `GET /lists/:id` çıktısında;
  yoksa `{}`). Alanlar (hepsi isteğe bağlı):
  - `dineIn`, `takeout`: boolean (masada servis / paket var mı)
  - `waitDineIn`, `waitTakeout`: `"0-10" | "10-20" | "20-30" | "30-45" | "45+"` (dakika aralığı)
  - `recommendation`: `"dine_in" | "takeout" | "either"`
  - `spendPerPerson`: sayı, 0–100000; `currency`: 3 harfli ISO 4217 kodu (büyük harf)
  - `favorites`: en çok 10 metin, her biri 1–60 karakter (kırpılır, boşlar atılır)
  - `photos`: en çok 6 medya kimliği (aşağıda); her biri isteği yapan kullanıcının yüklediği medya olmalı
  Geçersiz değer 400 `{error}`; bilinmeyen alanlar yok sayılır (saklanmaz).
- `POST /media` (oturum gerekli): gövde ham resim, `Content-Type: image/jpeg | image/png | image/webp`, en çok 5 MB.
  201 `{id, url}`. `id` tahmin edilemez (en az 128 bit rastgele), `url` = `/media/<id>`. Başka tür 415, büyük dosya 413,
  boş gövde 400.
- `GET /media/:id` oturum istemez (resim etiketleri başlık gönderemez; kimlik tahmin edilemez), doğru `Content-Type` ve
  uzun önbellek başlığı döner; yoksa 404. Workers'ta R2 (`MEDIA` bağlaması), NestJS'te veritabanı.
- Hesap silinince kullanıcının medyası da silinir (`GET /media/:id` 404).

### Kabul kriterleri
- AC-DET-1: Detaylar kaydedilir ve `GET /lists/:id` ile aynen geri gelir; alan verilmezse `details` `{}` olur.
- AC-DET-2: Geçersiz bekleme aralığı, öneri, para birimi, negatif/çok büyük tutar, 11. favori, 7. fotoğraf 400 döner.
- AC-DET-3: Resim yüklenir ve `GET /media/:id` ile aynı bayt ve tür geri gelir; yanlış tür 415, 5 MB üstü 413,
  oturumsuz yükleme 401, olmayan kimlik 404.
- AC-DET-4: Başka kullanıcının yüklediği medya kimliği bir listeye eklenemez (400).
- AC-DET-5: Özel listenin detayları sahibi dışında görünmez (liste zaten 404); herkese açık listede herkes görür.
- AC-DET-6: Hesap silinince o kullanıcının medyası silinir.

### Mobil
- AC-MOB-21: Yer ekleme penceresinde "Detaylar" bölümü vardır. Yemek/kahve/bar için: servis (Masada / Paket),
  her biri için bekleme aralığı, favori yiyecekler (etiket olarak eklenir/silinir). Her kategori için: kişi başı
  ortalama harcama (para birimi listenin şehrinin ülkesinden varsayılan gelir, değiştirilebilir) ve fotoğraf.
- AC-MOB-22: Masada bekleme 30 dk ve üstü ve paket varsa "Önerim" kendiliğinden "Paket" olur ve açıklama gösterilir
  ("Masada 30-45 dk bekleme var, paket almak daha mantıklı"); kullanıcı öneriyi değiştirebilir.
- AC-MOB-23: En çok 6 fotoğraf galeriden ya da kameradan eklenir, yüklenir, küçük resim olarak görünür ve silinebilir;
  yükleme sürerken "Ekle" beklenir, hata olursa mesaj gösterilir.
- AC-MOB-24: Listede her yerin altında detay özeti (ör. "Paket önerilir · Masada 30-45 dk · ~12 €") ve fotoğraf küçük
  resimleri görünür; sahibi bir yeri "Düzenle" ile açıp detaylarını ve fotoğraflarını değiştirebilir.

### Yorum fotoğrafları
- `POST /places/:id/comments` gövdesine isteğe bağlı `photos` (en çok 4 medya kimliği, yorumu yazanın yüklediği) eklenir;
  `GET /places/:id/comments` her yorumda `photos: string[]` döner (yoksa `[]`). Fotoğraflı yorumda metin boş olabilir
  (metin ya da en az bir fotoğraf gerekir). Yorumun görünürlük kuralları fotoğraflara da uygulanır.
- AC-DET-7: Fotoğraflı yorum kaydedilir ve geri gelir; 5. fotoğraf ya da başkasının medyası 400; metin ve fotoğraf
  ikisi de yoksa 400; "Sadece ben" yorumunun fotoğrafları başkasına dönmez.
- AC-MOB-25: Yer sayfasında yorum yazarken en çok 4 fotoğraf eklenir (galeri/kamera), yüklenir, küçük resim olarak
  görünür ve gönderilmeden kaldırılabilir; gönderilen yorumda fotoğraflar küçük resim olarak görünür ve dokununca büyür.

## Keşfet: haftanın trendleri ve kategoriler (TRD)

### Sinyaller
- `GET /places/:id` her açılışta bir **görüntüleme** kaydeder (aynı kullanıcı + yer için günde en çok 1).
- `PUT /lists/:id/items` listeye **yeni** giren her yer için bir **kaydetme** kaydeder (aynı kullanıcı + yer için en çok 1).
- Puanlar (`ratings.updated_at`) ve yorumlar (`comments.created_at`, gizlenmemiş, `public`) de sinyaldir.
- Pencere: istek anından geriye **son 7 gün** (kayan pencere).

### API (Workers ve NestJS aynı)
`GET /discover/home?city=&category=` (oturum gerekli; `city` büyük/küçük harf ve aksan duyarsız; `category` isteğe bağlı,
"en çok beğenilen" listesini süzer). Yanıt:
```
{
  city,
  placeOfWeek: PlaceCard | null,        // "Haftanın restoranı": food kategorisi, trend puanı en yüksek ve
                                        //  ağırlıklı ortalama ≥ 3.5 olan yer (yoksa null)
  trending: PlaceCard[],                // en çok 10; trend puanı = görüntüleme + 3×kaydetme + 2×puan + 2×yorum (7 gün)
  topRated: PlaceCard[],                // en çok 10; ağırlıklı ortalama (Bayes: (Σ + 3×3.5)/(n + 3)), en az 1 puan;
                                        //  category verilirse o kategori
  mostSearched: PlaceCard[],            // en çok 10; görüntüleme + kaydetme (7 gün)
  categoryCounts: { [category]: number } // o şehirde en az bir sinyali olan yer sayısı (çipler için)
}
PlaceCard = { placeId, name, category, city, lat, lon, avgStars, ratingCount, views7d, saves7d, score }
```
- Puanı 0 olan (hiç sinyali olmayan) yer `trending`/`mostSearched`'e girmez. Eşitlikte daha çok puan, sonra ad sırası.
- **Gizlilik:** yalnızca arama sağlayıcısından gelen yerler (`provider` ≠ `voyage`) ya da en az bir herkese açık listede
  geçen yerler döner; yalnızca özel listelerde elle eklenmiş yerler hiçbir bölümde görünmez. Kimin baktığı/kaydettiği
  dönmez, yalnızca sayılar. Engel ilişkisi sayıları etkilemez (topluluk istatistiği).
- Hesap silinince o kullanıcının sinyalleri de silinir.

### Kabul kriterleri
- AC-TRD-1: Görüntüleme kişi başı günde bir kez sayılır; kaydetme kişi başı bir kez; 7 günden eski sinyaller sayılmaz.
- AC-TRD-2: `trending` trend puanına göre sıralanır ve formül doğrudur; sinyalsiz yer girmez; en çok 10.
- AC-TRD-3: `topRated` ağırlıklı ortalamaya göre sıralanır (1 tane 5 yıldız, 10 tane 4.6 ortalamanın önüne geçmez);
  `category` süzgeci çalışır.
- AC-TRD-4: `placeOfWeek` food kategorisinden ve ortalama ≥ 3.5 koşuluyla seçilir; uygun yer yoksa null.
- AC-TRD-5: `mostSearched` görüntüleme + kaydetmeye göre sıralanır.
- AC-TRD-6: Şehir süzgeci büyük/küçük harf ve aksan duyarsızdır; başka şehrin yerleri dönmez.
- AC-TRD-7: Yalnızca özel listede elle eklenmiş yer hiçbir bölümde görünmez; aynı yer herkese açık bir listeye
  girince görünür.
- AC-TRD-8: Hesap silinince sinyaller silinir (sayılar düşer).

### Mobil
- AC-MOB-26: Keşfet ekranında şehir seçici vardır (varsayılan: cihaz konumuna en yakın şehir, yoksa kullanıcının en son
  listesinin şehri; şehir alanı Yeni liste'deki gibi öneri gösterir). Bölümler sırayla: "Haftanın restoranı" büyük kartı,
  "Haftanın trendleri" yatay kaydırmalı kartlar, "En çok beğenilenler" (kategori çipleri: Hepsi, Yemek, Kahve, Bar,
  Plaj, Müze …; sayısı 0 olan çip gizlenir), "En çok aranan", ardından mevcut "Popüler listeler". Kartlarda kategori
  simgesi/rengi, ad, ortalama yıldız ve sayı (ör. "4,6 · 12 puan · bu hafta 34 bakış"); dokununca yer sayfası açılır.
- AC-MOB-27: Veri yokken bölümler bozulmaz; anlamlı boş durum metinleri görünür ("Bu hafta henüz trend yok — ilk
  puanı sen ver"). Çekerek yenileme (pull-to-refresh) çalışır.

## Haritada dokunarak yer seçme (TAP)

### API (Workers ve NestJS aynı)
- `GET /search/nearby?lat=&lon=&lang=` (oturum gerekli): dokunulan noktanın çevresindeki (en çok ~150 m) **adlandırılmış
  yerleri** en yakından uzağa döner (en çok 8, `/search/places` ile aynı sonuç biçimi). Sokak, bina, adres gibi yer
  olmayan sonuçlar elenir. Sağlayıcı: Google varsa Places API (New) Nearby Search (mesafe sıralı), yoksa Photon
  `reverse`; testte `fake` (fikstürler içinden 300 m içindekiler). Geçersiz/eksik lat-lon 400, sağlayıcı hatası 502.
- `POST /places/resolve` (oturum gerekli) `{provider, providerId, name, lat, lon, category, city?}`: yer veritabanında
  yoksa oluşturur, varsa olanı döner → `{placeId}`. Böylece listeye eklemeden puan ve yorum verilebilir.
  `provider = voyage` kabul edilmez (400; elle eklenen yerler yalnızca listeden gelir).
- AC-TAP-1: `/search/nearby` yakındaki yerleri mesafeye göre döner; çok uzaktakiler ve adsız/adres sonuçları gelmez.
- AC-TAP-2: `/places/resolve` aynı kimlik için hep aynı `placeId`'yi döner; dönen yere `PUT /places/:id/rating`
  ve yorum yapılabilir, `GET /places/:id` çalışır; `voyage` sağlayıcısı 400.

### Mobil
- AC-MOB-28: Harita sekmesinde haritaya (bir işletme simgesine ya da boş bir noktaya) dokununca yakındaki yerler aranır;
  en yakın yer alttan açılan kartta gösterilir ve geçici bir işaret konur. Kartta "Başka bir yer mi?" ile diğer yakın
  yerler listelenir ve seçilebilir. Kayıtlı pinlere dokunmak eskisi gibi kendi kartını açar. (Android'de ve Google
  haritasında `onPoiClick` gelen ad ve konumla doğrudan o yer aranır.)
- AC-MOB-29: Kartta yer adı, kategori, adres, Voyage ortalaması ve puan sayısı, son 3 yorum (görünürlük kurallarıyla)
  görünür; kullanıcı listeye eklemeden 1–5 yıldız verebilir (anında kaydedilir, ortalama güncellenir). "Listeye ekle"
  (yer ekleme penceresi dolu açılır), "Google Maps'te aç" ve "Tüm yorumlar" (yer sayfası) düğmeleri vardır.
- AC-MOB-30: Arama sonucu kartı (harita araması) da aynı kartı kullanır: puan, son yorumlar ve "Tüm yorumlar" orada da
  vardır.
