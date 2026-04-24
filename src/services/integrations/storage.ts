import type Database from "better-sqlite3";

export function ensureIntegrationTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('api', 'webhook', 'oauth', 'mcp')),
      provider TEXT NOT NULL DEFAULT 'custom-http',
      config TEXT NOT NULL DEFAULT '{}',
      auth TEXT NOT NULL DEFAULT '{"type":"none"}',
      auth_id TEXT,
      status TEXT NOT NULL DEFAULT 'unconfigured'
        CHECK(status IN ('unknown', 'healthy', 'degraded', 'unhealthy', 'unconfigured')),
      health_check_url TEXT,
      last_health_at INTEGER,
      last_health_message TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_integrations_type ON integrations(type);
    CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider);
    CREATE INDEX IF NOT EXISTS idx_integrations_status ON integrations(status);
    CREATE INDEX IF NOT EXISTS idx_integrations_updated ON integrations(updated_at DESC);

    CREATE TABLE IF NOT EXISTS integration_credentials (
      id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL,
      auth_type TEXT NOT NULL
        CHECK(auth_type IN ('none', 'api_key', 'oauth2', 'jwt', 'basic', 'custom_header')),
      credentials_encrypted TEXT NOT NULL,
      expires_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_integration_credentials_integration
      ON integration_credentials(integration_id);
    CREATE INDEX IF NOT EXISTS idx_integration_credentials_expires
      ON integration_credentials(expires_at) WHERE expires_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS integration_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id TEXT NOT NULL,
      action TEXT NOT NULL,
      success INTEGER NOT NULL CHECK(success IN (0, 1)),
      latency_ms INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_integration_usage_integration
      ON integration_usage(integration_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_integration_usage_action
      ON integration_usage(action);
  `);
}
