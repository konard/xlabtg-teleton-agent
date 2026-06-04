import { describe, expect, it, vi, beforeEach } from "vitest";

const timingSafeEqualMock = vi.hoisted(() =>
  vi.fn((left: Buffer, right: Buffer) => left.equals(right))
);

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    timingSafeEqual: timingSafeEqualMock,
  };
});

const { matchWebhookSecret } = await import("../workflow-scheduler.js");

describe("matchWebhookSecret", () => {
  beforeEach(() => {
    timingSafeEqualMock.mockClear();
  });

  it("uses timingSafeEqual for matching webhook secrets", () => {
    expect(matchWebhookSecret("abc123", "abc123")).toBe(true);

    expect(timingSafeEqualMock).toHaveBeenCalledTimes(1);
    const [expected, provided] = timingSafeEqualMock.mock.calls[0]!;
    expect(expected.toString()).toBe("abc123");
    expect(provided.toString()).toBe("abc123");
  });

  it("uses timingSafeEqual before rejecting equal-length mismatches", () => {
    expect(matchWebhookSecret("abc123", "abc124")).toBe(false);

    expect(timingSafeEqualMock).toHaveBeenCalledTimes(1);
  });

  it("rejects missing and mismatched-length webhook secrets", () => {
    expect(matchWebhookSecret(undefined, "abc123")).toBe(false);
    expect(matchWebhookSecret("abc123", "")).toBe(false);
    expect(matchWebhookSecret("abc123", "ab")).toBe(false);
  });
});
