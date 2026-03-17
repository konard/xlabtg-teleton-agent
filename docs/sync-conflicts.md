# Upstream Sync Conflict Resolution Log

**Date:** 2026-03-17
**Upstream:** `TONresistor/teleton-agent` @ `v0.8.5` (commit `3fd5732`)
**Fork base:** `xlabtg/teleton-agent` (commit `1c07711`)
**Common ancestor:** `1b3e28f` (fix(ci): telegram notifications only after CI/Release pass)
**Fork commits ahead:** 25
**Upstream commits ahead:** 37
**Strategy:** Merge (not rebase) to preserve fork history and avoid replaying 25 commits over 37

---

## Conflicting Files & Resolutions

### 1. `src/config/schema.ts`

**Fork added:** `export type GroqConfig` — type export for Groq multi-modal config
**Upstream added:** `export type HeartbeatConfig` — type export for heartbeat autonomy config
**Resolution:** **Keep both** — independent type exports that don't conflict semantically

```diff
+ export type GroqConfig = NonNullable<z.infer<typeof ConfigSchema>["groq"]>;
+ export type HeartbeatConfig = z.infer<typeof _HeartbeatObject>;
```

---

### 2. `src/webui/server.ts`

**Fork added:**
- Import: `import { createGroqRoutes } from "./routes/groq.js";`
- Route: `this.app.route("/api/groq", createGroqRoutes(this.deps));`

**Upstream added:**
- Import: `import { createTonProxyRoutes } from "./routes/ton-proxy.js";`
- Route: `this.app.route("/api/ton-proxy", createTonProxyRoutes(this.deps));`

**Resolution:** **Keep both** — fork's Groq routes and upstream's TON Proxy routes are independent features serving different endpoints

---

### 3. `vitest.config.ts`

**Fork had:** Higher coverage thresholds (fork added Groq + command access tests) + `autoUpdate: true`
```
statements: 18.83, branches: 15.95, functions: 22.5, lines: 18.96
```

**Upstream had:** Lower thresholds (upstream removed `autoUpdate` flag)
```
statements: 18.4, branches: 15.8, functions: 21.5, lines: 18.6
```

**Resolution:** Keep fork's **higher thresholds** (fork added more tests, so higher thresholds reflect actual coverage). Remove `autoUpdate: true` as upstream intentionally removed it (CI variance fix).

**Rationale:** Lower thresholds would weaken test quality guarantees. Fork's tests should not regress.

---

### 4. `web/src/lib/api.ts`

**Fork added:** Groq multi-modal API methods (lines ~643–689):
- `getGroqModels()`, `getGroqSttModels()`, `getGroqTtsModels()`, `getGroqTtsVoices()`
- `testGroqKey()`, `getGroqDebug()`, `getGroqHealth()`

**Upstream added:** TON Proxy API methods:
- `getTonProxyStatus()`, `startTonProxy()`, `stopTonProxy()`, `uninstallTonProxy()`

**Resolution:** **Keep both** — placed Groq section first (fork), then TON Proxy section (upstream). Both are independent API client additions.

---

### 5. `web/src/pages/Config.tsx`

**Fork added:** `{ id: 'commands', label: 'Commands' }` tab + `CommandControlsPanel` content block
**Upstream added:** `{ id: 'heartbeat', label: 'Heartbeat' }` tab + Heartbeat configuration UI block

**Resolution:** **Keep both** — both tabs added to `TABS` array. Commands tab renders `CommandControlsPanel` (fork feature). Heartbeat tab renders heartbeat enable/interval/self-configurable controls (upstream feature).

Tab order: `llm → telegram → commands → heartbeat → api-keys → ton-proxy → advanced → sessions → tool-rag`

---

## Features Preserved

| Feature | Files | Status |
|---------|-------|--------|
| Groq STT/TTS provider | `src/providers/groq/` | ✅ No conflict |
| Groq API routes | `src/webui/routes/groq.ts` | ✅ No conflict |
| Groq config schema | `src/config/schema.ts` | ✅ Merged |
| Groq config keys | `src/config/configurable-keys.ts` | ✅ Auto-merged |
| Groq web UI panel | `web/src/components/GroqSettingsPanel.tsx` | ✅ No conflict |
| Groq API client | `web/src/lib/api.ts` | ✅ Merged |
| Command access schema | `src/config/schema.ts` | ✅ No conflict |
| Command access logic | `src/telegram/admin.ts` | ✅ No conflict |
| Command controls UI | `web/src/components/CommandControlsPanel.tsx` | ✅ No conflict |
| Commands tab in Config | `web/src/pages/Config.tsx` | ✅ Merged |

## Upstream Features Integrated

| Feature | Key Files |
|---------|-----------|
| Heartbeat autonomy system | `src/templates/HEARTBEAT.md`, heartbeat config |
| HTTPS management API | `src/api/` (new directory with 15+ files) |
| Bootstrap mode | `src/api/bootstrap.ts` |
| TON Proxy module | `src/ton-proxy/` |
| SDK signed transfers | `packages/sdk/src/` |
| Parallel tool execution | `src/agent/runtime.ts` |
| Smarter RAG search | `src/memory/search/` |
| 156 new tests | Various `__tests__/` files |
| Security hardening | `src/workspace/harden-permissions.ts` |
| New providers | `src/config/model-catalog.ts` |
