# Hooks — Visual Rule Builder

## Current State

The Hooks page (`web/src/pages/Hooks.tsx`) has two sections:
1. **Keyword Blocklist**: Simple word list with word-boundary matching and a customizable blocking response
2. **Context Triggers**: List of entries with keyword → context text injection, enable/disable toggles

Rules are created by typing keyword + context text into input fields.

## Problem

- Creating complex rules requires understanding the keyword matching system
- No visual feedback on how rules interact
- Cannot create conditional logic (IF-THEN chains)
- No drag-and-drop for rule ordering/priority
- Hard to understand rule evaluation order

## What to Implement

### 1. Visual Rule Builder Interface
- **Concept**: Block-based rule editor (similar to Scratch or Zapier)
- **Blocks**:
  - **Trigger block** (blue): "When message contains [keyword]"
  - **Condition block** (yellow): "AND user is [admin/any]", "AND chat type is [dm/group]"
  - **Action block** (green): "Inject context: [text]", "Block message", "Log event"
- **Connection**: Blocks snap together vertically to form rules
- **Drag-and-drop**: Reorder blocks and rules

### 2. Rule Types
- **Block rule**: keyword → block message (with custom response)
- **Inject rule**: keyword → inject context into agent prompt
- **Transform rule**: keyword → replace/modify message before processing
- **Notify rule**: keyword → send notification to admin

### 3. Rule Testing
- Integrated with Testing Panel (task #14)
- Visual highlight showing which blocks activate for test input

### Library Options
- **[react-flow](https://reactflow.dev/)**: Node-based visual editor (~200KB) — powerful but possibly overkill
- **Custom implementation**: Simple block stacking with drag-and-drop — lighter, more appropriate for linear rules
- **[dnd-kit](https://dndkit.com/)**: Lightweight drag-and-drop (~20KB) for reordering

### Implementation Steps

1. Design block component system (`TriggerBlock`, `ConditionBlock`, `ActionBlock`)
2. Install `@dnd-kit/core` for drag-and-drop
3. Create `<RuleBuilder />` main component
4. Create block palette (sidebar with available blocks)
5. Create rule canvas (where blocks are assembled)
6. Implement rule serialization (blocks → JSON config)
7. Backend: extend hook storage to support structured rules
8. Add backward compatibility with existing keyword-based hooks

### Files to Modify
- `web/package.json` — add dnd-kit
- `web/src/pages/Hooks.tsx` — integrate rule builder
- `web/src/components/hooks/RuleBuilder.tsx` — new
- `web/src/components/hooks/blocks/*.tsx` — block components
- `src/agent/hooks/` — extend hook processing for structured rules
- `src/webui/routes/` — update hook API for structured rules

### Notes
- High complexity — this is a significant UI effort
- Consider keeping the existing simple interface as "Basic Mode"
- Visual builder would be "Advanced Mode"
- Start with simple block stacking, add conditions later
- Rule evaluation order matters — ensure clear visual priority
