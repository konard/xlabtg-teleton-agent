-- Migration 1.23.0: Policy Engine state persistence (issue #256)
-- Adds a per-task table that stores PolicyEngine sliding-window state
-- (rate-limit timestamps, loop-detection recent actions, uncertainty counter)
-- so pause/resume cycles cannot bypass policy windows.

CREATE TABLE IF NOT EXISTS policy_state (
  task_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT '{}',           -- JSON: PolicyEngineState
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (task_id) REFERENCES autonomous_tasks(id) ON DELETE CASCADE
);

-- Update schema version
UPDATE meta SET value = '1.23.0', updated_at = unixepoch() WHERE key = 'schema_version';
