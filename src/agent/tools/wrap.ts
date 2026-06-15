import type { ToolExecutor } from "./types.js";
import { getErrorMessage } from "../../utils/errors.js";

/**
 * Wrap a tool executor so any thrown error becomes the standard failed ToolResult
 * rather than escaping the ToolResult contract. Single source for the generic
 * try/catch → { success: false, error } mapping repeated across executors.
 */
export function withToolErrors<P>(fn: ToolExecutor<P>): ToolExecutor<P> {
  return async (params, context) => {
    try {
      return await fn(params, context);
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  };
}
