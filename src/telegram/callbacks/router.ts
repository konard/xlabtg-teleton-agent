import { CallbackQueryHandler } from "./handler.js";
import type { ITelegramBridge } from "../bridge-interface.js";

export function initializeCallbackRouter(bridge: ITelegramBridge): CallbackQueryHandler {
  const handler = new CallbackQueryHandler(bridge);
  return handler;
}
