import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { ensurePipelineTables, PipelineStore, type PipelineDefinition } from "../definition.js";
import { PipelineExecutor } from "../executor.js";

vi.mock("../../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function createStore(): PipelineStore {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensurePipelineTables(db);
  return new PipelineStore(db);
}

function getRun(store: PipelineStore, pipeline: PipelineDefinition) {
  const runs = store.listRuns(pipeline.id);
  expect(runs).toHaveLength(1);
  const detail = store.getRunDetail(pipeline.id, runs[0].id);
  expect(detail).not.toBeNull();
  return detail!;
}

describe("PipelineExecutor", () => {
  let store: PipelineStore;

  beforeEach(() => {
    store = createStore();
  });

  it("passes one step output into dependent step variables", async () => {
    const processMessage = vi
      .fn()
      .mockResolvedValueOnce({ content: "typescript pipeline notes" })
      .mockResolvedValueOnce({ content: "summary from notes" });
    const pipeline = store.create({
      name: "research",
      steps: [
        {
          id: "research",
          agent: "primary",
          action: "Research {topic}",
          output: "notes",
        },
        {
          id: "summary",
          agent: "primary",
          action: "Summarize {notes}",
          depends_on: ["research"],
          output: "report",
        },
      ],
    });

    const executor = new PipelineExecutor({
      store,
      agent: { processMessage } as unknown as ConstructorParameters<
        typeof PipelineExecutor
      >[0]["agent"],
    });

    const detail = await executor.execute(pipeline, { inputContext: { topic: "pipelines" } });

    expect(detail.run.status).toBe("completed");
    expect(detail.run.context).toMatchObject({
      topic: "pipelines",
      notes: "typescript pipeline notes",
      report: "summary from notes",
    });
    expect(processMessage.mock.calls[0][0].userMessage).toBe("Research pipelines");
    expect(processMessage.mock.calls[1][0].userMessage).toBe("Summarize typescript pipeline notes");
    expect(detail.steps.map((step) => step.status)).toEqual(["completed", "completed"]);
  });

  it("marks the run failed and skips pending steps when fail_fast step fails", async () => {
    const processMessage = vi.fn().mockRejectedValueOnce(new Error("provider down"));
    const pipeline = store.create({
      name: "failure",
      steps: [
        { id: "first", agent: "primary", action: "First", output: "first" },
        { id: "second", agent: "primary", action: "Second", depends_on: ["first"] },
      ],
    });

    const executor = new PipelineExecutor({
      store,
      agent: { processMessage } as unknown as ConstructorParameters<
        typeof PipelineExecutor
      >[0]["agent"],
    });

    const detail = await executor.execute(pipeline);

    expect(detail.run.status).toBe("failed");
    expect(detail.run.error).toContain("provider down");
    expect(detail.steps.map((step) => step.status)).toEqual(["failed", "skipped"]);
  });

  it("continues with available context when the strategy is continue", async () => {
    const processMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ content: "second output" });
    const pipeline = store.create({
      name: "continue",
      errorStrategy: "continue",
      steps: [
        { id: "first", agent: "primary", action: "First", output: "first" },
        { id: "second", agent: "primary", action: "Second {first}", depends_on: ["first"] },
      ],
    });

    const executor = new PipelineExecutor({
      store,
      agent: { processMessage } as unknown as ConstructorParameters<
        typeof PipelineExecutor
      >[0]["agent"],
    });

    const detail = await executor.execute(pipeline);

    expect(detail.run.status).toBe("completed");
    expect(detail.run.context.second).toBe("second output");
    expect(processMessage.mock.calls[1][0].userMessage).toBe("Second ");
    expect(detail.steps.map((step) => step.status)).toEqual(["failed", "completed"]);
  });

  it("dispatches non-primary steps to a matching managed agent", async () => {
    const sendMessage = vi.fn().mockReturnValue({
      id: "message-1",
      fromId: "primary",
      toId: "researcher",
      text: "work",
      createdAt: "2026-04-24T00:00:00.000Z",
      deliveredAt: null,
    });
    const pipeline = store.create({
      name: "managed",
      steps: [{ id: "delegate", agent: "ResearchAgent", action: "work", output: "dispatch" }],
    });
    const executor = new PipelineExecutor({
      store,
      agent: { processMessage: vi.fn() } as unknown as ConstructorParameters<
        typeof PipelineExecutor
      >[0]["agent"],
      agentManager: {
        listAgentSnapshots: () => [
          {
            id: "researcher",
            name: "Researcher",
            type: "ResearchAgent",
          },
        ],
        sendMessage,
      } as unknown as ConstructorParameters<typeof PipelineExecutor>[0]["agentManager"],
    });

    const detail = await executor.execute(pipeline);

    expect(detail.run.status).toBe("completed");
    expect(sendMessage).toHaveBeenCalledWith(
      "primary",
      "researcher",
      expect.stringContaining("[PIPELINE STEP - delegate]")
    );
    expect(detail.run.context.dispatch).toMatchObject({
      messageId: "message-1",
      toAgentId: "researcher",
    });
  });
});
