-- Yer detayları ve fotoğraflar (docs/ACCEPTANCE.md, DET).
-- Liste öğesi detayları doğrulanmış JSON olarak saklanır (src/details-core.ts); boşsa '{}'.
ALTER TABLE list_items ADD COLUMN details TEXT NOT NULL DEFAULT '{}';

-- Yorum fotoğrafları: medya kimliklerinin JSON dizisi; yoksa '[]'.
ALTER TABLE comments ADD COLUMN photos TEXT NOT NULL DEFAULT '[]';

-- Yüklenen resimler. Baytlar R2'de (MEDIA bağlaması, anahtar = id); burada sahibi ve türü tutulur.
-- id: 128 bit rastgele, küçük harf onaltılık (tahmin edilemez; GET /media/:id oturum istemez).
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX media_owner ON media(owner_id);
