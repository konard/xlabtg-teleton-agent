# Security Center — New Page

## Current State

Security features are scattered:
- API key login exists (token-based auth)
- SECURITY.md is editable in Soul Editor
- Config page has API key fields (masked)
- No audit logging of admin actions
- No IP restrictions or rate limiting on web UI
- No session management visibility

## Problem

- No audit trail of who changed what and when
- No security-specific dashboard
- Cannot set IP restrictions
- No visibility into active sessions
- Secret management is basic (plain config fields)
- No 2FA support for web UI

## What to Implement

### 1. Security Center Page (`/security`)
- **Route**: Add to `App.tsx` router and `Layout.tsx` sidebar
- **Sections**: Audit Log, Security Settings, Secrets Management

### 2. Audit Log
- **Display**: Scrollable table of all admin actions:
  - Timestamp
  - Action type (config change, tool toggle, soul edit, agent restart, etc.)
  - Details (what changed, old value → new value)
  - IP address / user agent (for web UI actions)
- **Filters**: By action type, date range
- **Export**: Download audit log as CSV

#### Backend
- Table: `audit_log (id, action, details, ip, user_agent, created_at)`
- Middleware: Log all API mutations (PUT, POST, DELETE) to audit table
- `GET /api/security/audit?page=1&type=config_change`

### 3. Security Settings
- **Session timeout**: Configure auto-logout after X minutes of inactivity
- **IP allowlist**: List of allowed IP addresses (empty = allow all)
- **Rate limiting**: Max requests per minute from web UI
- **Password change**: Update the API key / login token

#### Backend
- Store security settings in config or dedicated SQLite table
- Apply IP allowlist as middleware on all routes
- Apply rate limiting middleware (use Hono's built-in or `hono/rate-limiter`)

### 4. Secrets Management
- **Current secrets list**: Show all configured API keys (masked)
- **Rotation reminders**: "This key was last rotated X days ago"
- **Access log**: Who (timestamp) accessed which secret via API
- **Add/remove secrets**: UI for managing API keys for various services

### Implementation Steps

1. Create `audit_log` SQLite table
2. Create audit logging middleware for Hono server
3. Create `src/services/audit.ts` with audit operations
4. Create `src/services/security.ts` for security settings
5. Create API routes for audit and security
6. Create `web/src/pages/Security.tsx` page
7. Create `<AuditLog />`, `<SecuritySettings />`, `<SecretsManager />` components
8. Add IP allowlist and rate limiting middleware
9. Add route to `App.tsx` and nav item to `Layout.tsx`

### Files to Create
- `web/src/pages/Security.tsx` — new page
- `web/src/components/security/*.tsx` — security components
- `src/services/audit.ts` — audit service
- `src/services/security.ts` — security settings service
- `src/webui/routes/security.ts` — API routes
- `src/webui/middleware/audit.ts` — audit logging middleware

### Files to Modify
- `web/src/App.tsx` — add route
- `web/src/components/Layout.tsx` — add sidebar nav item
- `web/src/lib/api.ts` — add API calls
- `src/webui/` — add middleware

### Notes
- High complexity — significant backend security infrastructure
- Audit logging middleware should be one of the first things implemented
- 2FA support (TOTP) is a separate, even larger effort — consider as a future task
- IP allowlist must handle the case where admin locks themselves out
- Consider adding a "Security Score" indicator showing overall security posture
