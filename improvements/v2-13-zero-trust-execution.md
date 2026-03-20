# Zero-Trust Execution Layer

## Current State

The Security Center (`Security.tsx`, `src/services/security.ts`) provides audit logging, rate limits, and an IP allowlist. The tool execution layer (`src/agent/tools/exec/module.ts`) has an `allowlist` scope system mapping to permission levels. However, there is no validation chain that verifies each action before execution, and the allowlist was recently found to have a privilege escalation bug (fixed in PR #86).

## Problem

- Tool execution trusts the agent's decisions without independent validation
- No pre-execution safety checks for potentially dangerous actions
- Sensitive operations (file writes, API calls, database changes) lack approval gates
- No sandboxing for untrusted or experimental tool executions
- Privilege escalation risks when adding new tools or modifying permissions
- No formal policy engine for defining what actions are allowed under what conditions

## What to Implement

### 1. Action Validation Pipeline
- **Pre-execution validation**: Every tool call passes through a validation chain before execution
- **Validation steps**:
  1. **Permission check**: Does this agent have permission to use this tool?
  2. **Parameter validation**: Are the parameters within allowed ranges?
  3. **Rate check**: Has this tool been called too frequently?
  4. **Risk assessment**: Is this a high-risk action requiring additional approval?
  5. **Policy evaluation**: Does this action comply with defined policies?
- **Validation result**: `allow | deny | require_approval`

### 2. Policy Engine
- **Policy definition format** (YAML):
  ```yaml
  policies:
    - name: "no-destructive-file-ops"
      match:
        tool: "exec"
        params:
          command: { pattern: "rm -rf|dd if=|mkfs" }
      action: deny
      reason: "Destructive file operations are blocked"
    - name: "api-calls-require-approval"
      match:
        tool: "http_request"
        params:
          method: { in: ["POST", "PUT", "DELETE"] }
      action: require_approval
  ```
- **Storage**: `security_policies (id, name, match JSON, action, reason, enabled, priority, created_at)`
- **Evaluation**: Policies evaluated in priority order; first match wins

### 3. Approval Gates
- **For `require_approval` actions**:
  - Push notification to admin via Telegram
  - WebUI approval queue with accept/reject buttons
  - Configurable auto-approve timeout (default: never auto-approve)
- **Approval log**: Every approval/rejection stored in audit trail
- **Delegation**: Specific users can be designated as approvers for specific action types

### 4. Execution Sandboxing
- **Sandbox modes**:
  - `unrestricted` — full access (current behavior, for trusted tools)
  - `sandboxed` — limited filesystem access, no network, resource limits
  - `dry-run` — execute but discard results (for testing)
- **Implementation**: Use Node.js `vm` module or subprocess with restricted permissions
- **Per-tool configuration**: Each tool can specify its required sandbox level

### 5. Security Policy UI
- **Location**: Enhance existing Security Center page
- **Features**:
  - Policy editor with syntax highlighting for YAML
  - Policy testing: "What would happen if tool X is called with params Y?"
  - Approval queue with real-time notifications
  - Validation log: recent allow/deny decisions with reasons
  - Policy templates for common security scenarios

### 6. Zero-Trust API
- `GET /api/security/policies` — list all policies
- `POST /api/security/policies` — create policy
- `PUT /api/security/policies/:id` — update policy
- `POST /api/security/policies/evaluate` — test a hypothetical action against policies
- `GET /api/security/approvals` — pending approval queue
- `POST /api/security/approvals/:id/approve` — approve an action
- `POST /api/security/approvals/:id/reject` — reject an action
- `GET /api/security/validation-log` — recent validation decisions

### Backend Architecture
- `src/services/policy-engine.ts` — policy evaluation engine
- `src/services/approval-gate.ts` — approval queue and notification
- `src/services/sandbox.ts` — execution sandboxing
- `src/agent/tools/validation.ts` — pre-execution validation pipeline

### Implementation Steps

1. Design policy schema and validation pipeline architecture
2. Implement policy engine with pattern matching and priority ordering
3. Create pre-execution validation middleware for tool calls
4. Implement approval gate with notification dispatch
5. Build execution sandbox using subprocess isolation
6. Create security policy API endpoints
7. Build policy editor and approval queue UI
8. Add policy templates for common scenarios
9. Integrate validation pipeline into `src/agent/tools/` execution path

### Files to Modify
- `src/services/` — new policy engine, approval gate, sandbox services
- `src/agent/tools/` — add validation middleware before tool execution
- `src/webui/routes/` — add security policy endpoints
- `web/src/pages/Security.tsx` — add policy editor and approval queue
- `config.example.yaml` — add security policy config

### Notes
- **High complexity** — policy engine and sandboxing are architecturally significant
- Start with the validation pipeline and basic allow/deny policies before adding approval gates
- Sandboxing in Node.js has limitations — `vm` module is not a security boundary; consider subprocess isolation
- Policy evaluation must be fast — it runs on every tool call
- Default policy should be permissive (allow) to avoid breaking existing functionality
- This is a foundation for enterprise-grade security requirements
