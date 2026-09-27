-- People, identified by the name they give at login (invite links pre-fill it).
-- From here on the `session` column in votes, tiers and stars holds users.id.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,       -- lowercased, whitespace-collapsed name
  invite TEXT,                         -- ?invite= label of the link they first arrived with
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), -- first login: when they began
  finished_at INTEGER,                 -- first time they confirmed their favorites
  last_seen_at INTEGER,
  active_seconds INTEGER NOT NULL DEFAULT 0 -- time with the site open and in view
);

-- One row per login, with Cloudflare's IP-based location for it.
CREATE TABLE logins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  invite TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  latitude REAL,
  longitude REAL,
  timezone TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX logins_user ON logins (user_id, id);
