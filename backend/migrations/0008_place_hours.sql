-- Plan iyileştirmeleri (docs/ACCEPTANCE.md, PLN): açılış saatleri önbelleği.
-- GET /places/:id/hours sağlayıcıdan (Overpass / Google Place Details) aldığı OSM opening_hours metnini burada 7 gün
-- saklar; opening_hours NULL = sağlayıcıda saat yok (bu sonuç da 7 gün saklanır). Satır kullanıcıya bağlı değildir.
-- Şema src/plan-core.ts PLACE_HOURS_DDL ile aynıdır (NestJS onu açılışta çalıştırır); burada ek olarak yer silinince
-- satır da silinir.
CREATE TABLE IF NOT EXISTS place_hours (
  place_id INTEGER PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  opening_hours TEXT,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
