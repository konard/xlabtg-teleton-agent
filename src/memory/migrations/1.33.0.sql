CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  session_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  parent_event_id TEXT,
  previous_checksum TEXT,
  checksum TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (parent_event_id) REFERENCES audit_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_session ON audit_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_parent ON audit_events(parent_event_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_sequence ON audit_events(sequence);
