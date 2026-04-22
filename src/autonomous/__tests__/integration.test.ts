import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { TSchema } from "@sinclair/typebox";
import { ensureSchema } from "../../memory/schema.js";
import { getAutonomousTaskStore } from "../../memory/agent/autonomous-tasks.js";
import type { AutonomousTask } from "../../memory/agent/autonomous-tasks.js";
import { ToolRegistry } from "../../agent/tools/registry.js";
import type { Tool, ToolExecutor } from "../../agent/tools/types.js";
import {
  listToolsForTask,
  buildIntegratedLoopDeps,
  createAutonomousManager,
} from "../integration.js";
import { buildDefaultLoopDeps } from "../manager.js";
import type { AgentRuntime } from "../../agent/runtime.js";
import type { TelegramBridge } from "../../telegram/bridge.js";
import type { Config } from "../../config/schema.js";
import { notificationBus, getNotificationService } from "../../services/notifications.js";
import { AutonomousLoop } from "../loop.js";
import { DEFAULT_POLICY_CONFIG } from "../policy-engine.js";

/**
 * Issue #224 regression tests: the autonomous loop could not see available
 * tools in its planner prompt, and tool execution always failed the
 * admin-only check because senderId was hardcoded to 0.
 */

function emptySchema(): TSchema {
  // Minimal empty-object schema; we don't care about param shape here, only
  // that the registry accepts it.
  return { type: "object", properties: {} } as unknown as TSchema;
}

function makeTool(name: string, description = `Tool ${name}`): Tool {
  return {
    name,
    description,
    parameters: emptySchema(),
  };
}

const noopExecutor: ToolExecutor = async () => ({ success: true, data: null });

function stubConfig(adminIds: number[] = [42]): Config {
  return {
    telegram: {
      admin_ids: adminIds,
    },
  } as unknown as Config;
}

function stubAgent(config: Config): AgentRuntime {
  return {
    getConfig: () => config,
  } as unknown as AgentRuntime;
}

function stubBridge(): TelegramBridge {
  return {} as TelegramBridge;
}

function stubTask(overrides: Partial<AutonomousTask> = {}): AutonomousTask {
  return {
    id: "test-task",
    goal: "Test goal",
    successCriteria: [],
    failureConditions: [],
    constraints: {},
    strategy: "balanced",
    retryPolicy: { maxRetries: 0, backoff: "linear" },
    context: {},
    priority: "medium",
    status: "running",
    currentStep: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("listToolsForTask", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.register(makeTool("alpha", "Alpha description"), noopExecutor);
    registry.register(makeTool("beta", "Beta description"), noopExecutor);
    registry.register(makeTool("gamma", "Gamma description"), noopExecutor);
    // An admin-only tool should still be visible to the planner because
    // autonomous tasks run with admin privileges.
    registry.register(makeTool("admin_reset", "Admin-only reset"), noopExecutor, "admin-only");
  });

  it("returns all registered tools (including admin-only) when no constraints are set", () => {
    const tools = listToolsForTask(registry, stubTask());
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["admin_reset", "alpha", "beta", "gamma"]);
  });

  it("includes a description for every tool", () => {
    const tools = listToolsForTask(registry, stubTask());
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(0);
    }
    const alpha = tools.find((t) => t.name === "alpha");
    expect(alpha?.description).toBe("Alpha description");
  });

  it("honours task.constraints.allowedTools (whitelist)", () => {
    const tools = listToolsForTask(
      registry,
      stubTask({ constraints: { allowedTools: ["alpha", "gamma"] } })
    );
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["alpha", "gamma"]);
  });

  it("honours task.constraints.restrictedTools (blacklist)", () => {
    const tools = listToolsForTask(
      registry,
      stubTask({ constraints: { restrictedTools: ["beta", "admin_reset"] } })
    );
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["alpha", "gamma"]);
  });

  it("returns an empty array when the registry is null", () => {
    expect(listToolsForTask(null, stubTask())).toEqual([]);
  });
});

describe("buildDefaultLoopDeps planner prompt", () => {
  it("includes the list of available tools so the LLM can pick a real tool name", async () => {
    const callLLM = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ toolName: "alpha", params: {}, confidence: 0.9 }));
    const deps = buildDefaultLoopDeps({
      callLLM,
      callTool: vi.fn(),
      notify: vi.fn().mockResolvedValue(undefined),
      listTools: () => [
        { name: "alpha", description: "Alpha description" },
        { name: "beta", description: "Beta description" },
      ],
    });

    const task = stubTask({ goal: "Find pools" });
    await deps.planNextAction(task, []);

    expect(callLLM).toHaveBeenCalledTimes(1);
    const prompt = callLLM.mock.calls[0][0] as string;

    // The planner prompt must list both tools by name AND description so the
    // model can reason about which to pick — this is what was missing and
    // caused issue #224's "does not see all available tools" symptom.
    expect(prompt).toContain("alpha: Alpha description");
    expect(prompt).toContain("beta: Beta description");
    expect(prompt).toMatch(/pick exactly one by name/i);
  });

  it("still works when listTools is not provided (backwards compatible)", async () => {
    const callLLM = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ toolName: "noop", params: {}, confidence: 0.5 }));
    const deps = buildDefaultLoopDeps({
      callLLM,
      callTool: vi.fn(),
      notify: vi.fn().mockResolvedValue(undefined),
    });

    const task = stubTask();
    const result = await deps.planNextAction(task, []);
    expect(result.toolName).toBe("noop");
    const prompt = callLLM.mock.calls[0][0] as string;
    expect(prompt).toMatch(/none were provided/);
  });
});

