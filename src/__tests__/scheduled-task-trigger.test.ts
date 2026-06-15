import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { TeletonApp } from "../index.js";
import { getDatabase, closeDatabase } from "../memory/database.js";
import { getTaskStore } from "../memory/agent/tasks.js";
import { MessageDedupCache } from "../telegram/message-dedup-cache.js";
import type { TelegramMessage } from "../telegram/bridge.js";

vi.mock("../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  initLoggerFromConfig: vi.fn(),
}));

interface TestApp {
  bridge: {
    getOwnUserId: ReturnType<typeof vi.fn>;
    getClient: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  };
  agent: {
    getToolRegistry: ReturnType<typeof vi.fn>;
    processMessage: ReturnType<typeof vi.fn>;
  };
  config: Record<string, never>;
  dependencyResolver: null;
  messageHandler: { handleMessage: ReturnType<typeof vi.fn> };
  adminHandler: {
    parseCommand: ReturnType<typeof vi.fn>;
    isCommandAllowed: ReturnType<typeof vi.fn>;
    isPaused: ReturnType<typeof vi.fn>;
  };
  scheduledTaskTriggerMessages: MessageDedupCache;
  messagesProcessed: number;
  handleSingleMessage(message: TelegramMessage): Promise<void>;
  handleScheduledTaskTrigger(message: TelegramMessage): Promise<boolean>;
}

function makeMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    id: 501,
    chatId: "192802079",
    senderId: 0,
    text: "hello",
    isGroup: false,
    isChannel: false,
    isBot: false,
    mentionsMe: false,
    timestamp: new Date("2026-05-02T19:00:00Z"),
    hasMedia: false,
    ...overrides,
  };
}

function createApp() {
  const invoke = vi.fn().mockResolvedValue({});
  const gramJsClient = { invoke };
  const bridge = {
    getOwnUserId: vi.fn(() => 192802079n),
    getClient: vi.fn(() => ({
      getClient: () => gramJsClient,
    })),
    sendMessage: vi.fn().mockResolvedValue({
      id: 777,
      date: Math.floor(Date.now() / 1000),
    }),
  };
  const toolRegistry = {
    execute: vi.fn().mockResolvedValue({ success: true, data: { sent: true } }),
  };
  const agent = {
    getToolRegistry: vi.fn(() => toolRegistry),
    processMessage: vi.fn().mockResolvedValue({ content: "Task complete", toolCalls: [] }),
  };

  const app = Object.create(TeletonApp.prototype) as TestApp;
  app.bridge = bridge;
  app.agent = agent;
  app.config = {};
  app.dependencyResolver = null;
  app.messageHandler = { handleMessage: vi.fn().mockResolvedValue(undefined) };
  app.adminHandler = {
    parseCommand: vi.fn().mockReturnValue(undefined),
    isCommandAllowed: vi.fn().mockReturnValue(false),
    isPaused: vi.fn().mockReturnValue(false),
  };
  app.scheduledTaskTriggerMessages = new MessageDedupCache();
  app.messagesProcessed = 0;

  return { app, bridge, agent, toolRegistry, invoke };
}

describe("TeletonApp scheduled task triggers", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "teleton-task-trigger-"));
    getDatabase({
      path: join(tempDir, "memory.db"),
      enableVectorSearch: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("executes a Saved Messages [TASK:] trigger even when Telegram omits senderId", async () => {
    const db = getDatabase().getDb();
    const store = getTaskStore(db);
    const task = store.createTask({
      description: "Send me a reminder",
      payload: JSON.stringify({
        type: "tool_call",
        tool: "telegram_send_message",
        params: { chatId: "192802079", text: "Privet" },
      }),
      scheduledFor: new Date("2026-05-02T19:00:00Z"),
    });
    const { app, agent, toolRegistry, invoke } = createApp();

    await app.handleSingleMessage(
      makeMessage({
        text: `[TASK:${task.id}] Send me a reminder`,
        senderId: 0,
        chatId: "192802079",
      })
    );

    expect(app.messageHandler.handleMessage).not.toHaveBeenCalled();
    expect(toolRegistry.execute).toHaveBeenCalledWith(
      {
        type: "toolCall",
        id: `scheduled-${task.id}`,
        name: "telegram_send_message",
        arguments: { chatId: "192802079", text: "Privet" },
      },
      expect.objectContaining({ chatId: "192802079", db })
    );
    expect(agent.processMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task.id,
        userName: "self-scheduled-task",
        userMessage: expect.stringContaining("telegram_send_message"),
      })
    );
    expect(store.getTask(task.id)?.status).toBe("done");

    const deleteRequest = invoke.mock.calls
      .map(([request]) => request as { className?: string; id?: number[]; revoke?: boolean })
      .find((request) => request.className === "messages.DeleteMessages");
    expect(deleteRequest).toMatchObject({ id: [501], revoke: true });
  });

  it("deduplicates the same trigger across direct and general message handlers", async () => {
    const db = getDatabase().getDb();
    const store = getTaskStore(db);
    const task = store.createTask({ description: "One-shot task" });
    const { app, agent } = createApp();
    const message = makeMessage({ text: `[TASK:${task.id}] One-shot task` });

    await Promise.all([
      app.handleScheduledTaskTrigger(message),
      app.handleScheduledTaskTrigger(message),
    ]);

    expect(agent.processMessage).toHaveBeenCalledOnce();
    expect(store.getTask(task.id)?.status).toBe("done");
  });
});
