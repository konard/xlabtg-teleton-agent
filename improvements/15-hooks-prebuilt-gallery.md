# Hooks — Pre-built Hooks Gallery

## Current State

The Hooks page (`web/src/pages/Hooks.tsx`) requires users to create all rules from scratch. There are no templates or pre-built hooks.

## Problem

- New users don't know what hooks are useful
- Common use cases require manual setup every time
- No way to discover community-created hooks
- Repetitive configuration across instances

## What to Implement

### 1. Hook Templates Gallery
- **Location**: "Browse Templates" button on Hooks page
- **Component**: `<HookGallery />` modal or slide-out panel
- **Categories**:
  - **Content Moderation**: "Block profanity", "Block spam patterns", "Block external links"
  - **Context Injection**: "Inject crypto context when $ mentioned", "Inject product info for keywords"
  - **Language**: "Auto-detect language", "Translate context injection"
  - **Security**: "Block sensitive data patterns (emails, phones)", "Rate limit trigger"

### 2. Template Format
- Each template is a JSON object:
  ```json
  {
    "name": "Block Profanity",
    "description": "Blocks messages containing common profanity",
    "category": "moderation",
    "type": "blocklist",
    "keywords": ["word1", "word2", "..."],
    "response": "Please keep the conversation respectful."
  }
  ```
- Stored as static data in `web/src/data/hook-templates.ts`

### 3. One-click Install
- Click "Install" on a template → adds keywords/triggers to current config
- Merge (don't replace) with existing hooks
- Show diff preview before applying: "Will add 15 keywords to blocklist"

### Implementation Steps

1. Create template data file with 10-15 pre-built hooks
2. Create `<HookGallery />` component with category filtering
3. Create `<HookTemplateCard />` component for each template
4. Add install logic that merges with existing hook configuration
5. Add "Browse Templates" button to Hooks page

### Files to Modify
- `web/src/pages/Hooks.tsx` — add gallery button
- `web/src/components/HookGallery.tsx` — new
- `web/src/components/HookTemplateCard.tsx` — new
- `web/src/data/hook-templates.ts` — new template data

### Notes
- Low complexity — frontend-only, no backend changes
- Templates are static data shipped with the frontend
- Future: could fetch community templates from a remote API
- Consider allowing users to export their hooks as a template
