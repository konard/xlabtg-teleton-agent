-- Migration 1.24.0: Add paused_at timestamp to autonomous_tasks (AUDIT-M5)
-- Tracks when a task was paused so the retention job can auto-cancel
-- tasks that have been paused longer than the configured TTL.

ALTER TABLE autonomous_tasks ADD COLUMN paused_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_auto_tasks_paused_at ON autonomous_tasks(paused_at) WHERE paused_at IS NOT NULL;

-- Update schema version
UPDATE meta SET value = '1.24.0', updated_at = unixepoch() WHERE key = 'schema_version';
