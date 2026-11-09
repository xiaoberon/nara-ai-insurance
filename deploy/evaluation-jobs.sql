CREATE TABLE evaluation_jobs (
  id TEXT PRIMARY KEY,
  admission_day TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK(scope IN ('typical','all')),
  total INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'running',
  model TEXT NOT NULL,
  lease TEXT,
  available_at INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE evaluation_rounds (
  job_id TEXT NOT NULL REFERENCES evaluation_jobs(id),
  ordinal INTEGER NOT NULL,
  result TEXT NOT NULL,
  PRIMARY KEY(job_id, ordinal)
);
