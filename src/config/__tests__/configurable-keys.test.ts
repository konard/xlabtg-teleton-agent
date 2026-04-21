import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import {
  CONFIGURABLE_KEYS,
  getNestedValue,
  setNestedValue,
  deleteNestedValue,
} from "../configurable-keys.js";

// ── New scalar keys ─────────────────────────────────────────────────────

describe("CONFIGURABLE_KEYS — new scalar entries", () => {
  describe("agent.base_url", () => {
    const meta = CONFIGURABLE_KEYS["agent.base_url"];

    it("accepts valid URL", () => {
      expect(meta.validate("https://localhost:11434")).toBeUndefined();
    });

    it("accepts empty string (reset)", () => {
      expect(meta.validate("")).toBeUndefined();
    });

    it("rejects invalid URL", () => {
      expect(meta.validate("not-a-url")).toBeDefined();
    });
  });

  describe("telegram.owner_id", () => {
    const meta = CONFIGURABLE_KEYS["telegram.owner_id"];

    it("accepts positive integer", () => {
      expect(meta.validate("123456789")).toBeUndefined();
    });

    it("rejects negative number", () => {
      expect(meta.validate("-1")).toBeDefined();
    });

    it("rejects non-numeric", () => {
      expect(meta.validate("abc")).toBeDefined();
    });

    it("parses to number", () => {
      expect(meta.parse("123456789")).toBe(123456789);
    });
  });

  describe("telegram.max_message_length", () => {
    const meta = CONFIGURABLE_KEYS["telegram.max_message_length"];

    it("accepts within range 1-32768", () => {
      expect(meta.validate("4096")).toBeUndefined();
    });

    it("rejects zero", () => {
      expect(meta.validate("0")).toBeDefined();
    });

    it("rejects above max", () => {
      expect(meta.validate("99999")).toBeDefined();
    });
  });

  describe("telegram.rate_limit_messages_per_second", () => {
    const meta = CONFIGURABLE_KEYS["telegram.rate_limit_messages_per_second"];

    it("accepts 0.1-10 range", () => {
      expect(meta.validate("1.5")).toBeUndefined();
    });

    it("rejects zero", () => {
      expect(meta.validate("0")).toBeDefined();
    });

    it("description contains 'requires restart'", () => {
      expect(meta.description).toContain("requires restart");
    });
  });

  describe("telegram.rate_limit_groups_per_minute", () => {
    const meta = CONFIGURABLE_KEYS["telegram.rate_limit_groups_per_minute"];

    it("accepts 1-60 range", () => {
      expect(meta.validate("20")).toBeUndefined();
    });

    it("rejects zero", () => {
      expect(meta.validate("0")).toBeDefined();
    });

    it("description contains 'requires restart'", () => {
      expect(meta.description).toContain("requires restart");
    });
  });

  describe("embedding.model", () => {
    const meta = CONFIGURABLE_KEYS["embedding.model"];

    it("accepts any non-empty string", () => {
      expect(meta.validate("all-MiniLM-L6-v2")).toBeUndefined();
    });

    it("accepts empty (reset to default)", () => {
      expect(meta.validate("")).toBeUndefined();
    });

    it("description contains 'requires restart'", () => {
      expect(meta.description).toContain("requires restart");
    });
  });

  describe("vector memory Upstash keys", () => {
    it("exposes Upstash access fields as configurable keys", () => {
      expect(CONFIGURABLE_KEYS["vector_memory.upstash_rest_url"]).toMatchObject({
        type: "string",
        category: "Vector Memory",
        sensitive: false,
      });
      expect(CONFIGURABLE_KEYS["vector_memory.upstash_rest_token"]).toMatchObject({
        type: "string",
        category: "Vector Memory",
        sensitive: true,
      });
      expect(CONFIGURABLE_KEYS["vector_memory.namespace"]).toMatchObject({
        type: "string",
        category: "Vector Memory",
        sensitive: false,
      });
    });

    it("validates Upstash URL and namespace values", () => {
      const urlMeta = CONFIGURABLE_KEYS["vector_memory.upstash_rest_url"];
      const namespaceMeta = CONFIGURABLE_KEYS["vector_memory.namespace"];

      expect(urlMeta.validate("https://steady-fox-123.upstash.io")).toBeUndefined();
      expect(urlMeta.validate("ftp://steady-fox-123.upstash.io")).toBeDefined();
      expect(namespaceMeta.validate("teleton-memory")).toBeUndefined();
      expect(namespaceMeta.validate("")).toBeDefined();
    });
  });

  describe("deals.expiry_seconds", () => {
    const meta = CONFIGURABLE_KEYS["deals.expiry_seconds"];

    it("accepts 10-3600", () => {
      expect(meta.validate("120")).toBeUndefined();
    });

    it("rejects below min", () => {
      expect(meta.validate("5")).toBeDefined();
    });
  });

  describe("deals.buy_max_floor_percent", () => {
    const meta = CONFIGURABLE_KEYS["deals.buy_max_floor_percent"];

    it("accepts 1-100", () => {
      expect(meta.validate("95")).toBeUndefined();
    });

    it("rejects above 100", () => {
      expect(meta.validate("101")).toBeDefined();
    });
  });

  describe("deals.sell_min_floor_percent", () => {
    const meta = CONFIGURABLE_KEYS["deals.sell_min_floor_percent"];

    it("accepts 100-500", () => {
      expect(meta.validate("105")).toBeUndefined();
    });

    it("rejects below 100", () => {
      expect(meta.validate("99")).toBeDefined();
    });
  });

  describe("cocoon.port", () => {
    const meta = CONFIGURABLE_KEYS["cocoon.port"];

    it("accepts 1-65535", () => {
      expect(meta.validate("10000")).toBeUndefined();
    });

    it("rejects 0", () => {
      expect(meta.validate("0")).toBeDefined();
    });

    it("description contains 'requires restart'", () => {
      expect(meta.description).toContain("requires restart");
    });
  });

  describe("prediction keys", () => {
    it("exposes prediction engine fields as configurable keys", () => {
      expect(CONFIGURABLE_KEYS["predictions.enabled"]).toMatchObject({
        type: "boolean",
        category: "Predictions",
      });
      expect(CONFIGURABLE_KEYS["predictions.confidence_threshold"]).toMatchObject({
        type: "number",
        category: "Predictions",
      });
      expect(CONFIGURABLE_KEYS["predictions.proactive_suggestions"]).toMatchObject({
        type: "boolean",
        category: "Predictions",
      });
    });

    it("validates prediction numeric bounds", () => {
      expect(CONFIGURABLE_KEYS["predictions.confidence_threshold"].validate("0.6")).toBeUndefined();
      expect(CONFIGURABLE_KEYS["predictions.confidence_threshold"].validate("1.5")).toBeDefined();
      expect(CONFIGURABLE_KEYS["predictions.max_suggestions"].validate("5")).toBeUndefined();
      expect(CONFIGURABLE_KEYS["predictions.max_suggestions"].validate("11")).toBeDefined();
      expect(CONFIGURABLE_KEYS["predictions.history_limit"].validate("5000")).toBeUndefined();
      expect(CONFIGURABLE_KEYS["predictions.history_limit"].validate("50")).toBeDefined();
    });
  });
});

