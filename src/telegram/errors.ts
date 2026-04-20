import { getErrorMessage } from "../utils/errors.js";

export type TelegramErrorCode =
  | "AUTH_UNEXPECTED_RESPONSE"
  | "AUTH_INVALID_CODE"
  | "AUTH_FAILED"
  | "PROXY_TIMEOUT"
  | "GET_ME_TIMEOUT";

/**
 * Error thrown by TelegramUserClient operations. Carries a stable
 * `code` for programmatic handling and optional `context` for
 * structured logging.
 */
export class TelegramError extends Error {
  constructor(
    message: string,
    public readonly code: TelegramErrorCode,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "TelegramError";
  }
}

/** Wrap an unknown caught value as a TelegramError, preserving the original under context.originalError. */
export function wrapTelegramError(
  operation: string,
  error: unknown,
  code: TelegramErrorCode,
  context?: Record<string, unknown>
): TelegramError {
  return new TelegramError(`${operation} failed: ${getErrorMessage(error)}`, code, {
    ...context,
    originalError: error,
  });
}
