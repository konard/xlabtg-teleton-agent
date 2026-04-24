import type { ToolRecovery, ToolErrorKind } from "./types.js";

export function classifyToolError(error: string | undefined): ToolErrorKind {
  const msg = (error ?? "").toLowerCase();
  if (/\b(401|unauthorized|invalid api key|bad credentials|token expired)\b/.test(msg)) {
    return "auth";
  }
  if (/\b(timeout|timed out|etimedout|deadline)\b/.test(msg)) return "timeout";
  if (
    /\b(validation|invalid input|invalid argument|missing required|schema|expected)\b/.test(msg)
  ) {
    return "invalid_input";
  }
  if (/\b(404|not found|no such file|does not exist|unknown resource)\b/.test(msg)) {
    return "resource_not_found";
  }
  if (/\b(429|rate limit|too many requests|retry-after|retry after)\b/.test(msg)) {
    return "rate_limit";
  }
  if (/\b(permission|forbidden|denied|restricted|admin-only|admin only)\b/.test(msg)) {
    return "permission";
  }
  if (/\b(network|econnreset|econnrefused|fetch failed|connection error)\b/.test(msg)) {
    return "network";
  }
  return "unknown";
}

function strategy(kind: ToolErrorKind): { retryable: boolean; guidance: string } {
  switch (kind) {
    case "auth":
      return {
        retryable: false,
        guidance:
          "Credentials or permissions failed. Do not retry unchanged; ask an admin to refresh credentials or choose a tool that does not require this auth.",
      };
    case "timeout":
      return {
        retryable: true,
        guidance:
          "Retry with narrower scope, smaller limits, or simpler parameters before giving up.",
      };
    case "invalid_input":
      return {
        retryable: true,
        guidance:
          "Inspect the validation error, correct the parameter names/types, and avoid repeating the same arguments.",
      };
    case "resource_not_found":
      return {
        retryable: true,
        guidance:
          "Verify the resource identifier and try an alternate path, query, or lookup before reporting it missing.",
      };
    case "rate_limit":
      return {
        retryable: true,
        guidance: "Back off, reduce request volume, or use cached/narrower data if available.",
      };
    case "permission":
      return {
        retryable: false,
        guidance:
          "The caller or chat lacks permission. Do not retry unchanged; explain the permission requirement.",
      };
    case "network":
      return {
        retryable: true,
        guidance:
          "Retry once with the same intent but a simpler request, then report the connectivity issue if it persists.",
      };
    default:
      return {
        retryable: true,
        guidance:
          "Analyze the error text and adjust the next tool call instead of repeating identical parameters.",
      };
  }
}

function adaptParams(
  kind: ToolErrorKind,
  params: Record<string, unknown>
): Record<string, unknown> {
  const adapted: Record<string, unknown> = {};

  if (kind === "timeout" || kind === "rate_limit") {
    if (typeof params.limit === "number" && params.limit > 10) {
      adapted.limit = 10;
    }
    if (typeof params.maxResults === "number" && params.maxResults > 10) {
      adapted.maxResults = 10;
    }
    if (typeof params.query === "string" && params.query.length > 200) {
      adapted.query = params.query.slice(0, 200);
    }
  }

  if (kind === "invalid_input") {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        adapted[key] = value;
      }
    }
  }

  return adapted;
}

export function createToolRecovery(input: {
  toolName: string;
  params: Record<string, unknown>;
  error: string | undefined;
}): ToolRecovery {
  const kind = classifyToolError(input.error);
  const { retryable, guidance } = strategy(kind);
  const adaptedParams = adaptParams(kind, input.params);
  return {
    toolName: input.toolName,
    error: input.error ?? "Unknown tool error",
    kind,
    retryable,
    guidance,
    ...(Object.keys(adaptedParams).length > 0 ? { adaptedParams } : {}),
  };
}

export function buildToolRecoveryMessage(recoveries: ToolRecovery[]): string {
  if (recoveries.length === 0) return "";

  const lines = recoveries.map((recovery) => {
    const adapted = recovery.adaptedParams
      ? ` Suggested parameter changes: ${JSON.stringify(recovery.adaptedParams)}.`
      : "";
    return `- ${recovery.toolName}: ${recovery.kind}. ${recovery.guidance}${adapted}`;
  });

  return `Tool error recovery guidance for the next attempt:
${lines.join("\n")}

Use this guidance to adapt the next tool call or explain why recovery is not possible.`;
}
