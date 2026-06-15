import { EventEmitter } from "events";

export interface EventMap {
  "bridge:connected": { mode: "user" | "bot" };
  "bridge:disconnected": { mode: "user" | "bot" };
  "mode:changed": { from: "user" | "bot"; to: "user" | "bot" };
  "config:updated": { key: string; value: unknown };
  "tools:changed": { removed: string[]; added: string[] };
}

export class EventBus extends EventEmitter {
  on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): this {
    return super.on(event, handler);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): boolean {
    return super.emit(event, payload);
  }

  off<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): this {
    return super.off(event, handler);
  }
}

// Singleton instance
export const eventBus = new EventBus();
