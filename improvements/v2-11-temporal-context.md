# Temporal Context Engine

## Current State

The agent treats all context as atemporal — no distinction between information from today vs. months ago. Session history is ordered by timestamp but the agent does not adapt its behavior based on time-of-day, day-of-week, or temporal patterns. The existing analytics records timestamps but does not use them for context adaptation.

## Problem

- Agent behavior is identical at 9am on Monday and 11pm on Saturday
- No awareness of temporal patterns in user behavior
- Stale context is weighted the same as fresh context
- Cannot reason about "last time this happened" or "this usually happens on Fridays"
- Time-sensitive information (deadlines, schedules) is not treated differently

## What to Implement

### 1. Temporal Metadata
- **Enrich all stored data** with temporal dimensions:
  - Absolute timestamp (already exists)
  - Day of week, hour of day (derived)
  - Relative time markers ("morning", "evening", "weekend", "weekday")
  - Session context: beginning/middle/end of conversation
- **Storage**: Add temporal columns to existing tables or a `temporal_metadata` overlay table

### 2. Time Pattern Analysis
- **Patterns to detect**:
  - **Daily patterns**: User asks about X mostly in the morning
  - **Weekly patterns**: Reporting tasks happen on Mondays, deployments on Thursdays
  - **Recurring events**: "Check status" happens every day at 10am
  - **Seasonal/periodic**: End-of-month tasks, quarterly reviews
- **Storage**: `time_patterns (id, pattern_type, description, schedule_cron, confidence, last_seen, created_at)`

### 3. Context Time-Weighting
- **Freshness scoring**: Recent context weighted higher in retrieval
- **Temporal relevance**: When it's Monday morning, boost context related to Monday-morning patterns
- **Decay function**: Configurable decay curve (exponential, linear, step)
- **Integration**: Feed temporal weights into memory prioritization (v2-03) and semantic search (v2-01)

### 4. Time-Aware Agent Behavior
- **Greeting adaptation**: "Good morning" vs "Good evening" based on user timezone
- **Proactive reminders**: "It's Monday — would you like the weekly status report?"
- **Context pre-loading**: Load relevant context based on current time patterns
- **Deadline awareness**: Flag time-sensitive information in memory

### 5. Temporal Context API
- `GET /api/context/temporal?time=now` — get current temporal context and active patterns
- `GET /api/context/patterns` — list detected time patterns
- `PUT /api/context/patterns/:id` — adjust pattern (user feedback)
- `GET /api/context/timeline?from=...&to=...` — activity timeline for a period

### Backend Architecture
- `src/services/temporal-context.ts` — temporal metadata enrichment and pattern detection
- `src/services/time-patterns.ts` — pattern analysis and storage
- `src/webui/routes/temporal.ts` — API endpoints

### Implementation Steps

1. Add temporal metadata enrichment to data storage pipeline
2. Implement time pattern detection algorithm
3. Build temporal weighting for context retrieval
4. Integrate with memory prioritization and semantic search
5. Implement time-aware agent behavior (greetings, reminders)
6. Create temporal context API endpoints
7. Build time pattern UI on Analytics or Memory page
8. Add timezone configuration support

### Files to Modify
- `src/services/` — new temporal context and time pattern services
- `src/memory/` — integrate temporal weighting into retrieval
- `src/agent/runtime.ts` — inject temporal context into agent processing
- `src/webui/routes/` — add temporal endpoints
- `web/src/pages/Analytics.tsx` — add temporal patterns section
- `config.example.yaml` — add timezone and temporal config

### Notes
- **Medium complexity** — pattern detection is straightforward; integration touches many systems
- User timezone must be configurable (not assumed from server timezone)
- Pattern detection needs minimum 2 weeks of data to be meaningful
- Be careful with proactive behavior — users may find unsolicited reminders annoying
- This feature enhances v2-03 (Memory Prioritization) and v2-04 (Prediction Engine)
