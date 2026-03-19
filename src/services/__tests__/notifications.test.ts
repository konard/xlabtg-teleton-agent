import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { getNotificationService } from "../notifications.js";
import type { NotificationType } from "../notifications.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  return new Database(":memory:");
}

// ── getNotificationService() tests ─────────────────────────────────────────────

describe("getNotificationService", () => {
  let db: Database.Database;
  let svc: ReturnType<typeof getNotificationService>;

  beforeEach(() => {
    db = createTestDb();
    svc = getNotificationService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── Table creation ────────────────────────────────────────────────────────────

  it("creates the notifications table on init", () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'`)
      .get();
    expect(row).toBeDefined();
  });

  // ── add() ─────────────────────────────────────────────────────────────────────

  describe("add()", () => {
    it("returns a Notification object with expected fields", () => {
      const n = svc.add("info", "Test Title", "Test message");

      expect(typeof n.id).toBe("string");
      expect(n.type).toBe("info");
      expect(n.title).toBe("Test Title");
      expect(n.message).toBe("Test message");
      expect(n.read).toBe(false);
      expect(typeof n.createdAt).toBe("number");
    });

    it("persists the notification to the database", () => {
      const n = svc.add("error", "Error occurred", "Something went wrong");

      const row = db.prepare("SELECT * FROM notifications WHERE id = ?").get(n.id) as Record<
        string,
        unknown
      >;
      expect(row).toBeDefined();
      expect(row.type).toBe("error");
      expect(row.title).toBe("Error occurred");
      expect(row.message).toBe("Something went wrong");
      expect(row.read).toBe(0);
    });

    it("accepts all valid notification types", () => {
      const types: NotificationType[] = ["error", "warning", "info", "achievement"];
      for (const type of types) {
        const n = svc.add(type, `${type} title`, `${type} message`);
        expect(n.type).toBe(type);
      }
    });

    it("generates unique ids for each notification", () => {
      const n1 = svc.add("info", "a", "a");
      const n2 = svc.add("info", "b", "b");
      expect(n1.id).not.toBe(n2.id);
    });

    it("sets createdAt to approximately current time", () => {
      const before = Date.now() - 100;
      const n = svc.add("info", "Timing test", "msg");
      const after = Date.now() + 100;
      expect(n.createdAt).toBeGreaterThanOrEqual(before);
      expect(n.createdAt).toBeLessThanOrEqual(after);
    });

    it("enforces MAX_NOTIFICATIONS limit (500) by deleting oldest", () => {
      // Insert 501 notifications — the oldest should be pruned
      for (let i = 0; i < 501; i++) {
        // Use direct DB inserts for speed, then one via svc to trigger the pruning
        db.prepare(
          `INSERT INTO notifications (id, type, title, message, read, created_at)
           VALUES (?, 'info', 'title', 'msg', 0, ?)`
        ).run(`bulk-${i}`, i); // older created_at = smaller i
      }

      // Calling add triggers the DELETE of excess rows
      svc.add("info", "trigger prune", "msg");

      const count = (db.prepare("SELECT COUNT(*) as c FROM notifications").get() as { c: number })
        .c;
      expect(count).toBeLessThanOrEqual(500);
    });
  });

  // ── list() ────────────────────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns empty array when no notifications exist", () => {
      const result = svc.list();
      expect(result).toEqual([]);
    });

    it("returns all notifications ordered by created_at DESC", () => {
      const n1 = svc.add("info", "First", "msg1");
      const n2 = svc.add("warning", "Second", "msg2");

      const result = svc.list();
      expect(result.length).toBe(2);
      // Newer should be first (DESC order)
      expect(result[0].createdAt).toBeGreaterThanOrEqual(result[1].createdAt);
    });

    it("maps read field from integer to boolean", () => {
      const n = svc.add("info", "test", "msg");
      svc.markRead(n.id);

      const result = svc.list();
      const found = result.find((r) => r.id === n.id);
      expect(found?.read).toBe(true);
    });

    it("returns all notifications when unreadOnly is false", () => {
      const n1 = svc.add("info", "a", "a");
      const n2 = svc.add("info", "b", "b");
      svc.markRead(n1.id);

      const result = svc.list(false);
      expect(result.length).toBe(2);
    });

    it("returns only unread notifications when unreadOnly is true", () => {
      const n1 = svc.add("info", "unread", "a");
      const n2 = svc.add("info", "read-me", "b");
      svc.markRead(n2.id);

      const result = svc.list(true);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(n1.id);
      expect(result[0].read).toBe(false);
    });

    it("maps all notification fields correctly", () => {
      const n = svc.add("achievement", "Win!", "You did it");

      const result = svc.list();
      const found = result.find((r) => r.id === n.id);
      expect(found).toBeDefined();
      expect(found!.type).toBe("achievement");
      expect(found!.title).toBe("Win!");
      expect(found!.message).toBe("You did it");
      expect(found!.read).toBe(false);
    });
  });

  // ── markRead() ────────────────────────────────────────────────────────────────

  describe("markRead()", () => {
    it("returns true when marking an existing notification as read", () => {
      const n = svc.add("error", "Error", "msg");
      const result = svc.markRead(n.id);
      expect(result).toBe(true);
    });

    it("returns false when the notification id does not exist", () => {
      const result = svc.markRead("nonexistent-id");
      expect(result).toBe(false);
    });

    it("updates the read flag in the database", () => {
      const n = svc.add("warning", "Warn", "msg");
      svc.markRead(n.id);

      const row = db.prepare("SELECT read FROM notifications WHERE id = ?").get(n.id) as {
        read: number;
      };
      expect(row.read).toBe(1);
    });

    it("does not affect other notifications", () => {
      const n1 = svc.add("info", "a", "a");
      const n2 = svc.add("info", "b", "b");
      svc.markRead(n1.id);

      const n2Row = db.prepare("SELECT read FROM notifications WHERE id = ?").get(n2.id) as {
        read: number;
      };
      expect(n2Row.read).toBe(0);
    });
  });

  // ── markAllRead() ─────────────────────────────────────────────────────────────

  describe("markAllRead()", () => {
    it("returns 0 when no unread notifications exist", () => {
      const count = svc.markAllRead();
      expect(count).toBe(0);
    });

    it("returns the number of notifications marked as read", () => {
      svc.add("info", "a", "a");
      svc.add("info", "b", "b");
      svc.add("error", "c", "c");

      const count = svc.markAllRead();
      expect(count).toBe(3);
    });

    it("marks all unread notifications as read", () => {
      svc.add("info", "a", "a");
      svc.add("warning", "b", "b");

      svc.markAllRead();

      const unread = svc.list(true);
      expect(unread.length).toBe(0);
    });

    it("does not double-count already-read notifications", () => {
      const n = svc.add("info", "a", "a");
      svc.add("warning", "b", "b");
      svc.markRead(n.id);

      const count = svc.markAllRead();
      expect(count).toBe(1); // only 1 was still unread
    });
  });

  // ── delete() ──────────────────────────────────────────────────────────────────

  describe("delete()", () => {
    it("returns true when deleting an existing notification", () => {
      const n = svc.add("info", "a", "a");
      const result = svc.delete(n.id);
      expect(result).toBe(true);
    });

    it("returns false when the notification id does not exist", () => {
      const result = svc.delete("nonexistent-id");
      expect(result).toBe(false);
    });

    it("removes the notification from the database", () => {
      const n = svc.add("error", "Delete me", "msg");
      svc.delete(n.id);

      const row = db.prepare("SELECT id FROM notifications WHERE id = ?").get(n.id);
      expect(row).toBeUndefined();
    });

    it("does not affect other notifications", () => {
      const n1 = svc.add("info", "keep", "msg");
      const n2 = svc.add("info", "delete", "msg");
      svc.delete(n2.id);

      const remaining = svc.list();
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(n1.id);
    });
  });

  // ── unreadCount() ─────────────────────────────────────────────────────────────

  describe("unreadCount()", () => {
    it("returns 0 when no notifications exist", () => {
      expect(svc.unreadCount()).toBe(0);
    });

    it("returns 0 when all notifications are read", () => {
      const n1 = svc.add("info", "a", "a");
      const n2 = svc.add("info", "b", "b");
      svc.markAllRead();

      expect(svc.unreadCount()).toBe(0);
    });

    it("returns the correct count of unread notifications", () => {
      svc.add("info", "a", "a");
      svc.add("info", "b", "b");
      const n3 = svc.add("info", "c", "c");
      svc.markRead(n3.id);

      expect(svc.unreadCount()).toBe(2);
    });

    it("updates after marking notifications as read", () => {
      const n1 = svc.add("info", "a", "a");
      const n2 = svc.add("info", "b", "b");

      expect(svc.unreadCount()).toBe(2);
      svc.markRead(n1.id);
      expect(svc.unreadCount()).toBe(1);
      svc.markRead(n2.id);
      expect(svc.unreadCount()).toBe(0);
    });

    it("updates after deleting a notification", () => {
      const n = svc.add("error", "delete me", "msg");
      svc.add("info", "keep me", "msg");

      expect(svc.unreadCount()).toBe(2);
      svc.delete(n.id);
      expect(svc.unreadCount()).toBe(1);
    });
  });
});
