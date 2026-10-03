-- Keşfet: haftanın trendleri (docs/ACCEPTANCE.md, TRD).
-- Görüntüleme (GET /places/:id) ve kaydetme (PUT /lists/:id/items ile listeye yeni giren yer) sinyalleri.
-- Tekilleştirme benzersiz anahtarla yapılır (INSERT OR IGNORE):
--   view: kişi + yer + gün (UTC, YYYY-MM-DD) için en çok bir kayıt
--   save: kişi + yer için en çok bir kayıt (day = '')
-- Kim baktı/kaydetti hiçbir uçta dönmez; yalnızca sayılar. Hesap ya da yer silinince satırlar da silinir.
CREATE TABLE place_events (
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('view','save')),
  day TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CONSTRAINT place_events_dedupe UNIQUE (place_id, user_id, kind, day)
);
CREATE INDEX place_events_place_created ON place_events(place_id, created_at);
CREATE INDEX place_events_user ON place_events(user_id);
