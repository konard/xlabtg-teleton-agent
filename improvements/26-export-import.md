# Export/Import Configuration

## Current State

Configuration is stored in `config.yaml` on the server. Tool states and hooks are managed via individual API calls. There is no way to export the entire configuration as a single bundle or import from a backup.

## Problem

- Cannot back up the complete agent configuration
- Cannot migrate configuration between instances
- Cannot share configuration with others
- Risk of losing configuration if server data is lost
- No version control for configuration changes

## What to Implement

### 1. Export All Configuration
- **Button**: "Export All" in Config page or Settings
- **Output**: Single JSON or YAML file containing:
  - Agent configuration (config.yaml contents)
  - Tool enable/scope states
  - Hook rules (blocklist + triggers)
  - Soul file contents (SOUL.md, SECURITY.md, etc.)
  - MCP server configurations
  - Plugin list (installed plugins)
- **Format**: JSON with metadata (export date, version, instance ID)

### 2. Import Configuration
- **Button**: "Import" in Config page
- **Input**: File upload (JSON/YAML)
- **Preview**: Show diff of what will change before applying
- **Options**:
  - "Replace all" — overwrite everything
  - "Merge" — only update changed fields, keep rest
  - "Tools only" / "Hooks only" / "Soul only" — selective import

### 3. API Endpoints
- `GET /api/export` — returns full configuration bundle
- `POST /api/import` — accepts configuration bundle, validates and applies
- `POST /api/import/preview` — returns diff without applying

### 4. Configuration Bundle Format
```json
{
  "version": "1.0",
  "exported_at": "2026-03-18T12:00:00Z",
  "app_version": "0.8.5",
  "config": { /* config.yaml contents */ },
  "tools": { /* tool states */ },
  "hooks": { /* hook rules */ },
  "soul": { /* soul file contents */ },
  "mcp": { /* MCP servers */ },
  "plugins": [ /* installed plugin list */ ]
}
```

### Implementation Steps

1. Create `src/services/export-import.ts` with gather/apply logic
2. Create API endpoints for export, import, preview
3. Create `<ExportImportPanel />` component
4. Add file upload handling for import
5. Create diff preview UI (show changes before applying)
6. Add to Config page or create standalone settings section
7. Add API calls in `web/src/lib/api.ts`

### Files to Create
- `src/services/export-import.ts` — export/import service
- `src/webui/routes/export-import.ts` — API routes
- `web/src/components/ExportImportPanel.tsx` — UI component

### Files to Modify
- `web/src/pages/Config.tsx` — add export/import section
- `web/src/lib/api.ts` — add API calls

### Notes
- Medium complexity — gathering config is straightforward, import validation is the hard part
- Sensitive data (API keys) should be excluded from export or encrypted
- Import should validate config schema before applying
- Consider auto-backup before import (prevent data loss)
