# Hooks — Testing Panel

## Current State

The Hooks page (`web/src/pages/Hooks.tsx`) allows creating keyword blocklist entries and context triggers, but there is no way to test rules without sending actual messages through Telegram.

## Problem

- Users cannot verify hook behavior before going live
- Debugging hook issues requires trial-and-error with real messages
- No visibility into which hooks fire for a given input
- No step-by-step execution trace

## What to Implement

### 1. Test Input Panel
- **Location**: Bottom of Hooks page or a slide-out panel
- **Component**: `<HookTestPanel />`
- **Input**: Text area labeled "Test your message"
- **Button**: "Test Hooks"
- **Output**: Shows which hooks would fire and what actions would be taken

### 2. Test Results Display
- For each matching hook:
  - Hook name/keyword that matched
  - Action type (block / inject context / etc.)
  - Result text (blocking response or injected context)
- For non-matching hooks: greyed out "No match"
- Overall result: "Message would be: BLOCKED" or "Context injected: X characters"

### 3. Debug Mode
- Toggle "Debug mode" to show step-by-step processing:
  1. "Checking keyword blocklist..."
  2. "Keyword 'price' matched in blocklist → BLOCKED"
  3. "Checking context triggers..."
  4. "Trigger 'crypto' matched → injecting 120 chars of context"
- Shows processing order and evaluation chain

### Backend Requirements
- **Endpoint**: `POST /api/hooks/test`
- **Body**: `{ message: "test message text" }`
- **Response**: `{ blocked: boolean, blockResponse: string, triggeredHooks: [...], injectedContext: string }`
- Uses the same hook evaluation logic as the real message pipeline, but returns results instead of acting

### Implementation Steps

1. Create `POST /api/hooks/test` endpoint in backend
2. Refactor hook evaluation logic into a testable function that returns results
3. Create `<HookTestPanel />` frontend component
4. Create `<TestResult />` component for displaying results
5. Add debug mode with step-by-step trace
6. Integrate into Hooks page

### Files to Modify
- `web/src/pages/Hooks.tsx` — add test panel
- `web/src/components/HookTestPanel.tsx` — new
- `src/agent/hooks/` — refactor hook evaluation to be testable
- `src/webui/routes/` — add hooks test endpoint
- `web/src/lib/api.ts` — add test API call

### Notes
- Medium complexity — requires backend refactoring of hook evaluation
- The test endpoint should NOT send any actual messages or trigger real actions
- Consider keyboard shortcut: Ctrl+Enter to run test
- Show a clear visual distinction between test results and live behavior
