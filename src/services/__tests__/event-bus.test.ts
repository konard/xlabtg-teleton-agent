import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { getEventBus, resetEventBusForTesting } from "../event-bus.js";

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("EventBus", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    resetEventBusForTesting(db);
    db.close();
  });

  it("logs events and dispatches subscribers asynchronously", async () => {
    const bus = getEventBus(db, { maxLogEntries: 10 });
    const received: string[] = [];

    const unsubscribe = bus.subscribe("agent.message.received", (event) => {
      received.push(event.id);
    });

    const event = await bus.publish({
      type: "agent.message.received",
      source: "test",
      correlationId: "corr-1",
      payload: { text: "hello" },
    });

    expect(received).toEqual([]);
    await nextTick();

    expect(received).toEqual([event.id]);
    const result = bus.listEvents({ type: "agent.message.received" });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: event.id,
      type: "agent.message.received",
      source: "test",
      correlationId: "corr-1",
      payload: { text: "hello" },
    });

    unsubscribe();
  });

  it("replays an event as a new event with the original payload", async () => {
    const bus = getEventBus(db, { maxLogEntries: 10 });
    const original = await bus.publish({
      type: "tool.executed",
      source: "test",
      payload: { toolName: "journal_log", success: true },
    });

    const replayed = await bus.replay(original.id);

    expect(replayed.id).not.toBe(original.id);
    expect(replayed.type).toBe(original.type);
    expect(replayed.payload).toEqual(original.payload);
    expect(replayed.correlationId).toBe(original.correlationId);
    expect(bus.listEvents({}).events.map((event) => event.id)).toContain(replayed.id);
  });

  it("prunes old event log rows when maxLogEntries is exceeded", async () => {
    const bus = getEventBus(db, { maxLogEntries: 2 });

    await bus.publish({ type: "config.changed", source: "test", payload: { key: "a" } });
    await bus.publish({ type: "config.changed", source: "test", payload: { key: "b" } });
    await bus.publish({ type: "config.changed", source: "test", payload: { key: "c" } });

    const result = bus.listEvents({});
    expect(result.events).toHaveLength(2);
    expect(result.events.map((event) => event.payload)).toEqual([{ key: "c" }, { key: "b" }]);
  });

  it("returns events without storing or dispatching when disabled", async () => {
    const bus = getEventBus(db, { enabled: false });
    const received: string[] = [];

    bus.subscribe("*", (event) => {
      received.push(event.id);
    });

    const event = await bus.publish({
      type: "config.changed",
      source: "test",
      payload: { key: "feature" },
    });
    await nextTick();

    expect(event.type).toBe("config.changed");
    expect(received).toEqual([]);
    expect(bus.listEvents({}).events).toEqual([]);
  });
});