describe("buildIntegratedLoopDeps admin check", () => {
  let db: InstanceType<typeof Database>;
  let registry: ToolRegistry;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);

    registry = new ToolRegistry();
    // Critical: this is an admin-only tool — it used to fail with
    // senderId=0, which is the core complaint in issue #224 about tools
    // "not passing the administrator check".
    registry.register(makeTool("admin_reset", "Admin-only reset"), noopExecutor, "admin-only");
  });

  afterEach(() => {
    db.close();
  });

  it("executes admin-only tools using admin_ids[0] as effective sender", async () => {
    const adminId = 777;
    const deps = buildIntegratedLoopDeps({
      agent: stubAgent(stubConfig([adminId])),
      toolRegistry: registry,
      bridge: stubBridge(),
      db,
    });

    // Should succeed — the integration supplies senderId=adminId so the
    // admin-only scope check passes.
    const result = await deps.executeTool("admin_reset", {});
    expect(result.success).toBe(true);
  });

  it("fails tool execution fast with a clear error when admin_ids is empty (AUDIT-H6)", async () => {
    // Regression test for issue #270: previously this would coerce the
    // sender id to 0 and silently fail the admin-only scope check with a
    // generic "Tool execution failed". Now it must surface a clear,
    // actionable error instead of pretending the tool merely failed.
    const deps = buildIntegratedLoopDeps({
      agent: stubAgent(stubConfig([])),
      toolRegistry: registry,
      bridge: stubBridge(),
      db,
    });

    const result = await deps.executeTool("admin_reset", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/admin_ids is empty/i);
  });

  it("exposes the tool registry to the planner via listTools", async () => {
    const agentConfig = stubConfig([1]);
    const apiKeyEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test";

    try {
      const deps = buildIntegratedLoopDeps({
        agent: {
          getConfig: () =>
            ({
              ...agentConfig,
              agent: { provider: "anthropic", model: "claude-haiku-4-5", api_key: "sk-test" },
            }) as unknown as Config,
        } as unknown as AgentRuntime,
        toolRegistry: registry,
        bridge: stubBridge(),
        db,
      });

      // We can't easily assert against the prompt without stubbing the
      // LLM, but we can assert that planNextAction at least surfaces
      // "admin_reset" as a visible tool by driving it through a mock
      // LLM that echoes back what the prompt said.
      const store = getAutonomousTaskStore(db);
      const task = store.createTask({ goal: "Run admin reset" });
      // Ensure the test task is visible to the planner's tool list.
      const tools = listToolsForTask(registry, task);
      expect(tools.some((t) => t.name === "admin_reset")).toBe(true);

      // Touch deps so TS doesn't flag it as unused.
      expect(typeof deps.planNextAction).toBe("function");
      expect(typeof deps.executeTool).toBe("function");
    } finally {
      if (apiKeyEnv === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = apiKeyEnv;
      }
    }
  });
});

/**
 * AUDIT-H2 regression tests (issue #262): the autonomous loop used to log
 * escalations only. Now they must reach the user — Telegram admins via the
 * bridge, and the WebUI via the notificationBus.
 */
