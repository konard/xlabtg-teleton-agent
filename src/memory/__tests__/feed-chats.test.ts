import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { ChatStore } from "../feed/chats.js";

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

describe("ChatStore", () => {
  let db: InstanceType<typeof Database>;
  let store: ChatStore;

  beforeEach(() => {
    db = createTestDb();
    store = new ChatStore(db);
  });

  afterEach(() => {
    db.close();
  });

  // ============================================
  // upsertChat
  // ============================================

  describe("upsertChat", () => {
    it("inserts a new DM chat with minimal fields", () => {
      store.upsertChat({ id: "chat-1", type: "dm" });

      const chat = store.getChat("chat-1");
      expect(chat).toBeDefined();
      expect(chat!.id).toBe("chat-1");
      expect(chat!.type).toBe("dm");
    });

    it("inserts a group chat with title, username, memberCount, and lastMessageAt", () => {
      const lastAt = new Date(2024, 0, 15, 12, 0, 0);
      store.upsertChat({
        id: "group-1",
        type: "group",
        title: "My Group",
        username: "mygroup",
        memberCount: 42,
        lastMessageId: "msg-99",
        lastMessageAt: lastAt,
      });

      const chat = store.getChat("group-1");
      expect(chat).toBeDefined();
      expect(chat!.title).toBe("My Group");
      expect(chat!.username).toBe("mygroup");
      expect(chat!.memberCount).toBe(42);
      expect(chat!.lastMessageId).toBe("msg-99");
      expect(chat!.lastMessageAt).toEqual(new Date(Math.floor(lastAt.getTime() / 1000) * 1000));
    });

    it("inserts a channel chat type", () => {
      store.upsertChat({ id: "channel-1", type: "channel", title: "News Channel" });

      const chat = store.getChat("channel-1");
      expect(chat!.type).toBe("channel");
      expect(chat!.title).toBe("News Channel");
    });

    it("updates existing chat title on conflict without overwriting other fields", () => {
      store.upsertChat({ id: "chat-2", type: "dm", title: "Original", username: "user1" });
      store.upsertChat({ id: "chat-2", type: "dm", title: "Updated" });

      const chat = store.getChat("chat-2");
      expect(chat!.title).toBe("Updated");
      // username should be preserved (COALESCE keeps existing when new is null)
      expect(chat!.username).toBe("user1");
    });

    it("does not overwrite existing title with null on upsert", () => {
      store.upsertChat({ id: "chat-3", type: "dm", title: "Keep Me" });
      store.upsertChat({ id: "chat-3", type: "dm" });

      const chat = store.getChat("chat-3");
      expect(chat!.title).toBe("Keep Me");
    });

    it("does not overwrite existing memberCount with null on upsert", () => {
      store.upsertChat({ id: "chat-4", type: "group", memberCount: 100 });
      store.upsertChat({ id: "chat-4", type: "group" });

      const chat = store.getChat("chat-4");
      expect(chat!.memberCount).toBe(100);
    });

    it("sets isMonitored = true by default when not specified", () => {
      store.upsertChat({ id: "chat-5", type: "dm" });

      const chat = store.getChat("chat-5");
      expect(chat!.isMonitored).toBe(true);
    });

    it("sets isArchived = false by default when not specified", () => {
      store.upsertChat({ id: "chat-6", type: "dm" });

      const chat = store.getChat("chat-6");
      expect(chat!.isArchived).toBe(false);
    });

    it("sets optional title, username, memberCount to undefined when not provided", () => {
      store.upsertChat({ id: "chat-7", type: "dm" });

      const chat = store.getChat("chat-7");
      expect(chat!.title).toBeUndefined();
      expect(chat!.username).toBeUndefined();
      expect(chat!.memberCount).toBeUndefined();
    });

    it("persists lastMessageAt as undefined when not provided", () => {
      store.upsertChat({ id: "chat-8", type: "dm" });

      const chat = store.getChat("chat-8");
      expect(chat!.lastMessageAt).toBeUndefined();
      expect(chat!.lastMessageId).toBeUndefined();
    });

    it("correctly serializes and deserializes lastMessageAt as Date (unix-second precision)", () => {
      const ts = new Date(2025, 5, 20, 10, 30, 0);
      store.upsertChat({ id: "chat-9", type: "dm", lastMessageAt: ts });

      const chat = store.getChat("chat-9");
      // Stored as Unix seconds, so sub-second precision is lost
      expect(chat!.lastMessageAt!.getTime()).toBe(Math.floor(ts.getTime() / 1000) * 1000);
    });

    it("does not overwrite existing lastMessageId when omitted on upsert", () => {
      store.upsertChat({ id: "chat-lmi", type: "dm", lastMessageId: "msg-orig" });
      store.upsertChat({ id: "chat-lmi", type: "dm" });

      const chat = store.getChat("chat-lmi");
      expect(chat!.lastMessageId).toBe("msg-orig");
    });
  });

  // ============================================
  // getChat
  // ============================================

  describe("getChat", () => {
    it("returns undefined for non-existent chat id", () => {
      const result = store.getChat("does-not-exist");
      expect(result).toBeUndefined();
    });

    it("returns a fully mapped TelegramChat object", () => {
      store.upsertChat({ id: "chat-10", type: "group", title: "Test Group" });

      const chat = store.getChat("chat-10");
      expect(chat).toMatchObject({
        id: "chat-10",
        type: "group",
        title: "Test Group",
        isMonitored: true,
        isArchived: false,
      });
      expect(chat!.createdAt).toBeInstanceOf(Date);
      expect(chat!.updatedAt).toBeInstanceOf(Date);
    });

    it("maps is_monitored integer 1 to boolean true", () => {
      store.upsertChat({ id: "chat-11", type: "dm" });
      const chat = store.getChat("chat-11");
      expect(typeof chat!.isMonitored).toBe("boolean");
      expect(chat!.isMonitored).toBe(true);
    });

    it("maps is_archived integer 0 to boolean false", () => {
      store.upsertChat({ id: "chat-12", type: "dm" });
      const chat = store.getChat("chat-12");
      expect(typeof chat!.isArchived).toBe("boolean");
      expect(chat!.isArchived).toBe(false);
    });

    it("maps is_archived integer 1 (set via archiveChat) to boolean true", () => {
      store.upsertChat({ id: "chat-arch-get", type: "dm" });
      store.archiveChat("chat-arch-get");
      const chat = store.getChat("chat-arch-get");
      expect(typeof chat!.isArchived).toBe("boolean");
      expect(chat!.isArchived).toBe(true);
    });
  });

  // ============================================
  // getActiveChats
  // ============================================

  describe("getActiveChats", () => {
    it("returns empty array when no chats exist", () => {
      expect(store.getActiveChats()).toEqual([]);
    });

    it("returns only monitored and non-archived chats", () => {
      store.upsertChat({ id: "active-1", type: "dm" });
      store.upsertChat({ id: "archived-1", type: "dm" });
      store.upsertChat({ id: "unmonitored-1", type: "dm" });

      store.archiveChat("archived-1");
      store.setMonitored("unmonitored-1", false);

      const chats = store.getActiveChats();
      expect(chats).toHaveLength(1);
      expect(chats[0].id).toBe("active-1");
    });

    it("respects the limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        store.upsertChat({ id: `chat-limit-${i}`, type: "dm" });
      }

      const chats = store.getActiveChats(3);
      expect(chats).toHaveLength(3);
    });

    it("uses default limit of 50", () => {
      for (let i = 0; i < 60; i++) {
        store.upsertChat({ id: `chat-default-${i}`, type: "dm" });
      }

      const chats = store.getActiveChats();
      expect(chats.length).toBeLessThanOrEqual(50);
    });

    it("orders chats by last_message_at DESC NULLS LAST", () => {
      const ts1 = new Date(2025, 0, 1);
      const ts2 = new Date(2025, 0, 3);

      store.upsertChat({ id: "older", type: "dm", lastMessageAt: ts1 });
      store.upsertChat({ id: "newer", type: "dm", lastMessageAt: ts2 });
      store.upsertChat({ id: "no-message", type: "dm" });

      const chats = store.getActiveChats();
      const ids = chats.map((c) => c.id);
      // newer first, no-message last
      expect(ids[0]).toBe("newer");
      expect(ids[ids.length - 1]).toBe("no-message");
    });

    it("includes chats where lastMessageAt is null (placed last)", () => {
      store.upsertChat({ id: "with-ts", type: "dm", lastMessageAt: new Date(2025, 0, 1) });
      store.upsertChat({ id: "without-ts", type: "dm" });

      const chats = store.getActiveChats();
      expect(chats.map((c) => c.id)).toContain("without-ts");
    });
  });

  // ============================================
  // updateLastMessage
  // ============================================

  describe("updateLastMessage", () => {
    it("updates last_message_id and last_message_at on an existing chat", () => {
      store.upsertChat({ id: "chat-upd", type: "dm" });

      const ts = new Date(2025, 3, 10, 8, 0, 0);
      store.updateLastMessage("chat-upd", "msg-42", ts);

      const chat = store.getChat("chat-upd");
      expect(chat!.lastMessageId).toBe("msg-42");
      expect(chat!.lastMessageAt!.getTime()).toBe(Math.floor(ts.getTime() / 1000) * 1000);
    });

    it("overwrites a previously set lastMessageId", () => {
      store.upsertChat({ id: "chat-upd2", type: "dm", lastMessageId: "old-msg" });
      store.updateLastMessage("chat-upd2", "new-msg", new Date());

      const chat = store.getChat("chat-upd2");
      expect(chat!.lastMessageId).toBe("new-msg");
    });

    it("does nothing if chatId does not exist (no error thrown)", () => {
      expect(() => store.updateLastMessage("non-existent", "msg-1", new Date())).not.toThrow();
    });
  });

  // ============================================
  // archiveChat / unarchiveChat
  // ============================================

  describe("archiveChat", () => {
    it("sets is_archived = 1 for the given chat", () => {
      store.upsertChat({ id: "chat-arch", type: "dm" });
      store.archiveChat("chat-arch");

      const chat = store.getChat("chat-arch");
      expect(chat!.isArchived).toBe(true);
    });

    it("does not affect other chats", () => {
      store.upsertChat({ id: "chat-arch2", type: "dm" });
      store.upsertChat({ id: "chat-other", type: "dm" });
      store.archiveChat("chat-arch2");

      const other = store.getChat("chat-other");
      expect(other!.isArchived).toBe(false);
    });

    it("excludes archived chats from getActiveChats", () => {
      store.upsertChat({ id: "chat-arch3", type: "dm" });
      store.archiveChat("chat-arch3");

      const active = store.getActiveChats();
      expect(active.map((c) => c.id)).not.toContain("chat-arch3");
    });

    it("does nothing if chatId does not exist (no error thrown)", () => {
      expect(() => store.archiveChat("non-existent")).not.toThrow();
    });
  });

  describe("unarchiveChat", () => {
    it("sets is_archived = 0 for a previously archived chat", () => {
      store.upsertChat({ id: "chat-unarch", type: "dm" });
      store.archiveChat("chat-unarch");
      store.unarchiveChat("chat-unarch");

      const chat = store.getChat("chat-unarch");
      expect(chat!.isArchived).toBe(false);
    });

    it("makes a previously archived chat reappear in getActiveChats", () => {
      store.upsertChat({ id: "chat-reappear", type: "dm" });
      store.archiveChat("chat-reappear");
      store.unarchiveChat("chat-reappear");

      const active = store.getActiveChats();
      expect(active.map((c) => c.id)).toContain("chat-reappear");
    });

    it("does not affect other chats", () => {
      store.upsertChat({ id: "chat-a", type: "dm" });
      store.upsertChat({ id: "chat-b", type: "dm" });
      store.archiveChat("chat-a");
      store.archiveChat("chat-b");
      store.unarchiveChat("chat-a");

      const b = store.getChat("chat-b");
      expect(b!.isArchived).toBe(true);
    });
  });

  // ============================================
  // setMonitored
  // ============================================

  describe("setMonitored", () => {
    it("sets monitored to false", () => {
      store.upsertChat({ id: "chat-mon", type: "dm" });
      store.setMonitored("chat-mon", false);

      const chat = store.getChat("chat-mon");
      expect(chat!.isMonitored).toBe(false);
    });

    it("sets monitored back to true", () => {
      store.upsertChat({ id: "chat-mon2", type: "dm" });
      store.setMonitored("chat-mon2", false);
      store.setMonitored("chat-mon2", true);

      const chat = store.getChat("chat-mon2");
      expect(chat!.isMonitored).toBe(true);
    });

    it("excludes unmonitored chats from getActiveChats", () => {
      store.upsertChat({ id: "monitored", type: "dm" });
      store.upsertChat({ id: "unmonitored", type: "dm" });
      store.setMonitored("unmonitored", false);

      const active = store.getActiveChats();
      expect(active.map((c) => c.id)).not.toContain("unmonitored");
    });

    it("includes re-monitored chats in getActiveChats", () => {
      store.upsertChat({ id: "re-monitor", type: "dm" });
      store.setMonitored("re-monitor", false);
      store.setMonitored("re-monitor", true);

      const active = store.getActiveChats();
      expect(active.map((c) => c.id)).toContain("re-monitor");
    });

    it("does nothing if chatId does not exist (no error thrown)", () => {
      expect(() => store.setMonitored("non-existent", false)).not.toThrow();
    });
  });
});
