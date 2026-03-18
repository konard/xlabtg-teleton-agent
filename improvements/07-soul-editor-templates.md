# Soul Editor — Templates & Examples

## Current State

The Soul Editor (`web/src/pages/Soul.tsx`) allows editing 5 system prompt files but provides no templates or examples. New users must write prompts from scratch with no guidance.

## Problem

- New users don't know what makes a good system prompt
- No starting points for common use cases
- Users must manually research prompt engineering patterns
- No way to share or discover community-created prompts

## What to Implement

### 1. Template Dropdown
- **Location**: Above the editor, next to file tabs
- **Component**: `<TemplateSelector />` dropdown
- **Templates** (built-in):
  - "Helpful Assistant" — general-purpose conversational agent
  - "Coding Expert" — programming-focused with code conventions
  - "Trading Bot" — crypto/financial analysis focus
  - "Customer Support" — polite, structured responses
  - "Knowledge Worker" — research and analysis focus
- **Action**: "Load Template" replaces current editor content (with confirmation dialog if unsaved changes)

### 2. Template Storage
- Store templates as static files: `web/src/data/templates/`
- Each template is a `.md` file with frontmatter:
  ```yaml
  ---
  name: "Helpful Assistant"
  description: "General-purpose conversational agent"
  category: "general"
  ---
  # System Prompt content here...
  ```
- Import templates at build time (Vite handles static imports)

### 3. "Load Example" Button
- Quick button to load a minimal working example for the current file type
- Different examples for SOUL.md, SECURITY.md, STRATEGY.md, etc.
- Each file type gets its own example explaining expected format and fields

### Implementation Steps

1. Create template files in `web/src/data/templates/`
2. Create `<TemplateSelector />` dropdown component
3. Add confirmation dialog for loading templates (protects unsaved work)
4. Integrate into Soul page header
5. Create examples for each file type (SOUL, SECURITY, STRATEGY, MEMORY, HEARTBEAT)

### Files to Modify
- `web/src/pages/Soul.tsx` — add template selector
- `web/src/components/TemplateSelector.tsx` — new
- `web/src/data/templates/*.md` — new template files (5-7 files)

### Notes
- This is a low-complexity, high-value task — good starting point
- Templates are frontend-only, no backend changes needed
- Consider adding a "community templates" link to a future gallery (external URL)
- Confirmation dialog prevents accidental overwrites
