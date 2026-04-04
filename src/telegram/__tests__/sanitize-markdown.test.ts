import { describe, it, expect } from "vitest";
import { sanitizeMarkdownForTelegram } from "../sanitize-markdown";

describe("sanitizeMarkdownForTelegram", () => {
  it("returns empty string for empty input", () => {
    expect(sanitizeMarkdownForTelegram("")).toBe("");
  });

  it("returns empty string for null/undefined-like falsy values", () => {
    // TypeScript callers pass strings, but guard against coerced bad input
    expect(sanitizeMarkdownForTelegram("")).toBe("");
  });

  it("leaves normal markdown unchanged", () => {
    const text = "Hello **world**!\n\nThis is `inline code`.";
    expect(sanitizeMarkdownForTelegram(text)).toBe(text);
  });

  it("removes empty fenced code blocks", () => {
    const text = "Before\n```python\n```\nAfter";
    const result = sanitizeMarkdownForTelegram(text);
    expect(result).not.toContain("```python");
    expect(result).toContain("Before");
    expect(result).toContain("After");
  });

  it("removes empty fenced code blocks without language tag", () => {
    const text = "Before\n```\n```\nAfter";
    const result = sanitizeMarkdownForTelegram(text);
    expect(result).not.toContain("```");
    expect(result).toContain("Before");
    expect(result).toContain("After");
  });

  it("removes empty code block with whitespace-only content", () => {
    const text = "Start\n```js\n   \n```\nEnd";
    const result = sanitizeMarkdownForTelegram(text);
    expect(result).not.toContain("```js");
  });

  it("preserves non-empty code blocks", () => {
    const text = "```python\nprint('hello')\n```";
    const result = sanitizeMarkdownForTelegram(text);
    expect(result).toContain("```python");
    expect(result).toContain("print('hello')");
    expect(result).toContain("```");
  });

  it("fixes unclosed code fence by appending closing ```", () => {
    const text = "Text before\n```python\ndef foo():\n    pass";
    const result = sanitizeMarkdownForTelegram(text);
    const fences = result.match(/```/g) ?? [];
    expect(fences.length % 2).toBe(0);
  });

  it("does not alter balanced code fences", () => {
    const text = "```js\nconst x = 1;\n```";
    const result = sanitizeMarkdownForTelegram(text);
    const fences = result.match(/```/g) ?? [];
    expect(fences.length % 2).toBe(0);
  });

  it("normalizes 4-backtick fences to triple backtick", () => {
    const text = "````python\ncode\n````";
    const result = sanitizeMarkdownForTelegram(text);
    expect(result).not.toContain("````");
    expect(result).toContain("```");
  });

  it("normalizes 5+-backtick fences to triple backtick", () => {
    const text = "`````\ncode\n`````";
    const result = sanitizeMarkdownForTelegram(text);
    expect(result).not.toContain("`````");
    expect(result).toContain("```");
  });

  it("trims leading and trailing whitespace", () => {
    const text = "  \n Hello world \n  ";
    expect(sanitizeMarkdownForTelegram(text)).toBe("Hello world");
  });

  it("handles multiple empty code blocks", () => {
    const text = "A\n```\n```\nB\n```js\n```\nC";
    const result = sanitizeMarkdownForTelegram(text);
    expect(result).not.toContain("```");
    expect(result).toContain("A");
    expect(result).toContain("B");
    expect(result).toContain("C");
  });
});
