# Voyage — Tasarım Notları

iOS (SwiftUI + SwiftData + MapKit), iOS 17+. Veri cihazda saklanır, çevrimdışı çalışır.

## Ekran akışı
Şehirlerim → Şehir detayı (Liste | Harita | Plan, kategori filtresi) → Yer detayı
Tema: yeşil (ana), turuncu (vurgu), beyaz (zemin); renkler Voyage/Models/Theme.swift
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
brew install xcodegen && xcodegen && open Voyage.xcodeproj
