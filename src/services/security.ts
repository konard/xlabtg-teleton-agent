// ── Security Settings Service ─────────────────────────────────────────────────
// Persists and applies security-related configuration:
//   - Session timeout
//   - IP allowlist
//   - Rate limiting
//   - Password / API key management

import type { Database } from "better-sqlite3";

export interface SecuritySettings {
  session_timeout_minutes: number | null; // null = never
  ip_allowlist: string[]; // empty = allow all
  rate_limit_rpm: number | null; // max requests/minute from web UI; null = off
}

const DEFAULT_SETTINGS: SecuritySettings = {
  session_timeout_minutes: null,
  ip_allowlist: [],
  rate_limit_rpm: null,
};

export class SecurityService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS security_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private getVal(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM security_settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  private setVal(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO security_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(key, value);
  }

  getSettings(): SecuritySettings {
    const timeout = this.getVal("session_timeout_minutes");
    const allowlist = this.getVal("ip_allowlist");
    const rateLimit = this.getVal("rate_limit_rpm");

    return {
      session_timeout_minutes:
        timeout !== null ? Number(timeout) : DEFAULT_SETTINGS.session_timeout_minutes,
      ip_allowlist: allowlist ? (JSON.parse(allowlist) as string[]) : DEFAULT_SETTINGS.ip_allowlist,
      rate_limit_rpm: rateLimit !== null ? Number(rateLimit) : DEFAULT_SETTINGS.rate_limit_rpm,
    };
  }

  updateSettings(patch: Partial<SecuritySettings>): SecuritySettings {
    if (patch.session_timeout_minutes !== undefined) {
      this.setVal(
        "session_timeout_minutes",
        patch.session_timeout_minutes === null ? "null" : String(patch.session_timeout_minutes)
      );
    }
    if (patch.ip_allowlist !== undefined) {
      this.setVal("ip_allowlist", JSON.stringify(patch.ip_allowlist));
    }
    if (patch.rate_limit_rpm !== undefined) {
      this.setVal(
        "rate_limit_rpm",
        patch.rate_limit_rpm === null ? "null" : String(patch.rate_limit_rpm)
      );
    }
    return this.getSettings();
  }

  /** Check whether an IP address is permitted. Always returns true if allowlist is empty. */
  isIpAllowed(ip: string): boolean {
    const settings = this.getSettings();
    if (!settings.ip_allowlist.length) return true;
    return settings.ip_allowlist.includes(ip);
  }
}

let _instance: SecurityService | null = null;

export function initSecurity(db: Database): SecurityService {
  if (!_instance) {
    _instance = new SecurityService(db);
  }
  return _instance;
}
