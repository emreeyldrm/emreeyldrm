# Voyage — Topluluk Katmanı

Uygulama kişisel gezi planından sosyal bir platforma genişliyor: yerleri puanlama,
yorum, herkese açık / özel listeler ve kullanıcılar arası mesajlaşma.

## Ürün kapsamı
- Hesap: Apple ile giriş, kullanıcı adı, profil
- Listeler: Özel (varsayılan), Arkadaşlar, Herkese açık. Kopyalanabilir, yorumlanabilir.
- Yerler: 1-5 puan (kişi başı bir puan), yorum, yorum beğenisi, yanıt
- Keşfet: şehre göre popüler listeler, yakındaki en iyi yerler, arama
- Mesajlar: birebir sohbet, sohbette yer ve liste kartı paylaşma
- Takip: kullanıcı takip etme (arkadaşlar listesinin temeli)

## Önerilen mimari
Sunucu tarafı için Supabase (Postgres + Auth + Realtime + Storage):
- Satır bazlı güvenlik (RLS) ile liste görünürlüğü doğrudan veritabanında zorlanır
- Realtime ile mesajlaşma, Apple ile giriş hazır
- iOS tarafı yerel SwiftData'yı çevrimdışı önbellek olarak tutar, senkron arka planda
Alternatifler: Firebase (hızlı ama ilişkisel sorgu zayıf), CloudKit (ücretsiz ama
herkese açık sosyal özellikler ve moderasyon zor).

## Veri modeli (sunucu)
- profiles(id, handle, display_name, avatar_url)
- lists(id, owner_id, city, title, visibility[private|friends|public], allow_copy, allow_comments)
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
