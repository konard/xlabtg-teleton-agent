---
title: "[AUDIT/V4] Groq STT/TTS providers leak raw, untruncated upstream error bodies to API responses"
labels: ["bug", "audit-finding-v4", "medium", "v3.0-blocker", "security"]
milestone: "v3.0 - Production Ready"
audit-source: "#521"
finding-id: "WORK4-018"
severity: "medium"
category: "security"
github-issue: ""
---

## Problem Description

The Groq text provider sanitizes upstream error bodies (`sanitizeErrorBody`)
before surfacing them, but the STT and TTS providers throw the raw upstream
response body verbatim. These messages are surfaced through the WebUI Groq
routes, leaking unbounded upstream detail (and potentially request echoes /
internal identifiers) to API clients.

## Location

- `src/providers/groq/GroqSTTProvider.ts:89-93` (raw `errorBody` interpolated
  into the thrown message)
- `src/providers/groq/GroqTTSProvider.ts:88-92` (same)
- Contrast `src/providers/groq/GroqTextProvider.ts:22,85` which has and uses
  `sanitizeErrorBody`
- Surfaced at `src/webui/routes/groq.ts:269-271,333-335`

## How To Reproduce

1. Trigger a Groq STT or TTS call that fails upstream (e.g. invalid key / bad
   input).
2. Inspect the WebUI/API error response — it contains the raw, untruncated Groq
   error body.

## Impact

Information disclosure: verbose third-party error detail is reflected to clients,
which can leak internal context and aid attackers profiling the integration.

## Proposed Fix

- Extract `sanitizeErrorBody` into a shared helper and apply it in the STT and
  TTS providers (truncate + strip sensitive fields), matching the text provider.

## Regression Test

```typescript
it("sanitizes and truncates Groq STT/TTS upstream error bodies", async () => {
  mockGroqError(500, "x".repeat(5000) + " sk-secret-internal-detail");
  await expect(sttProvider.transcribe(audio)).rejects.toThrow();
  const err = await sttProvider.transcribe(audio).catch((e) => e.message);
  expect(err.length).toBeLessThan(512);
  expect(err).not.toContain("sk-secret-internal-detail");
});
```

## Acceptance Criteria

- [ ] STT/TTS errors are sanitized and length-bounded before surfacing.
- [ ] Tests assert raw upstream bodies are not reflected.

## Related Artifacts

- Report: `improvements/work4/AUDIT_V4_REPORT.md#work4-018`
- Module: `src/providers/groq/`, `src/webui/routes/groq.ts`
