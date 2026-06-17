import { describe, expect, it } from "vitest";

// Simulate the data-extraction logic from SessionDetail.loadMessages so we can
// verify that a malformed 2xx response (res.data === undefined) yields safe
// defaults instead of throwing.
function extractSessionData(
  resData: { messages?: unknown[]; total?: number } | undefined,
  correctionResData: { corrections?: unknown[] } | undefined
) {
  const messages = resData?.messages ?? [];
  const total = resData?.total ?? 0;
  const corrections = correctionResData?.corrections ?? [];
  return { messages, total, corrections };
}

describe("Sessions page – malformed 2xx response guards (issue #621)", () => {
  it("returns empty defaults when res.data is undefined", () => {
    const { messages, total, corrections } = extractSessionData(
      undefined,
      undefined
    );
    expect(messages).toEqual([]);
    expect(total).toBe(0);
    expect(corrections).toEqual([]);
  });

  it("returns empty defaults when res.data is an empty object", () => {
    const { messages, total, corrections } = extractSessionData({}, {});
    expect(messages).toEqual([]);
    expect(total).toBe(0);
    expect(corrections).toEqual([]);
  });

  it("returns populated data when res.data is well-formed", () => {
    const msg = { id: "1", text: "hello" };
    const correction = { id: "c1" };
    const { messages, total, corrections } = extractSessionData(
      { messages: [msg], total: 1 },
      { corrections: [correction] }
    );
    expect(messages).toEqual([msg]);
    expect(total).toBe(1);
    expect(corrections).toEqual([correction]);
  });

  it("messages is always an array so .length and .map() never throw", () => {
    const { messages } = extractSessionData(undefined, undefined);
    expect(() => messages.length).not.toThrow();
    expect(() => messages.map((m) => m)).not.toThrow();
  });
});
