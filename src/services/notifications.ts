import type { Database } from "better-sqlite3";
import { EventEmitter } from "node:events";

export type NotificationType = "error" | "warning" | "info" | "achievement";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: number;
}

const MAX_NOTIFICATIONS = 500;

// Shared emitter for realtime notification badge updates.
export const notificationBus = new EventEmitter();
notificationBus.setMaxListeners(100);

export function getNotificationService(db: Database) {
  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('error', 'warning', 'info', 'achievement')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  return {
    add(type: NotificationType, title: string, message: string): Notification {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const createdAt = Date.now();

      db.prepare(
        `INSERT INTO notifications (id, type, title, message, read, created_at) VALUES (?, ?, ?, ?, 0, ?)`
      ).run(id, type, title, message, createdAt);

      // Enforce max 500 — delete oldest beyond limit
      db.prepare(
        `DELETE FROM notifications WHERE id NOT IN (
          SELECT id FROM notifications ORDER BY created_at DESC LIMIT ?
        )`
      ).run(MAX_NOTIFICATIONS);

      return { id, type, title, message, read: false, createdAt };
    },

    list(unreadOnly = false): Notification[] {
      const query = unreadOnly
        ? `SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC`
        : `SELECT * FROM notifications ORDER BY created_at DESC`;
      const rows = db.prepare(query).all() as Array<{
        id: string;
        type: NotificationType;
        title: string;
        message: string;
        read: number;
        created_at: number;
      }>;
      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        message: r.message,
        read: r.read === 1,
        createdAt: r.created_at,
      }));
    },

    markRead(id: string): boolean {
      const result = db.prepare(`UPDATE notifications SET read = 1 WHERE id = ?`).run(id);
      return result.changes > 0;
    },

    markAllRead(): number {
      const result = db.prepare(`UPDATE notifications SET read = 1 WHERE read = 0`).run();
      return result.changes;
    },

    delete(id: string): boolean {
      const result = db.prepare(`DELETE FROM notifications WHERE id = ?`).run(id);
      return result.changes > 0;
    },

    unreadCount(): number {
      const row = db
        .prepare(`SELECT COUNT(*) as count FROM notifications WHERE read = 0`)
        .get() as { count: number };
      return row.count;
    },
  };
}