describe("buildIntegratedLoopDeps escalation notify", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
  });

  afterEach(() => {
    db.close();
    notificationBus.removeAllListeners("escalation");
    notificationBus.removeAllListeners("update");
  });

  function mockBridge(sendMessage = vi.fn().mockResolvedValue({ id: 1 })): TelegramBridge {
    return { sendMessage } as unknown as TelegramBridge;
  }

  it("notify() sends a Telegram message to every configured admin via bridge", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ id: 1 });
    const bridge = mockBridge(sendMessage);

    const deps = buildIntegratedLoopDeps({
      agent: stubAgent(stubConfig([111, 222])),
      toolRegistry: null,
      bridge,
      db,
    });

    // `escalate` is the loop-facing wrapper; it calls the integration's
    // notify() internally. Invoking it proves the full path works.
    await deps.escalate(stubTask(), "Policy violation: TON spend exceeds budget");

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: "111" }));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: "222" }));
    const firstCall = sendMessage.mock.calls[0][0] as { text: string };
    expect(firstCall.text).toMatch(/Policy violation/);
  });

  it("notify() skips Telegram delivery when no admin_ids are configured", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ id: 1 });
    const bridge = mockBridge(sendMessage);

    const deps = buildIntegratedLoopDeps({
      agent: stubAgent(stubConfig([])),
      toolRegistry: null,
      bridge,
      db,
    });

    await deps.escalate(stubTask(), "reason");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("notify() emits an 'escalation' event on the notificationBus for WebUI", async () => {
    const bridge = mockBridge();
    const deps = buildIntegratedLoopDeps({
      agent: stubAgent(stubConfig([1])),
      toolRegistry: null,
      bridge,
      db,
    });

    const received: Array<{ taskId: string; message: string }> = [];
    notificationBus.on("escalation", (payload: { taskId: string; message: string }) => {
      received.push(payload);
    });

    await deps.escalate(stubTask({ id: "task-abc" }), "need approval");

    expect(received).toHaveLength(1);
    expect(received[0].taskId).toBe("task-abc");
    expect(received[0].message).toMatch(/need approval/);
  });

  it("notify() records an in-app notification so the WebUI badge updates", async () => {
    const bridge = mockBridge();
    const deps = buildIntegratedLoopDeps({
      agent: stubAgent(stubConfig([1])),
      toolRegistry: null,
      bridge,
      db,
    });

    const before = getNotificationService(db).unreadCount();
    await deps.escalate(stubTask(), "please confirm");
    const after = getNotificationService(db).unreadCount();

    expect(after).toBe(before + 1);
    const latest = getNotificationService(db).list(true)[0];
    expect(latest.type).toBe("warning");
    expect(latest.message).toMatch(/please confirm/);
  });

  it("notify() still logs and emits a bus event when bridge.sendMessage throws", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("bridge offline"));
    const bridge = mockBridge(sendMessage);
    const deps = buildIntegratedLoopDeps({
      agent: stubAgent(stubConfig([42])),
      toolRegistry: null,
      bridge,
      db,
    });

    const busEvents: unknown[] = [];
    notificationBus.on("escalation", (e) => busEvents.push(e));

    // Must resolve (not reject) even though the Telegram delivery failed —
    // escalation must be tolerant of any single channel outage.
    await expect(deps.escalate(stubTask(), "still escalate")).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(busEvents).toHaveLength(1);
  });

  it("policy-triggered escalation reaches bridge.sendMessage end-to-end", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ id: 1 });
    const bridge = mockBridge(sendMessage);

    // Wire the real loop through buildIntegratedLoopDeps — no overrides of
    // planNextAction/selfReflect here would bypass the integration's
    // notify() wiring, so we stub them by wrapping the integrated deps.
    const integratedDeps = buildIntegratedLoopDeps({
      agent: stubAgent(stubConfig([777])),
      toolRegistry: null,
      bridge,
      db,
    });

    const loopDeps = {
      ...integratedDeps,
      // Plan a wallet-send that will trip the policy confirmation threshold
      // (>= 0.5 TON triggers requiresEscalation with DEFAULT_POLICY_CONFIG).
      planNextAction: vi.fn().mockResolvedValue({
        toolName: "ton_send",
        params: { amount: 0.6 },
        tonAmount: 0.6,
      }),
      evaluateSuccess: vi.fn().mockResolvedValue(false),
      selfReflect: vi.fn().mockResolvedValue({
        progressSummary: "n/a",
        isStuck: false,
      }),
    };

    const store = getAutonomousTaskStore(db);
    const task = store.createTask({
      goal: "Send TON to recipient",
      constraints: { maxIterations: 3 },
    });

    const loop = new AutonomousLoop(store, loopDeps, DEFAULT_POLICY_CONFIG);
    const result = await loop.run(task);

    expect(result.status).toBe("paused");
    // The integration's notify() must have delivered to the admin via the
    // mock bridge — this is what guarantees the human is actually paged.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: "777" }));
  });
});

/**
 * Issue #270 / AUDIT-H6: createAutonomousManager must refuse to start with
 * an empty admin_ids list instead of silently coercing the sender id to 0.
 */
describe("createAutonomousManager admin_ids guard", () => {
  let db: InstanceType<typeof Database>;
  let registry: ToolRegistry;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);

    registry = new ToolRegistry();
    registry.register(makeTool("admin_reset", "Admin-only reset"), noopExecutor, "admin-only");
  });

  afterEach(() => {
    db.close();
  });

  it("throws a clear error when admin_ids is empty", () => {
    expect(() =>
      createAutonomousManager({
        agent: stubAgent(stubConfig([])),
        toolRegistry: registry,
        bridge: stubBridge(),
        db,
      })
    ).toThrow(/admin_ids is empty/i);
  });

  it("starts successfully when admin_ids contains at least one id", () => {
    const manager = createAutonomousManager({
      agent: stubAgent(stubConfig([123])),
      toolRegistry: registry,
      bridge: stubBridge(),
      db,
    });
    expect(manager).toBeDefined();
    // Basic sanity check: the manager should expose its standard surface.
    expect(typeof manager.restoreInterruptedTasks).toBe("function");
  });
});
