-- One tier per image per session; re-ranking overwrites.
CREATE TABLE tiers (
  set_name TEXT NOT NULL,
  image TEXT NOT NULL,
  session TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('S', 'A', 'B', 'X')),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (set_name, session, image)
);
