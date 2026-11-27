-- Up
CREATE TABLE guestAvatars (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('general', 'varon', 'mujer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0,
  image BLOB
);

INSERT INTO guestAvatars (id, category) VALUES ('general', 'general');
WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 13)
INSERT INTO guestAvatars (id, category)
SELECT printf('varon/%02d', n), 'varon' FROM numbers WHERE n <= 12
UNION ALL SELECT printf('mujer/%02d', n), 'mujer' FROM numbers;

-- Down
DROP TABLE guestAvatars;
