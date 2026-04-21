# Prediction Engine

## Current State

The agent operates reactively — it waits for user input and then processes it. There is no analysis of user behavior patterns, no prediction of likely next actions, and no proactive suggestions. The existing analytics service (`src/services/analytics.ts`) records request metrics and costs but does not analyze patterns.

## Problem

- Agent is purely reactive — never anticipates user needs
- Repeated interaction patterns are not recognized or optimized
- Users must explicitly request everything, even routine tasks
- No learning from historical command sequences
- Missed opportunities for proactive assistance

## What to Implement

### 1. Behavior Pattern Analyzer
- **Data source**: Session history, tool invocations, message patterns from `request_metrics` and memory
- **Pattern types**:
  - **Sequential patterns**: User typically does A → B → C (e.g., check status → run tests → deploy)
  - **Temporal patterns**: User does X every Monday morning, Y at end of day
  - **Contextual patterns**: When discussing topic T, user usually needs tool Z
- **Storage**: `behavior_patterns (id, pattern_type, pattern JSON, confidence, frequency, last_seen, created_at)`

### 2. Prediction Model
- **Approach**: Lightweight Markov chain + frequency analysis (no heavy ML required)
  - Build transition probability matrix from action sequences
  - Weight by recency and frequency
- **Predictions**:
  - Next likely command/request
  - Tools likely to be needed
  - Related topics the user might ask about
- **Confidence threshold**: Only surface predictions above configurable confidence (default: 0.6)

### 3. Suggestions API
- `GET /api/predictions/next` — next predicted actions for current session context
- `GET /api/predictions/tools` — tools likely needed based on current conversation
- `GET /api/predictions/topics` — related topics the user might explore
- **Response format**: `[{ action: string, confidence: number, reason: string }]`

### 4. Proactive Agent Behavior
- **Pre-load tools**: When prediction confidence is high, pre-initialize likely tools
- **Suggestion injection**: Optionally append "You might also want to..." suggestions
- **Configurable**: `config.yaml` → `predictions.enabled: true`, `predictions.proactive_suggestions: false`

### 5. Prediction UI
- **Location**: Dashboard widget or sidebar panel
- **Features**:
  - "Suggested next actions" card
  - Confidence indicators (progress bars)
  - One-click action execution from suggestions
  - "Not helpful" feedback to improve predictions

### Backend Architecture
- `src/services/predictions.ts` — pattern analysis and prediction engine
- `src/services/behavior-tracker.ts` — action sequence recording
- `src/webui/routes/predictions.ts` — API endpoints

### Implementation Steps

1. Create behavior tracking middleware in agent runtime
2. Design pattern storage schema
3. Implement Markov chain-based prediction model
4. Build pattern analyzer for sequential, temporal, and contextual patterns
5. Create predictions API endpoints
6. Integrate pre-loading for high-confidence tool predictions
7. Build suggestion UI widget
8. Add configuration options

### Files to Modify
- `src/services/` — new prediction and behavior tracking services
- `src/agent/runtime.ts` — add behavior tracking hooks
- `src/webui/routes/` — add prediction endpoints
- `web/src/components/` — add suggestion widget
- `web/src/pages/Dashboard.tsx` — integrate prediction widget
- `config.example.yaml` — add prediction config

### Notes
- **High complexity** — pattern analysis requires significant data and tuning
- Start with simple sequential pattern matching before adding temporal/contextual
- Predictions improve with usage — initial period will have low confidence
- Be careful with proactive suggestions: annoying suggestions are worse than no suggestions
- Privacy consideration: behavior patterns may be sensitive; respect data retention settings from v2-03
