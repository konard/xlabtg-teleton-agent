import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { chatWithContext } from "../../agent/client.js";
import { getTaskStore } from "../../memory/agent/tasks.js";
import { decomposeTask } from "../../agent/delegation/decomposer.js";
import { TaskDelegationExecutor } from "../../agent/delegation/executor.js";
import { getTaskDelegationStore } from "../../agent/delegation/store.js";
import type { ManagedAgentMessage } from "../../agents/types.js";
import type {
  AgentCandidate,
  SubtaskPlan,
  TaskDelegationTree,
  TaskSubtask,
  TaskSubtaskNode,
} from "../../agent/delegation/types.js";
import { getErrorMessage } from "../../utils/errors.js";

interface DecomposeBody {
  parentId?: string | null;
  subtasks?: SubtaskPlan[];
}

interface DelegateBody {
  subtaskId?: string;
  agentId?: string;
  description?: string;
  requiredSkills?: string[];
  requiredTools?: string[];
}

type SerializedSubtask = ReturnType<typeof serializeSubtask>;

interface SerializedSubtaskNode extends SerializedSubtask {
  children: SerializedSubtaskNode[];
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizePlans(value: unknown): SubtaskPlan[] {
  if (!Array.isArray(value)) return [];
  const plans: SubtaskPlan[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const raw = item as Record<string, unknown>;
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    if (!description) return;
    plans.push({
      planId:
        typeof raw.planId === "string" && raw.planId.trim()
          ? raw.planId.trim()
          : `manual-${index + 1}`,
      description,
      requiredSkills: normalizeStringArray(raw.requiredSkills),
      requiredTools: normalizeStringArray(raw.requiredTools),
      dependsOn: normalizeStringArray(raw.dependsOn),
      agentId: typeof raw.agentId === "string" ? raw.agentId.trim() || undefined : undefined,
    });
  });
  return plans;
}

function buildAgentCandidates(deps: WebUIServerDeps): AgentCandidate[] {
  const primaryConfig = deps.agent.getConfig();
  const primaryTools = deps.toolRegistry?.getAll?.().map((tool) => tool.name) ?? [];
  const candidates: AgentCandidate[] = [
    {
      id: "primary",
      name: "Primary Agent",
      type: "OrchestratorAgent",
      description: "Primary configured Teleton agent",
      tools: primaryTools,
      state: deps.lifecycle?.getState?.() ?? "running",
      pendingMessages: 0,
      maxConcurrentTasks: primaryConfig.agent.max_agentic_iterations ?? 1,
    },
  ];

  const performance = getTaskDelegationStore(deps.memory.db).getAgentPerformance();
  for (const snapshot of deps.agentManager?.listAgentSnapshots() ?? []) {
    candidates.push({
      id: snapshot.id,
      name: snapshot.name,
      type: snapshot.type,
      description: snapshot.description,
      tools: snapshot.tools,
      state: snapshot.state,
      pendingMessages: snapshot.pendingMessages,
      maxConcurrentTasks: snapshot.resources.maxConcurrentTasks,
      successRate: performance.get(snapshot.id),
    });
  }
  return candidates;
}

function assertAgentExists(agentId: string, candidates: AgentCandidate[]): void {
  if (!candidates.some((agent) => agent.id === agentId)) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
}

function createDecompositionCompletion(deps: WebUIServerDeps) {
  return async (prompt: string): Promise<string> => {
    const response = await chatWithContext(deps.agent.getConfig().agent, {
      systemPrompt:
        "You decompose complex user tasks into JSON subtasks for a multi-agent delegation engine.",
      context: {
        messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      },
      maxTokens: 1200,
      temperature: 0.1,
      persistTranscript: false,
    });
    return response.text;
  };
}

function createManagedMessageSender(
  deps: WebUIServerDeps
): ((fromId: string, toId: string, text: string) => ManagedAgentMessage) | undefined {
  const manager = deps.agentManager;
  return manager ? (fromId, toId, text) => manager.sendMessage(fromId, toId, text) : undefined;
}

function serializeSubtask(subtask: TaskSubtask) {
  return {
    ...subtask,
    createdAt: subtask.createdAt.toISOString(),
    updatedAt: subtask.updatedAt.toISOString(),
    startedAt: subtask.startedAt?.toISOString() ?? null,
    completedAt: subtask.completedAt?.toISOString() ?? null,
  };
}

function serializeTree(tree: TaskDelegationTree) {
  const serializeNode = (node: TaskSubtaskNode): SerializedSubtaskNode => ({
    ...serializeSubtask(node),
    children: node.children.map((child) => serializeNode(child)),
  });

  return {
    taskId: tree.taskId,
    subtasks: tree.subtasks.map(serializeSubtask),
    roots: tree.roots.map((node) => serializeNode(node)),
    timeline: tree.timeline.map((event) => ({
      ...event,
      at: event.at.toISOString(),
    })),
  };
}

