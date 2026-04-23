import { fetchWithTimeout } from "../utils/fetch.js";

export interface BotTokenValidation {
  valid: boolean;
  networkError: boolean;
  bot?: { username: string; firstName: string };
  error?: string;
}

export function validateBotTokenFormat(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return "Bot token is required";
  if (!/^\d+:[^\s:]+$/.test(trimmed)) {
    return "Invalid format (expected numeric id:token from @BotFather)";
  }
  return null;
}

export function maskBotToken(token: string): string {
  const [id] = token.split(":", 1);
  return id ? `${id}:****` : "****";
}

export async function validateBotTokenWithTelegram(token: string): Promise<BotTokenValidation> {
  const formatError = validateBotTokenFormat(token);
  if (formatError) {
    return { valid: false, networkError: false, error: formatError };
  }

  try {
    const res = await fetchWithTimeout(`https://api.telegram.org/bot${token.trim()}/getMe`);
    const data = (await res.json()) as {
      ok?: boolean;
      result?: { username?: string; first_name?: string };
      description?: string;
    };
    if (!data.ok || !data.result) {
      return {
        valid: false,
        networkError: false,
        error: data.description || "Bot token is invalid",
      };
    }
    return {
      valid: true,
      networkError: false,
      bot: {
        username: data.result.username ?? "",
        firstName: data.result.first_name ?? "",
      },
    };
  } catch {
    return {
      valid: false,
      networkError: true,
      error: "Could not reach Telegram API",
    };
  }
}
