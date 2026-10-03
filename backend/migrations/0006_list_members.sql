-- Ortak listeler (docs/ACCEPTANCE.md, COL): sahibin arkadaşları listeye düzenleyici (editor) olarak eklenir.
-- Yetki API kodunda (src/collab-core.ts ACCESS_SQL) her istekte kontrol edilir. Liste ya da hesap silinince
-- üyelikler de silinir (API ayrıca açıkça siler); engel iki kişi arasındaki üyelikleri kaldırır.
CREATE TABLE list_members (
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor')),
  added_at TEXT NOT NULL,
  PRIMARY KEY (list_id, user_id)
);
CREATE INDEX list_members_user ON list_members(user_id);

-- Fotoğraf temizliği (MED): günlük iş 24 saatten eski, hiçbir yerde geçmeyen medyayı siler (src/cleanup-core.ts).
CREATE INDEX media_created ON media(created_at);
