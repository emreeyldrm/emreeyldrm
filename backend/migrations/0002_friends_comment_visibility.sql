-- Yorum görünürlüğü: private (sadece yazan), friends (karşılıklı takip), public (herkes)
ALTER TABLE comments ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('private','friends','public'));

-- Takip. İki kişi birbirini takip ediyorsa arkadaştır.
CREATE TABLE follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX follows_followee ON follows(followee_id);
