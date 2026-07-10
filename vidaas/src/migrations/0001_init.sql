-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  expiresAt DATETIME
);

-- Chunks table
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  prompt TEXT,
  imagePrompt TEXT,
  videoPrompt TEXT,
  status TEXT DEFAULT 'submitted',
  imageUrl TEXT,
  videoUrl TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sessionId, id),
  FOREIGN KEY (sessionId) REFERENCES sessions(id)
);

-- Tasks table for tracking image/video generation
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunkId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  taskType TEXT,
  status TEXT DEFAULT 'pending',
  resultUrl TEXT,
  errorMessage TEXT,
  errorCode TEXT,
  retryCount INTEGER DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sessionId, chunkId) REFERENCES chunks(sessionId, id)
);

-- Queue jobs tracking
CREATE TABLE IF NOT EXISTS queue_jobs (
  id TEXT PRIMARY KEY,
  chunkId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  jobType TEXT,
  status TEXT DEFAULT 'pending',
  retries INTEGER DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sessionId, chunkId) REFERENCES chunks(sessionId, id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(sessionId);
CREATE INDEX IF NOT EXISTS idx_chunks_status ON chunks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(sessionId);
CREATE INDEX IF NOT EXISTS idx_tasks_chunk ON tasks(chunkId);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_chunk ON queue_jobs(chunkId);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt);
