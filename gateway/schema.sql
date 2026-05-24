-- ============================================================================
-- Gateway Database Schema
-- Authentication & Configuration Management
-- ============================================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                    -- UUID
  username TEXT UNIQUE NOT NULL,          -- Unique username
  password_hash TEXT NOT NULL,            -- bcrypt hash
  email TEXT UNIQUE,                      -- Optional email
  created_at INTEGER NOT NULL,            -- Unix timestamp
  last_login INTEGER                      -- Unix timestamp
);

-- Refresh tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,                    -- UUID
  user_id TEXT NOT NULL,                  -- Foreign key to users
  token_hash TEXT NOT NULL,               -- SHA-256 hash
  expires_at INTEGER NOT NULL,            -- Unix timestamp
  device_info TEXT,                       -- JSON string
  created_at INTEGER NOT NULL,            -- Unix timestamp
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- AI configurations table (encrypted)
CREATE TABLE IF NOT EXISTS ai_configs (
  id TEXT PRIMARY KEY,                    -- UUID
  user_id TEXT NOT NULL,                  -- Foreign key to users
  provider TEXT NOT NULL,                 -- 'openai', 'claude', 'newma', 'newmaweb'
  config_name TEXT NOT NULL,              -- 'default', 'work', 'personal'
  api_key_encrypted TEXT NOT NULL,        -- AES-256-GCM encrypted (base64)
  base_url TEXT,                          -- Optional custom endpoint
  model TEXT,                             -- Model name
  newma_path TEXT,                        -- For newma provider
  workspace_dir TEXT,                     -- For newma provider
  created_at INTEGER NOT NULL,            -- Unix timestamp
  updated_at INTEGER NOT NULL,            -- Unix timestamp
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, config_name)
);

-- Process tracking table (for restart mechanism)
CREATE TABLE IF NOT EXISTS processes (
  id TEXT PRIMARY KEY,                    -- UUID
  user_id TEXT NOT NULL,                  -- Foreign key to users
  process_type TEXT NOT NULL,             -- 'chat', 'agent', 'indexing'
  session_key TEXT NOT NULL,              -- Session identifier
  status TEXT NOT NULL,                   -- 'running', 'paused', 'completed'
  pid INTEGER,                            -- OS process ID
  metadata TEXT,                          -- JSON: {runId, messageId, ...}
  created_at INTEGER NOT NULL,            -- Unix timestamp
  updated_at INTEGER NOT NULL,            -- Unix timestamp
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Exploration tasks table (for autonomous exploration monitoring)
CREATE TABLE IF NOT EXISTS exploration_tasks (
  id TEXT PRIMARY KEY,                    -- Task ID (from Kode CLI)
  status TEXT NOT NULL,                   -- 'pending', 'running', 'completed', 'failed'
  plan TEXT,                              -- JSON: generated plan
  execution_log TEXT,                     -- JSON: detailed execution log
  result_summary TEXT,                    -- JSON: summary, insights, recommendations
  started_at INTEGER,                     -- Unix timestamp
  completed_at INTEGER,                   -- Unix timestamp
  created_at INTEGER NOT NULL,            -- Unix timestamp
  updated_at INTEGER NOT NULL             -- Unix timestamp
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_configs_user ON ai_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_processes_user ON processes(user_id);
CREATE INDEX IF NOT EXISTS idx_processes_status ON processes(status);
CREATE INDEX IF NOT EXISTS idx_exploration_tasks_status ON exploration_tasks(status);
CREATE INDEX IF NOT EXISTS idx_exploration_tasks_created ON exploration_tasks(created_at);
