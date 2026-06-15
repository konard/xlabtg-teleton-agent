import type { ITelegramBridge } from "./bridge-interface.js";
import type { GrammyBotBridge } from "./bridges/bot.js";
import type { GramJSUserBridge } from "./bridges/user.js";

export function isBotBridge(bridge: ITelegramBridge): bridge is GrammyBotBridge {
  return typeof bridge.getMode === "function" && bridge.getMode() === "bot";
}

export function isUserBridge(bridge: ITelegramBridge): bridge is GramJSUserBridge {
  // Bridges (and test mocks) that predate the mode abstraction expose no
  // getMode(); treat them as user mode, which is the fork's default.
  return typeof bridge.getMode !== "function" || bridge.getMode() === "user";
}
