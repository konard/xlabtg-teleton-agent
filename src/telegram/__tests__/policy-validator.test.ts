import { describe, it, expect } from "vitest";
import { validateDM, validateGroup } from "../policy-validator.js";
import type { TelegramConfig } from "../../config/schema.js";
import type { TelegramMessage } from "../bridge.js";

function makeConfig(overrides: Partial<TelegramConfig> = {}): TelegramConfig {
  return {
    api_id: 1,
    api_hash: "test",
    session_name: "test",
    admin_ids: [111],
    dm_policy: "open",
    group_policy: "open",
    allow_from: [],
    group_allow_from: [],
    require_mention: false,
    max_message_length: 4096,
    typing_simulation: false,
    rate_limit_messages_per_second: 30,
    rate_limit_groups_per_minute: 20,
    ...overrides,
  } as TelegramConfig;
}

function makeMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    id: 1,
    chatId: "chat1",
    senderId: 222,
    text: "hi",
    isGroup: false,
    isChannel: false,
    isBot: false,
    mentionsMe: false,
    timestamp: new Date(),
    hasMedia: false,
    ...overrides,
  };
}

describe("validateDM", () => {
  it('returns deny for dm_policy="disabled"', () => {
    const decision = validateDM(makeConfig({ dm_policy: "disabled" }), makeMessage(), false);
    expect(decision).toEqual({ shouldRespond: false, reason: "DMs disabled" });
  });

  it('denies non-admins for dm_policy="admin-only"', () => {
    const decision = validateDM(makeConfig({ dm_policy: "admin-only" }), makeMessage(), false);
    expect(decision).toEqual({ shouldRespond: false, reason: "DMs restricted to admins" });
  });

  it('allows admins for dm_policy="admin-only"', () => {
    const decision = validateDM(makeConfig({ dm_policy: "admin-only" }), makeMessage(), true);
    expect(decision.shouldRespond).toBe(true);
  });

  it('allows sender listed in allow_from for dm_policy="allowlist"', () => {
    const decision = validateDM(
      makeConfig({ dm_policy: "allowlist", allow_from: [222] }),
      makeMessage({ senderId: 222 }),
      false
    );
    expect(decision.shouldRespond).toBe(true);
  });

  it('allows admins bypassing allow_from for dm_policy="allowlist"', () => {
    const decision = validateDM(
      makeConfig({ dm_policy: "allowlist", allow_from: [] }),
      makeMessage({ senderId: 333 }),
      true
    );
    expect(decision.shouldRespond).toBe(true);
  });

  it('denies sender not in allow_from and not admin for dm_policy="allowlist"', () => {
    const decision = validateDM(
      makeConfig({ dm_policy: "allowlist", allow_from: [555] }),
      makeMessage({ senderId: 999 }),
      false
    );
    expect(decision).toEqual({ shouldRespond: false, reason: "Not in allowlist" });
  });

  it('allows everyone for dm_policy="open"', () => {
    const decision = validateDM(makeConfig({ dm_policy: "open" }), makeMessage(), false);
    expect(decision.shouldRespond).toBe(true);
  });
});

describe("validateGroup", () => {
  it('denies all for group_policy="disabled"', () => {
    const decision = validateGroup(
      makeConfig({ group_policy: "disabled" }),
      makeMessage({ isGroup: true }),
      true
    );
    expect(decision).toEqual({ shouldRespond: false, reason: "Groups disabled" });
  });

  it('denies non-admins for group_policy="admin-only"', () => {
    const decision = validateGroup(
      makeConfig({ group_policy: "admin-only" }),
      makeMessage({ isGroup: true }),
      false
    );
    expect(decision).toEqual({ shouldRespond: false, reason: "Groups restricted to admins" });
  });

  it('allows chat in group_allow_from for group_policy="allowlist"', () => {
    const decision = validateGroup(
      makeConfig({ group_policy: "allowlist", group_allow_from: [-100123] }),
      makeMessage({ isGroup: true, chatId: "-100123" }),
      false
    );
    expect(decision.shouldRespond).toBe(true);
  });

  it("rejects chatId with non-numeric suffix to prevent bypass", () => {
    const decision = validateGroup(
      makeConfig({ group_policy: "allowlist", group_allow_from: [-100123] }),
      makeMessage({ isGroup: true, chatId: "-100123abc" }),
      false
    );
    expect(decision).toEqual({ shouldRespond: false, reason: "Group not in allowlist" });
  });

  it("rejects NaN chatId strings", () => {
    const decision = validateGroup(
      makeConfig({ group_policy: "allowlist", group_allow_from: [-100123] }),
      makeMessage({ isGroup: true, chatId: "notanumber" }),
      false
    );
    expect(decision).toEqual({ shouldRespond: false, reason: "Group not in allowlist" });
  });

  it("denies when require_mention=true and not mentioned", () => {
    const decision = validateGroup(
      makeConfig({ group_policy: "open", require_mention: true }),
      makeMessage({ isGroup: true, mentionsMe: false }),
      false
    );
    expect(decision).toEqual({ shouldRespond: false, reason: "Not mentioned" });
  });

  it("allows when require_mention=true and mentioned", () => {
    const decision = validateGroup(
      makeConfig({ group_policy: "open", require_mention: true }),
      makeMessage({ isGroup: true, mentionsMe: true }),
      false
    );
    expect(decision.shouldRespond).toBe(true);
  });

  it("applies require_mention after policy allowlist check passes", () => {
    const decision = validateGroup(
      makeConfig({
        group_policy: "allowlist",
        group_allow_from: [-100123],
        require_mention: true,
      }),
      makeMessage({ isGroup: true, chatId: "-100123", mentionsMe: false }),
      false
    );
    expect(decision).toEqual({ shouldRespond: false, reason: "Not mentioned" });
  });
});
