-- Mesajlaşma (docs/ACCEPTANCE.md, MSG): arkadaşlar arasında birebir sohbet. Kurallar API kodunda
-- (src/messages-core.ts, server/src/messages ile birebir aynı). İki kişi arasında tek sohbet: pair_key =
-- "<küçük id>:<büyük id>". Okunmamış sayısı last_read_id ile kesin hesaplanır (aynı milisaniyedeki mesajlar
-- karışmasın); last_read_at bilgi amaçlıdır. Kimlikler AUTOINCREMENT: `after` imleci için asla yeniden kullanılmaz.
-- Hesap silinince kullanıcının sohbetleri (iki taraf için de) ve içindeki mesajlar silinir (API açıkça siler).
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user ON conversation_members(user_id);

-- Ek: attachment_type 'place' (places.id) ya da 'list' (lists.id); hedef silinse de mesaj kalır.
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  attachment_type TEXT CHECK (attachment_type IN ('place', 'list')),
  attachment_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX messages_conversation ON messages(conversation_id, id);
CREATE INDEX messages_sender_created ON messages(sender_id, created_at);
