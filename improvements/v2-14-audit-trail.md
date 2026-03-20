# Audit Trail System

## Current State

The Security Center (`src/services/audit.ts`) records admin mutations (configuration changes, security settings updates). The analytics service tracks request metrics. However, there is no comprehensive audit trail that captures all agent decisions, tool invocations, and their outcomes in a tamper-evident, queryable format suitable for compliance and forensic analysis.

## Problem

- Audit logging only covers admin mutations, not agent decisions
- No record of why the agent chose a specific tool or approach
- Cannot reconstruct the agent's decision chain for a given session
- No tamper-evidence or integrity verification for audit records
- Audit data is not structured for compliance reporting
- No export format for external audit systems (SIEM, compliance tools)

## What to Implement

### 1. Comprehensive Event Capture
- **Events to audit**:
  - `agent.decision` — agent chose to use tool X (with reasoning)
  - `tool.invoke` — tool called with specific parameters
  - `tool.result` — tool returned result (success/failure, duration)
  - `llm.request` — LLM API call (model, tokens, cost)
  - `llm.response` — LLM response (truncated content, token counts)
  - `config.change` — any configuration modification
  - `security.validation` — policy evaluation result (from v2-13)
  - `user.action` — user-initiated actions via WebUI
  - `session.lifecycle` — session start, end, timeout
- **Event schema**: `audit_events (id, event_type, actor, session_id, payload JSON, parent_event_id, checksum, created_at)`

### 2. Decision Chain Tracking
- **Causal linking**: Each event references its parent event (`parent_event_id`)
- **Chain reconstruction**: Given an outcome, trace back through the entire decision chain
- **Visualization**: Render decision trees showing agent reasoning flow
- **Example chain**: user_message → agent.decision(use_search) → tool.invoke(web_search) → tool.result → agent.decision(summarize) → llm.request → llm.response → user_response

### 3. Integrity Verification
- **Hash chaining**: Each event includes a SHA-256 checksum of `(previous_checksum + event_data)`
- **Verification endpoint**: `POST /api/audit/verify` — verify integrity of audit chain for a time range
- **Tamper detection**: Any modification to historical events breaks the hash chain
- **Export signing**: Exported audit data includes digital signatures

### 4. Compliance Reporting
- **Pre-built reports**:
  - Daily activity summary
  - Security events report (access, policy violations)
  - Cost and resource usage report
  - Tool usage and performance report
- **Export formats**: JSON, CSV, PDF
- **Filtering**: By event type, time range, session, actor, severity
- **Retention policy**: Configurable retention period (default: 90 days, compliance mode: 7 years)

### 5. Audit UI
- **Location**: Enhance Security Center with dedicated "Audit Trail" tab
- **Features**:
  - Searchable, filterable event timeline
  - Decision chain visualization (tree view)
  - Integrity status indicator (verified / chain broken)
  - Report generator with export options
  - Real-time event stream (via WebSocket)
  - Compliance dashboard with retention status

### 6. Audit API
- `GET /api/audit/events?type=...&from=...&to=...&session=...` — query events
- `GET /api/audit/chain/:event_id` — get full decision chain for an event
- `POST /api/audit/verify?from=...&to=...` — verify integrity
- `GET /api/audit/reports/:type?period=...&format=json` — generate report
- `POST /api/audit/export` — export audit data with signing

### Backend Architecture
- `src/services/audit-trail.ts` — comprehensive event capture and storage
- `src/services/audit-integrity.ts` — hash chaining and verification
- `src/services/audit-reports.ts` — report generation and export
- `src/webui/routes/audit.ts` — API endpoints

### Implementation Steps

1. Design `audit_events` table with hash chaining support
2. Implement event capture middleware for all agent operations
3. Add hash chaining for integrity verification
4. Hook event capture into agent runtime, tool execution, and LLM calls
5. Implement decision chain reconstruction
6. Build compliance report generator
7. Create audit export with signing
8. Build audit UI with timeline, chain viewer, and reports
9. Add retention policy management

### Files to Modify
- `src/services/` — new audit trail, integrity, and reporting services
- `src/services/audit.ts` — extend existing audit with comprehensive events
- `src/agent/runtime.ts` — add audit hooks for decisions and LLM calls
- `src/agent/tools/` — add audit hooks for tool invocations
- `src/webui/routes/` — add audit endpoints
- `web/src/pages/Security.tsx` — add Audit Trail tab
- `config.example.yaml` — add audit retention and export config

### Notes
- **High complexity** — comprehensive event capture touches every part of the system
- Hash chaining adds minimal overhead but provides strong tamper evidence
- Audit data grows fast — implement log rotation and archival from the start
- Truncate large payloads (LLM responses, tool results) to keep storage manageable
- Consider shipping events to external log aggregation (ELK, Splunk) via webhook
- This feature complements v2-13 (Zero-Trust) by providing the audit evidence for policy decisions
