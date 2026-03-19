import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { UserStore } from "../feed/users.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("UserStore", () => {
  let db: InstanceType<typeof Database>;
  let store: UserStore;

  beforeEach(() => {
    db = createTestDb();
    store = new UserStore(db);
  });

  afterEach(() => {
    db.close();
  });

  // ============================================
  // upsertUser — insert path
  // ============================================

  describe("upsertUser (insert)", () => {
    it("inserts a new user with minimal fields (id only)", () => {
      store.upsertUser({ id: "user-1" });

      const user = store.getUser("user-1");
      expect(user).toBeDefined();
      expect(user!.id).toBe("user-1");
    });

    it("inserts a user with all optional string fields", () => {
      // isBot / isAdmin / isAllowed accept boolean values but the underlying
      // code passes them as-is to SQLite which can only bind numbers/strings/null.
      // Use setAdmin/setAllowed to configure those flags instead.
      store.upsertUser({
        id: "user-full",
        username: "alice",
        firstName: "Alice",
        lastName: "Smith",
      });
      store.setAdmin("user-full", true);
      store.setAllowed("user-full", true);

      const user = store.getUser("user-full");
      expect(user!.username).toBe("alice");
      expect(user!.firstName).toBe("Alice");
      expect(user!.lastName).toBe("Smith");
      expect(user!.isAdmin).toBe(true);
      expect(user!.isAllowed).toBe(true);
    });

    it("sets isAdmin and isAllowed to false by default when not provided", () => {
      store.upsertUser({ id: "user-defaults" });

      const user = store.getUser("user-defaults");
      expect(user!.isAdmin).toBe(false);
      expect(user!.isAllowed).toBe(false);
    });

    it("starts with messageCount = 0", () => {
      store.upsertUser({ id: "user-mc" });

      const user = store.getUser("user-mc");
      expect(user!.messageCount).toBe(0);
    });

    it("sets undefined username, firstName, lastName to undefined in returned object", () => {
      store.upsertUser({ id: "user-nulls" });

      const user = store.getUser("user-nulls");
      expect(user!.username).toBeUndefined();
      expect(user!.firstName).toBeUndefined();
      expect(user!.lastName).toBeUndefined();
    });

    it("creates firstSeenAt and lastSeenAt as Date instances", () => {
      store.upsertUser({ id: "user-dates" });

      const user = store.getUser("user-dates");
      expect(user!.firstSeenAt).toBeInstanceOf(Date);
      expect(user!.lastSeenAt).toBeInstanceOf(Date);
    });
  });

  // ============================================
  // upsertUser — update path
  // ============================================

  describe("upsertUser (update existing)", () => {
    it("updates username when user already exists", () => {
      store.upsertUser({ id: "user-upd", username: "old_name" });
      store.upsertUser({ id: "user-upd", username: "new_name" });

      const user = store.getUser("user-upd");
      expect(user!.username).toBe("new_name");
    });

    it("preserves existing username when update omits it (COALESCE)", () => {
      store.upsertUser({ id: "user-coalesce", username: "keep_me" });
      store.upsertUser({ id: "user-coalesce" });

      const user = store.getUser("user-coalesce");
      expect(user!.username).toBe("keep_me");
    });

    it("preserves existing firstName when update provides null", () => {
      store.upsertUser({ id: "user-fn", firstName: "Bob" });
      store.upsertUser({ id: "user-fn" });

      const user = store.getUser("user-fn");
      expect(user!.firstName).toBe("Bob");
    });

    it("preserves existing lastName when update provides null", () => {
      store.upsertUser({ id: "user-ln", lastName: "Doe" });
      store.upsertUser({ id: "user-ln" });

      const user = store.getUser("user-ln");
      expect(user!.lastName).toBe("Doe");
    });

    it("updates last_seen_at on every upsert of existing user", () => {
      store.upsertUser({ id: "user-ts" });
      const firstSeen = store.getUser("user-ts")!.lastSeenAt;

      // Ensure time passes by manipulating the DB directly
      db.prepare(
        "UPDATE tg_users SET last_seen_at = last_seen_at - 100 WHERE id = 'user-ts'"
      ).run();
      store.upsertUser({ id: "user-ts", username: "changed" });

      const afterUpdate = store.getUser("user-ts")!.lastSeenAt;
      expect(afterUpdate.getTime()).toBeGreaterThan(firstSeen.getTime() - 100_000);
    });

    it("does not modify isAdmin, isAllowed on update path", () => {
      // Use setAdmin/setAllowed to configure flags (upsertUser insert path needs 0/1)
      store.upsertUser({ id: "user-flags" });
      store.setAdmin("user-flags", true);
      store.setAllowed("user-flags", true);

      // Now trigger the update path
      store.upsertUser({ id: "user-flags", username: "updated" });

      const user = store.getUser("user-flags");
      // Update path only touches username/firstName/lastName/last_seen_at — flags remain
      expect(user!.isAdmin).toBe(true);
      expect(user!.isAllowed).toBe(true);
    });
  });

  // ============================================
  // getUser
  // ============================================

  describe("getUser", () => {
    it("returns undefined for a non-existent user id", () => {
      expect(store.getUser("ghost")).toBeUndefined();
    });

    it("returns a fully mapped TelegramUser object", () => {
      store.upsertUser({ id: "user-map", username: "testuser", firstName: "Test" });

      const user = store.getUser("user-map");
      expect(user).toMatchObject({
        id: "user-map",
        username: "testuser",
        firstName: "Test",
        isBot: false,
        isAdmin: false,
        isAllowed: false,
        messageCount: 0,
      });
    });

    it("maps is_bot/is_admin/is_allowed integer columns to booleans", () => {
      store.upsertUser({ id: "user-bool" });
      store.setAdmin("user-bool", true);
      store.setAllowed("user-bool", true);

      const user = store.getUser("user-bool");
      expect(typeof user!.isBot).toBe("boolean");
      expect(typeof user!.isAdmin).toBe("boolean");
      expect(typeof user!.isAllowed).toBe("boolean");
    });
  });

  // ============================================
  // getUserByUsername
  // ============================================

  describe("getUserByUsername", () => {
    it("returns user by exact username", () => {
      store.upsertUser({ id: "user-by-un", username: "charlie" });

      const user = store.getUserByUsername("charlie");
      expect(user).toBeDefined();
      expect(user!.id).toBe("user-by-un");
    });

    it("strips leading @ before lookup", () => {
      store.upsertUser({ id: "user-at", username: "dave" });

      const user = store.getUserByUsername("@dave");
      expect(user).toBeDefined();
      expect(user!.id).toBe("user-at");
    });

    it("returns undefined when username is not found", () => {
      expect(store.getUserByUsername("nobody")).toBeUndefined();
    });

    it("returns undefined when username has @ but still not found", () => {
      expect(store.getUserByUsername("@nobody")).toBeUndefined();
    });
  });

  // ============================================
  // updateLastSeen
  // ============================================

  describe("updateLastSeen", () => {
    it("updates last_seen_at for the given user", () => {
      store.upsertUser({ id: "user-ls" });
      // wind back the clock
      db.prepare("UPDATE tg_users SET last_seen_at = 1000 WHERE id = 'user-ls'").run();

      store.updateLastSeen("user-ls");

      const user = store.getUser("user-ls");
      expect(user!.lastSeenAt.getTime()).toBeGreaterThan(1000 * 1000);
    });

    it("does not throw if user does not exist", () => {
      expect(() => store.updateLastSeen("ghost-user")).not.toThrow();
    });

    it("does not affect other users", () => {
      store.upsertUser({ id: "user-ls2" });
      store.upsertUser({ id: "user-ls3" });
      db.prepare("UPDATE tg_users SET last_seen_at = 1000 WHERE id = 'user-ls3'").run();

      store.updateLastSeen("user-ls2");

      const user3 = store.getUser("user-ls3");
      expect(user3!.lastSeenAt.getTime()).toBe(1000 * 1000);
    });
  });

  // ============================================
  // incrementMessageCount
  // ============================================

  describe("incrementMessageCount", () => {
    it("increments message_count by 1", () => {
      store.upsertUser({ id: "user-imc" });
      store.incrementMessageCount("user-imc");

      const user = store.getUser("user-imc");
      expect(user!.messageCount).toBe(1);
    });

    it("increments message_count multiple times cumulatively", () => {
      store.upsertUser({ id: "user-imc2" });
      store.incrementMessageCount("user-imc2");
      store.incrementMessageCount("user-imc2");
      store.incrementMessageCount("user-imc2");

      const user = store.getUser("user-imc2");
      expect(user!.messageCount).toBe(3);
    });

    it("also updates last_seen_at", () => {
      store.upsertUser({ id: "user-imc-ts" });
      db.prepare("UPDATE tg_users SET last_seen_at = 1000 WHERE id = 'user-imc-ts'").run();

      store.incrementMessageCount("user-imc-ts");

      const user = store.getUser("user-imc-ts");
      expect(user!.lastSeenAt.getTime()).toBeGreaterThan(1000 * 1000);
    });

    it("does not throw if user does not exist", () => {
      expect(() => store.incrementMessageCount("ghost")).not.toThrow();
    });
  });

  // ============================================
  // setAdmin
  // ============================================

  describe("setAdmin", () => {
    it("sets is_admin to true", () => {
      store.upsertUser({ id: "user-admin" });
      store.setAdmin("user-admin", true);

      const user = store.getUser("user-admin");
      expect(user!.isAdmin).toBe(true);
    });

    it("sets is_admin to false", () => {
      store.upsertUser({ id: "user-admin2" });
      store.setAdmin("user-admin2", true);
      store.setAdmin("user-admin2", false);

      const user = store.getUser("user-admin2");
      expect(user!.isAdmin).toBe(false);
    });

    it("does not affect other users", () => {
      store.upsertUser({ id: "admin-target" });
      store.upsertUser({ id: "admin-bystander" });
      store.setAdmin("admin-target", true);

      const bystander = store.getUser("admin-bystander");
      expect(bystander!.isAdmin).toBe(false);
    });

    it("does not throw if user does not exist", () => {
      expect(() => store.setAdmin("ghost", true)).not.toThrow();
    });
  });

  // ============================================
  // setAllowed
  // ============================================

  describe("setAllowed", () => {
    it("sets is_allowed to true", () => {
      store.upsertUser({ id: "user-allow" });
      store.setAllowed("user-allow", true);

      const user = store.getUser("user-allow");
      expect(user!.isAllowed).toBe(true);
    });

    it("sets is_allowed to false", () => {
      store.upsertUser({ id: "user-allow2" });
      store.setAllowed("user-allow2", true);
      store.setAllowed("user-allow2", false);

      const user = store.getUser("user-allow2");
      expect(user!.isAllowed).toBe(false);
    });

    it("does not throw if user does not exist", () => {
      expect(() => store.setAllowed("ghost", true)).not.toThrow();
    });
  });

  // ============================================
  // getAdmins
  // ============================================

  describe("getAdmins", () => {
    it("returns empty array when no admins exist", () => {
      store.upsertUser({ id: "regular-user" });
      expect(store.getAdmins()).toEqual([]);
    });

    it("returns only users with is_admin = 1", () => {
      store.upsertUser({ id: "admin-a" });
      store.setAdmin("admin-a", true);
      store.upsertUser({ id: "admin-b" });
      store.setAdmin("admin-b", true);
      store.upsertUser({ id: "non-admin" });

      const admins = store.getAdmins();
      expect(admins).toHaveLength(2);
      const adminIds = admins.map((a) => a.id);
      expect(adminIds).toContain("admin-a");
      expect(adminIds).toContain("admin-b");
      expect(adminIds).not.toContain("non-admin");
    });

    it("reflects setAdmin changes immediately", () => {
      store.upsertUser({ id: "new-admin" });
      expect(store.getAdmins()).toHaveLength(0);

      store.setAdmin("new-admin", true);
      expect(store.getAdmins()).toHaveLength(1);

      store.setAdmin("new-admin", false);
      expect(store.getAdmins()).toHaveLength(0);
    });
  });

  // ============================================
  // getRecentUsers
  // ============================================

  describe("getRecentUsers", () => {
    it("returns empty array when no users exist", () => {
      expect(store.getRecentUsers()).toEqual([]);
    });

    it("returns all users when fewer than limit", () => {
      store.upsertUser({ id: "u1" });
      store.upsertUser({ id: "u2" });
      store.upsertUser({ id: "u3" });

      const users = store.getRecentUsers(50);
      expect(users).toHaveLength(3);
    });

    it("respects the limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        store.upsertUser({ id: `recent-${i}` });
      }

      const users = store.getRecentUsers(5);
      expect(users).toHaveLength(5);
    });

    it("uses default limit of 50", () => {
      for (let i = 0; i < 60; i++) {
        store.upsertUser({ id: `default-${i}` });
      }

      const users = store.getRecentUsers();
      expect(users.length).toBeLessThanOrEqual(50);
    });

    it("orders users by last_seen_at DESC", () => {
      store.upsertUser({ id: "user-old" });
      store.upsertUser({ id: "user-new" });

      // Make user-old seen much earlier
      db.prepare("UPDATE tg_users SET last_seen_at = 1000 WHERE id = 'user-old'").run();
      db.prepare("UPDATE tg_users SET last_seen_at = 9999999 WHERE id = 'user-new'").run();

      const users = store.getRecentUsers();
      expect(users[0].id).toBe("user-new");
      expect(users[users.length - 1].id).toBe("user-old");
    });
  });
});