// ── Array keys ──────────────────────────────────────────────────────────

describe("CONFIGURABLE_KEYS — array entries", () => {
  describe("telegram.admin_ids", () => {
    const meta = CONFIGURABLE_KEYS["telegram.admin_ids"];

    it("has type 'array'", () => {
      expect(meta.type).toBe("array");
    });

    it("has itemType 'number'", () => {
      expect(meta.itemType).toBe("number");
    });

    it("validates positive integer per item", () => {
      expect(meta.validate("123456")).toBeUndefined();
    });

    it("rejects non-numeric item", () => {
      expect(meta.validate("abc")).toBeDefined();
    });

    it("rejects negative item", () => {
      expect(meta.validate("-5")).toBeDefined();
    });

    it("parses string to number", () => {
      expect(meta.parse("123456")).toBe(123456);
    });
  });

  describe("telegram.allow_from", () => {
    const meta = CONFIGURABLE_KEYS["telegram.allow_from"];

    it("has type 'array' with itemType 'number'", () => {
      expect(meta.type).toBe("array");
      expect(meta.itemType).toBe("number");
    });

    it("validates positive integer per item", () => {
      expect(meta.validate("999")).toBeUndefined();
    });

    it("rejects non-numeric item", () => {
      expect(meta.validate("xyz")).toBeDefined();
    });

    it("parses string to number", () => {
      expect(meta.parse("999")).toBe(999);
    });
  });

  describe("telegram.group_allow_from", () => {
    const meta = CONFIGURABLE_KEYS["telegram.group_allow_from"];

    it("has type 'array' with itemType 'number'", () => {
      expect(meta.type).toBe("array");
      expect(meta.itemType).toBe("number");
    });

    it("validates positive integer per item", () => {
      expect(meta.validate("777")).toBeUndefined();
    });

    it("rejects non-numeric item", () => {
      expect(meta.validate("bad")).toBeDefined();
    });

    it("parses string to number", () => {
      expect(meta.parse("777")).toBe(777);
    });
  });
});

// ── Existing keys not broken ────────────────────────────────────────────

describe("existing keys unchanged", () => {
  it("all original keys still present (at least 27)", () => {
    expect(Object.keys(CONFIGURABLE_KEYS).length).toBeGreaterThanOrEqual(27);
  });

  it("agent.api_key still validates >= 10 chars", () => {
    const meta = CONFIGURABLE_KEYS["agent.api_key"];
    expect(meta.validate("short")).toBeDefined();
    expect(meta.validate("long-enough-key-here")).toBeUndefined();
  });

  it("agent.provider still has all 16 options", () => {
    const meta = CONFIGURABLE_KEYS["agent.provider"];
    expect(meta.options).toHaveLength(16);
    expect(meta.options).toContain("nvidia");
  });
});

