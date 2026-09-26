CREATE TABLE votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_name TEXT NOT NULL,
  winner TEXT NOT NULL,
  loser TEXT NOT NULL,
  session TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX votes_set ON votes (set_name, id);
