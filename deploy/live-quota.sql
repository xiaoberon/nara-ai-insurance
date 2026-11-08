CREATE TABLE live_quota (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  day TEXT NOT NULL,
  runs INTEGER NOT NULL,
  unlock_at INTEGER NOT NULL,
  lease TEXT NOT NULL
);