// ── Prototype-injection hardening ──────────────────────────────────────
//
// Regression tests for https://github.com/xlabtg/teleton-agent/issues/190.
// getNestedValue / setNestedValue / deleteNestedValue must never traverse
// into Object.prototype or any other inherited property, and must reject
// any path segment that could escape to a prototype chain (including
// case-folded variants and nested occurrences).

describe("nested-value helpers — prototype-injection hardening", () => {
  describe("getNestedValue", () => {
    it("rejects top-level __proto__", () => {
      expect(() => getNestedValue({}, "__proto__")).toThrow(/forbidden/i);
    });

    it("rejects nested __proto__ segment", () => {
      expect(() => getNestedValue({}, "foo.__proto__.polluted")).toThrow(/forbidden/i);
    });

    it("rejects 'constructor' segment", () => {
      expect(() => getNestedValue({}, "constructor")).toThrow(/forbidden/i);
    });

    it("rejects 'prototype' segment", () => {
      expect(() => getNestedValue({}, "constructor.prototype")).toThrow(/forbidden/i);
    });

    it("rejects case-folded __PROTO__", () => {
      expect(() => getNestedValue({}, "__PROTO__")).toThrow(/forbidden/i);
    });

    it("rejects mixed-case Constructor", () => {
      expect(() => getNestedValue({}, "Constructor")).toThrow(/forbidden/i);
    });

    it("does not return inherited Object.prototype members", () => {
      // Before the fix, getNestedValue({}, "toString") returned the
      // inherited Object.prototype.toString function. It must now return
      // undefined for any non-own property.
      expect(getNestedValue({}, "toString")).toBeUndefined();
      expect(getNestedValue({}, "hasOwnProperty")).toBeUndefined();
      expect(getNestedValue({}, "valueOf")).toBeUndefined();
    });

    it("returns own properties normally", () => {
      const obj = { a: { b: { c: 42 } } };
      expect(getNestedValue(obj, "a.b.c")).toBe(42);
    });

    it("returns undefined for missing own paths", () => {
      const obj = { a: 1 };
      expect(getNestedValue(obj, "a.b.c")).toBeUndefined();
      expect(getNestedValue(obj, "missing")).toBeUndefined();
    });

    it("rejects empty segments", () => {
      expect(() => getNestedValue({}, "")).toThrow(/invalid/i);
      expect(() => getNestedValue({}, "a..b")).toThrow(/invalid/i);
    });
  });

  describe("setNestedValue", () => {
    it("rejects __proto__ segment", () => {
      const obj = {};
      expect(() => setNestedValue(obj, "__proto__.polluted", true)).toThrow(/forbidden/i);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("rejects nested __proto__ segment", () => {
      const obj: Record<string, unknown> = {};
      expect(() => setNestedValue(obj, "a.__proto__.polluted", true)).toThrow(/forbidden/i);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("rejects 'constructor.prototype' chain", () => {
      const obj = {};
      expect(() => setNestedValue(obj, "constructor.prototype.polluted", true)).toThrow(
        /forbidden/i
      );
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("rejects case-folded __PROTO__", () => {
      const obj = {};
      expect(() => setNestedValue(obj, "__PROTO__.polluted", true)).toThrow(/forbidden/i);
    });

    it("rejects empty segments", () => {
      expect(() => setNestedValue({}, "", 1)).toThrow(/invalid/i);
      expect(() => setNestedValue({}, "a..b", 1)).toThrow(/invalid/i);
    });

    it("sets own properties normally", () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, "a.b.c", 7);
      expect(obj).toEqual({ a: { b: { c: 7 } } });
    });
  });

  describe("deleteNestedValue", () => {
    it("rejects __proto__ segment", () => {
      expect(() => deleteNestedValue({}, "__proto__")).toThrow(/forbidden/i);
    });

    it("rejects nested __proto__ segment", () => {
      expect(() => deleteNestedValue({}, "a.__proto__.x")).toThrow(/forbidden/i);
    });

    it("rejects case-folded variant", () => {
      expect(() => deleteNestedValue({}, "__Proto__")).toThrow(/forbidden/i);
    });

    it("rejects empty segments", () => {
      expect(() => deleteNestedValue({}, "")).toThrow(/invalid/i);
      expect(() => deleteNestedValue({}, "a..b")).toThrow(/invalid/i);
    });

    it("deletes own properties normally", () => {
      const obj: Record<string, unknown> = { a: { b: { c: 1 } } };
      deleteNestedValue(obj, "a.b.c");
      expect(obj).toEqual({ a: { b: {} } });
    });
  });
});