export function createTaskDelegationRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  function taskStore() {
    return getTaskStore(deps.memory.db);
  }

  function delegationStore() {
    return getTaskDelegationStore(deps.memory.db);
  }

  function executor() {
    const candidates = buildAgentCandidates(deps);
    return new TaskDelegationExecutor({
      store: delegationStore(),
      candidates,
      sendMessage: createManagedMessageSender(deps),
    });
  }

  app.post("/:id/decompose", async (c) => {
    try {
      const taskId = c.req.param("id");
      const task = taskStore().getTask(taskId);
      if (!task) {
        return c.json({ success: false, error: "Task not found" } as APIResponse, 404);
      }

      const body = await c.req.json<DecomposeBody>().catch((): DecomposeBody => ({}));
      const manualPlans = normalizePlans(body.subtasks);
      const plans =
        manualPlans.length > 0
          ? manualPlans
          : await decomposeTask(
              { description: task.description, maxSubtasks: 6 },
              { complete: createDecompositionCompletion(deps) }
            );

      const result = executor().decomposeAndAssign(
        { id: task.id, description: task.description },
        plans,
        { parentId: body.parentId }
      );

      return c.json(
        {
          success: true,
          data: {
            subtasks: result.subtasks.map(serializeSubtask),
            tree: serializeTree(result.tree),
            messages: result.messages,
          },
        } as APIResponse,
        201
      );
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  app.get("/:id/subtasks", (c) => {
    try {
      const taskId = c.req.param("id");
      if (!taskStore().getTask(taskId)) {
        return c.json({ success: false, error: "Task not found" } as APIResponse, 404);
      }

      const response: APIResponse = {
        success: true,
        data: { subtasks: delegationStore().listSubtasks(taskId).map(serializeSubtask) },
      };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 500);
    }
  });

  app.get("/:id/tree", (c) => {
    try {
      const taskId = c.req.param("id");
      if (!taskStore().getTask(taskId)) {
        return c.json({ success: false, error: "Task not found" } as APIResponse, 404);
      }

      const response: APIResponse = {
        success: true,
        data: serializeTree(delegationStore().getTaskTree(taskId)),
      };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 500);
    }
  });

  app.post("/:id/delegate", async (c) => {
    try {
      const taskId = c.req.param("id");
      const task = taskStore().getTask(taskId);
      if (!task) {
        return c.json({ success: false, error: "Task not found" } as APIResponse, 404);
      }

      const body = await c.req.json<DelegateBody>();
      const agentId = body.agentId?.trim();
      if (!agentId) {
        return c.json({ success: false, error: "agentId is required" } as APIResponse, 400);
      }

      const candidates = buildAgentCandidates(deps);
      assertAgentExists(agentId, candidates);
      const runner = new TaskDelegationExecutor({
        store: delegationStore(),
        candidates,
        sendMessage: createManagedMessageSender(deps),
      });

      const existingSubtask = body.subtaskId
        ? delegationStore().getSubtask(body.subtaskId)
        : undefined;
      if (body.subtaskId && (!existingSubtask || existingSubtask.taskId !== taskId)) {
        return c.json({ success: false, error: "Subtask not found" } as APIResponse, 404);
      }

      const subtask =
        existingSubtask ??
        delegationStore().createSubtasks(taskId, [
          {
            description: body.description?.trim() || task.description,
            requiredSkills: normalizeStringArray(body.requiredSkills),
            requiredTools: normalizeStringArray(body.requiredTools),
          },
        ])[0];

      const result = runner.delegateSubtask(
        { id: task.id, description: task.description },
        subtask,
        agentId
      );

      return c.json({
        success: true,
        data: {
          subtask: serializeSubtask(result.subtask),
          tree: serializeTree(result.tree),
          message: result.message,
        },
      } as APIResponse);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  app.post("/:id/subtasks/:subtaskId/retry", async (c) => {
    try {
      const taskId = c.req.param("id");
      const subtaskId = c.req.param("subtaskId");
      const task = taskStore().getTask(taskId);
      if (!task) {
        return c.json({ success: false, error: "Task not found" } as APIResponse, 404);
      }

      const body = await c.req.json<{ agentId?: string }>().catch((): { agentId?: string } => ({}));
      if (body.agentId?.trim()) {
        const candidates = buildAgentCandidates(deps);
        assertAgentExists(body.agentId.trim(), candidates);
        delegationStore().assignSubtask(subtaskId, body.agentId.trim());
      }

      const subtask = delegationStore().retrySubtask(taskId, subtaskId);
      const response: APIResponse = {
        success: true,
        data: {
          subtask: serializeSubtask(subtask),
          tree: serializeTree(delegationStore().getTaskTree(taskId)),
        },
      };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 400);
    }
  });

  return app;
}
