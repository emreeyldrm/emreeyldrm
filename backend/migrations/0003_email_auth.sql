-- E-posta/parola ile giriş: users tablosuna email ve password_hash eklenir, apple_sub boş olabilir.
-- SQLite NOT NULL kısıtını kaldıramadığı için users tablosu yeniden kurulur.
--
-- D1'de yabancı anahtarlar her zaman açıktır ve kapatılamaz. `DROP TABLE users` örtük bir
-- `DELETE FROM users` yapar ve ON DELETE CASCADE eylemleri (ertelenmiş olsa bile) bağlı satırları siler.
-- Bu yüzden bağlı tablolar önce yedeklenir, users yeniden kurulduktan sonra aynen geri yüklenir.
-- Ayrıca tüm zaman damgaları ISO-8601'e (2026-01-01T12:00:00.000Z) çevrilir; API artık bu biçimi yazar.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE _bak_lists AS SELECT * FROM lists;
CREATE TABLE _bak_list_items AS SELECT * FROM list_items;
CREATE TABLE _bak_ratings AS SELECT * FROM ratings;
CREATE TABLE _bak_comments AS SELECT * FROM comments;
CREATE TABLE _bak_follows AS SELECT * FROM follows;
CREATE TABLE _bak_blocks AS SELECT * FROM blocks;
CREATE TABLE _bak_reports AS SELECT * FROM reports;
CREATE TABLE _bak_seq AS SELECT seq FROM sqlite_sequence WHERE name = 'users';

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apple_sub TEXT UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT,
  handle TEXT UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO users_new (id, apple_sub, handle, display_name, created_at)
  SELECT id, apple_sub, handle, display_name, COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), created_at)
  FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Silinmiş en yüksek kimlik yeniden kullanılmasın (eski jetonlar yeni bir kullanıcıya geçmesin):
-- DROP TABLE sayacı sildiği için eski AUTOINCREMENT sayacı geri yazılır.
INSERT INTO sqlite_sequence (name, seq) SELECT 'users', 0
  WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'users');
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT MAX(seq) FROM _bak_seq), 0)) WHERE name = 'users';
DROP TABLE _bak_seq;

-- Kaskadla silinen (ya da silinmeyen) bağlı satırları yedekten aynen geri yükle.
DELETE FROM list_items;
DELETE FROM ratings;
DELETE FROM comments;
DELETE FROM follows;
DELETE FROM blocks;
DELETE FROM reports;
DELETE FROM lists;
INSERT INTO lists SELECT * FROM _bak_lists;
INSERT INTO list_items SELECT * FROM _bak_list_items;
INSERT INTO ratings SELECT * FROM _bak_ratings;
INSERT INTO comments SELECT * FROM _bak_comments;
INSERT INTO follows SELECT * FROM _bak_follows;
INSERT INTO blocks SELECT * FROM _bak_blocks;
INSERT INTO reports SELECT * FROM _bak_reports;

DROP TABLE _bak_lists;
DROP TABLE _bak_list_items;
DROP TABLE _bak_ratings;
DROP TABLE _bak_comments;
DROP TABLE _bak_follows;
DROP TABLE _bak_blocks;
DROP TABLE _bak_reports;

-- Zaman damgaları ISO-8601.
UPDATE lists SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
  WHERE created_at NOT LIKE '%T%' OR updated_at NOT LIKE '%T%';
UPDATE ratings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) WHERE updated_at NOT LIKE '%T%';
UPDATE comments SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at) WHERE created_at NOT LIKE '%T%';
UPDATE follows SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at) WHERE created_at NOT LIKE '%T%';
UPDATE reports SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at) WHERE created_at NOT LIKE '%T%';
