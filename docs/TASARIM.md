# Voyage — Tasarım Notları

Mobil uygulama: Expo / React Native (`mobile/`), iOS ve Android. Sunucu: Cloudflare Worker (`backend/`).
(İlk Swift prototipi kaldırıldı; aşağıdaki notların bir kısmı o dönemden kalmadır.)

## Ekran akışı
Şehirlerim → Şehir detayı (Liste | Harita | Plan, kategori filtresi) → Yer detayı
Tema: yeşil (ana), turuncu (vurgu), beyaz (zemin); renkler `mobile/src/theme.ts` (kategoriler: `mobile/src/lib/categories.ts`)
Kategoriler: yemek, kahve, bar, tarihi, müze, park, plaj, otel, havalimanı, diğer (her biri kendi simge ve renginde)

Şehir detayı "+" menüsü: Yer ekle, Google'dan içe aktar (Takeout CSV).

## Veri modeli
- City: name, country, places
- Place: name, category, note, lat/lon, googleMapsURL, visited, planDay

## Google Maps ilişkisi
Resmi "kayıtlı listeler" API'si yok. İçe aktarma Takeout CSV ile, koordinatlar MapKit
araması ile bulunur. Navigasyon için her yerden Google Maps linkine geçilir.

## Sıradaki adımlar
1. (Yapıldı: yakın komşu sıralama, kuş uçuşu mesafe, rota çizgisi) Sonraki: gerçek yürüme/sürüş süresi (MKDirections)
2. Yer arayıp ekleme (MKLocalSearch) ve Google Places ile saat/puan
3. Yakındaki kayıtlı yerler bildirimi (geofence)
4. iCloud senkronu, fotoğraf günlüğü, paylaşılabilir liste

## Çalıştırma (Mac)
Kurulum ve çalıştırma: kök `README.md` ve `mobile/README.md` (`./scripts/setup-mac.sh`, `./scripts/run-phone.sh`).

## Topluluk (iOS tarafı)
Alt sekmeler: Keşfet, Listelerim, Mesajlar (yakında), Profil. Ayrıntı: docs/TOPLULUK.md
- Kod: `mobile/src/app/` (ekranlar), `mobile/src/lib/` (API istemcisi, oturum), ayrıntı `mobile/README.md`.
- API adresi `EXPO_PUBLIC_API_URL` ile verilir (deploy sonrası Worker adresi; `./scripts/run-phone.sh --canli`).
- Aynı yerin kullanıcılar arasında eşleşmesi: ad + ~100 m koordinat anahtarı (`Place.communityKey`).
  Daha sağlam eşleşme için ileride MapKit/Google yer kimliğine geçilecek.
