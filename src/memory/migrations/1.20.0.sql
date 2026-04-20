-- Migration 1.20.0: Autonomous Task Engine (ATE)
-- Adds tables for autonomous_tasks, task_checkpoints, and execution_logs

-- Autonomous tasks table
CREATE TABLE IF NOT EXISTS autonomous_tasks (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  success_criteria TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  failure_conditions TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  constraints TEXT NOT NULL DEFAULT '{}',          -- JSON object
  strategy TEXT NOT NULL DEFAULT 'balanced'
    CHECK(strategy IN ('conservative', 'balanced', 'aggressive')),
  retry_policy TEXT NOT NULL DEFAULT '{}',         -- JSON: {maxRetries, backoff}
  context TEXT NOT NULL DEFAULT '{}',              -- JSON object
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK(priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  current_step INTEGER NOT NULL DEFAULT 0,
  last_checkpoint_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  result TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_auto_tasks_status ON autonomous_tasks(status);
CREATE INDEX IF NOT EXISTS idx_auto_tasks_priority ON autonomous_tasks(priority, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_auto_tasks_created ON autonomous_tasks(created_at DESC);

-- Task checkpoints table (persistence & recovery)
CREATE TABLE IF NOT EXISTS task_checkpoints (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT '{}',      -- JSON: serialized execution context
  tool_calls TEXT NOT NULL DEFAULT '[]', -- JSON array of ToolCall records
  next_action_hint TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (task_id) REFERENCES autonomous_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON task_checkpoints(task_id, step DESC);

-- Execution log entries
CREATE TABLE IF NOT EXISTS execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  event_type TEXT NOT NULL
    CHECK(event_type IN ('plan', 'tool_call', 'tool_result', 'reflect', 'checkpoint', 'escalate', 'error', 'info')),
  message TEXT NOT NULL,
  data TEXT,  -- JSON payload
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (task_id) REFERENCES autonomous_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exec_logs_task ON execution_logs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_logs_type ON execution_logs(event_type);

-- Update schema version
UPDATE meta SET value = '1.20.0', updated_at = unixepoch() WHERE key = 'schema_version';
