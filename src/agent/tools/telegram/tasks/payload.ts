import { Type } from "@sinclair/typebox";

export type ScheduledTaskPayloadInput = string | Record<string, unknown>;

const scheduledTaskPayloadDescription = `JSON payload defining what to execute automatically. Accepts either a JSON string or an already-parsed JSON object. Two types:
1. Tool call: {"type":"tool_call","tool":"ton_get_price","params":{},"condition":"price > 5"}
2. Agent task: {"type":"agent_task","instructions":"Do something","context":{}}
3. Agent task that continues after parent failure: {"type":"agent_task","instructions":"Send daily report","skipOnParentFailure":false}
If omitted, task is a simple reminder.`;

function createScheduledTaskPayloadSchema(description: string) {
  return Type.Union(
    [
      Type.String(),
      Type.Object(
        {},
        {
          additionalProperties: true,
        }
      ),
    ],
    {
      description,
    }
  );
}

export const scheduledTaskPayloadSchema = createScheduledTaskPayloadSchema(
  scheduledTaskPayloadDescription
);

export const scheduledTaskPayloadUpdateSchema = createScheduledTaskPayloadSchema(
  `${scheduledTaskPayloadDescription}
Set to empty string "" to convert to a simple reminder with no automatic execution.`
);

type NormalizedPayload =
  | { success: true; payload: string | undefined }
  | { success: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeScheduledTaskPayload(
  payload: ScheduledTaskPayloadInput | undefined
): NormalizedPayload {
  if (payload === undefined) {
    return { success: true, payload: undefined };
  }

  if (typeof payload === "string") {
    return { success: true, payload };
  }

  if (!isRecord(payload)) {
    return { success: false, error: "Payload must be a JSON string or object" };
  }

  try {
    return { success: true, payload: JSON.stringify(payload) };
  } catch {
    return { success: false, error: "Invalid JSON payload" };
  }
}

export function validateScheduledTaskPayload(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!isRecord(parsed)) {
      return "Invalid JSON payload";
    }

    if (!parsed.type || !["tool_call", "agent_task"].includes(String(parsed.type))) {
      return 'Payload must have type "tool_call" or "agent_task"';
    }

    if (parsed.type === "tool_call") {
      if (!parsed.tool || typeof parsed.tool !== "string") {
        return 'tool_call payload requires "tool" field (string)';
      }
      if (parsed.params !== undefined && !isRecord(parsed.params)) {
        return 'tool_call payload "params" must be an object';
      }
    }

    if (parsed.type === "agent_task") {
      if (!parsed.instructions || typeof parsed.instructions !== "string") {
        return 'agent_task payload requires "instructions" field (string)';
      }
      if (parsed.instructions.length < 5) {
        return "Instructions too short (min 5 characters)";
      }
      if (parsed.context !== undefined && !isRecord(parsed.context)) {
        return 'agent_task payload "context" must be an object';
      }
    }

    return null;
  } catch {
    return "Invalid JSON payload";
  }
}
