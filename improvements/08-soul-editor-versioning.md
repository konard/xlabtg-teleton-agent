# Soul Editor — Version Control

## Current State

The Soul Editor saves files directly via `PUT /api/soul/:filename`. There is no version history — each save overwrites the previous content. The only recovery option is to re-type the content.

## Problem

- Accidental overwrites cannot be undone
- No history of prompt iterations and experiments
- Cannot compare different versions
- No way to roll back to a previous version that worked better
- No auto-save draft protection

## What to Implement

### 1. Version History Backend
- **Storage**: SQLite table `soul_versions`:
  ```sql
  CREATE TABLE soul_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    content TEXT NOT NULL,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```
- **Automatic versioning**: Every save creates a new version
- **API Endpoints**:
  - `GET /api/soul/:filename/versions` — list versions (id, comment, created_at, content_length)
  - `GET /api/soul/:filename/versions/:id` — get specific version content
  - `POST /api/soul/:filename/versions` — save with optional comment
  - `DELETE /api/soul/:filename/versions/:id` — delete a version

### 2. "Save Version" Button
- Next to existing save button
- Opens dialog: "Version comment (optional): ___"
- Creates a named snapshot users can find later

### 3. Version History Panel
- **Component**: `<VersionHistory />` sidebar or modal
- Shows list of versions with: date, comment (if any), content size
- Click version → loads content into editor (with unsaved changes warning)
- "Restore" button to revert to a selected version

### 4. Diff View
- **Library**: [diff](https://www.npmjs.com/package/diff) (~10KB) or [diff2html](https://diff2html.xyz/)
- Compare any two versions side-by-side
- Highlight additions (green) and deletions (red)
- Compare current editor content vs. any saved version

### 5. Auto-save Draft
- Save draft to `localStorage` every 30 seconds while editing
- On page load, check for draft newer than server version
- Show "Restore draft?" prompt if unsaved draft exists
- Clear draft on successful save

### Implementation Steps

1. Create `soul_versions` SQLite table (migration)
2. Create `src/services/soul-versions.ts` with CRUD operations
3. Add version API routes in `src/webui/routes/`
4. Create `<VersionHistory />` frontend component
5. Add "Save Version" button with comment dialog
6. Install diff library, create `<DiffView />` component
7. Implement auto-save draft logic in Soul page
8. Add API calls in `web/src/lib/api.ts`

### Files to Modify
- SQLite schema — add `soul_versions` table
- `src/services/soul-versions.ts` — new
- `src/webui/routes/` — add version routes
- `web/src/pages/Soul.tsx` — add version history UI
- `web/src/components/VersionHistory.tsx` — new
- `web/src/components/DiffView.tsx` — new
- `web/src/lib/api.ts` — add version API calls
- `web/package.json` — add diff library

### Notes
- High complexity due to backend storage + diff rendering
- Auto-save draft is independent and can be implemented first (localStorage only)
- Consider limiting version count per file (e.g., keep last 50)
- Version cleanup: auto-delete versions older than 90 days (configurable)
