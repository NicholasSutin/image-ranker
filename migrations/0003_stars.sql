-- Each session's absolute favorites, picked on the results page once it has ranked every image.
CREATE TABLE stars (
  set_name TEXT NOT NULL,
  image TEXT NOT NULL,
  session TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (set_name, session, image)
);
