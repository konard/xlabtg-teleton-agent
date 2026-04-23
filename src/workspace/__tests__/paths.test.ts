import { describe, expect, it } from "vitest";
import { assertSafeTeletonRoot } from "../paths.js";

describe("TELETON_ROOT startup validation", () => {
  it.each([
    "/home/user/.teleton",
    "/home/user-name/.teleton-data",
    "/home/o'brien/.teleton",
    "C:\\Users\\Alice\\.teleton",
    "C:/Users/Alice/.teleton",
  ])("accepts safe home path %s", (teletonRoot) => {
    expect(() => assertSafeTeletonRoot(teletonRoot)).not.toThrow();
  });

  it.each(["/tmp/bad`path", "/tmp/$bad", "/tmp/bad;rm -rf /", "/tmp/bad|command"])(
    "rejects shell metacharacter path %s",
    (teletonRoot) => {
      expect(() => assertSafeTeletonRoot(teletonRoot)).toThrow(
        "TELETON_ROOT contains unsafe characters"
      );
    }
  );
});
