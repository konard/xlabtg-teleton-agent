import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Api } from "telegram";
import {
  telegramScheduleMessageTool,
  telegramScheduleMessageExecutor,
  TELEGRAM_SCHEDULE_MESSAGE_DEPRECATION_NOTICE,
} from "../schedule-message.js";
import { addLogListener, type LogListener } from "../../../../../utils/logger.js";
import type { ToolContext } from "../../../types.js";

const mockInvoke = vi.fn();
const mockGetEntity = vi.fn();

const mockContext = {
  bridge: {
    getClient: () => ({
      getClient: () => ({
        invoke: mockInvoke,
        getEntity: mockGetEntity,
      }),
    }),
  },
  chatId: "123",
  senderId: 456,
  isGroup: false,
} as unknown as ToolContext;

function buildEmptyUpdates(): Api.Updates {
  // Build an Api.Updates instance the executor's `instanceof` check will accept.
  const updates = Object.create(Api.Updates.prototype) as Api.Updates;
  (updates as { updates: unknown[] }).updates = [];
  return updates;
}

describe("telegram_schedule_message deprecation (issue #459)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the tool as deprecated in its description so the LLM prefers the replacement", () => {
    expect(telegramScheduleMessageTool.description).toMatch(/\[DEPRECATED/i);
    expect(telegramScheduleMessageTool.description).toContain("telegram_create_scheduled_task");
  });

  it("exposes a deprecation notice constant that names the replacement tool", () => {
    expect(TELEGRAM_SCHEDULE_MESSAGE_DEPRECATION_NOTICE).toMatch(/DEPRECATED/i);
    expect(TELEGRAM_SCHEDULE_MESSAGE_DEPRECATION_NOTICE).toContain(
      "telegram_create_scheduled_task"
    );
  });

  it("returns deprecated: true and the notice in the success result so the LLM gets it back", async () => {
    mockGetEntity.mockResolvedValue({ className: "User", id: 1n });
    mockInvoke.mockResolvedValue(buildEmptyUpdates());

    const future = new Date(Date.now() + 60_000).toISOString();
    const result = await telegramScheduleMessageExecutor(
      { chatId: "123", text: "hi", scheduleDate: future },
      mockContext
    );

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.deprecated).toBe(true);
    expect(data.deprecationNotice).toBe(TELEGRAM_SCHEDULE_MESSAGE_DEPRECATION_NOTICE);
  });

  it("rejects past schedule dates without sending the message", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const result = await telegramScheduleMessageExecutor(
      { chatId: "123", text: "hi", scheduleDate: past },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/future/i);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  describe("runtime deprecation warning", () => {
    let entries: Array<{ level: string; message: string }>;
    let removeListener: () => void;

    beforeEach(() => {
      entries = [];
      const listener: LogListener = (entry) => {
        entries.push({ level: entry.level, message: entry.message });
      };
      removeListener = addLogListener(listener);
    });

    afterEach(() => {
      removeListener();
    });

    it("emits a warn-level log naming the replacement tool when invoked", async () => {
      mockGetEntity.mockResolvedValue({ className: "User", id: 1n });
      mockInvoke.mockResolvedValue(buildEmptyUpdates());

      const future = new Date(Date.now() + 60_000).toISOString();
      await telegramScheduleMessageExecutor(
        { chatId: "123", text: "hi", scheduleDate: future },
        mockContext
      );

      const deprecationWarn = entries.find(
        (e) => e.level === "warn" && e.message.includes("DEPRECATED")
      );
      expect(deprecationWarn).toBeDefined();
      expect(deprecationWarn?.message).toContain("telegram_create_scheduled_task");
    });
  });
});
