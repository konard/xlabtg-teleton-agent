CREATE TABLE IF NOT EXISTS agent_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}',
  soul_template TEXT NOT NULL DEFAULT '',
  tools TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'stopped',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_agent_registry_type ON agent_registry(type);
CREATE INDEX IF NOT EXISTS idx_agent_registry_status ON agent_registry(status);
CREATE INDEX IF NOT EXISTS idx_agent_registry_updated ON agent_registry(updated_at DESC);
