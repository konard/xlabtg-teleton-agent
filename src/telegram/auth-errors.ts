/**
 * Telegram auth/session errors indicate stale credentials, not broken transport.
 * They should trigger re-authentication while preserving the selected connection path.
 */
export function isTelegramAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const record = err as Record<string, unknown>;
  const numericCode = typeof record.code === "number" ? record.code : Number(record.code);
  if (numericCode === 401 || numericCode === 406) return true;

  const fields = [
    record.errorMessage,
    record.message,
    err instanceof Error ? err.message : undefined,
  ];
  const combined = fields.filter((value): value is string => typeof value === "string").join(" ");

  return /AUTH_KEY|UNAUTHORIZED|SESSION_EXPIRED|SESSION_REVOKED|USER_DEACTIVATED/i.test(combined);
}
