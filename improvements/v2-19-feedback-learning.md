# Feedback Learning System

## Current State

The agent has no mechanism to learn from user feedback. When a user corrects the agent, provides positive reinforcement, or expresses dissatisfaction, this information is not captured or used to improve future interactions. The self-correcting loop (v2-10) handles within-session corrections, but there is no cross-session learning.

## Problem

- Agent makes the same mistakes repeatedly across sessions
- Positive feedback is not reinforced — good patterns are not strengthened
- No mechanism to capture implicit feedback (user edits agent output, retries with different phrasing)
- Cannot adapt behavior based on accumulated user preferences
- No feedback data for prompt optimization or model fine-tuning

## What to Implement

### 1. Feedback Capture
- **Explicit feedback**:
  - Thumbs up/down buttons on agent responses
  - Text feedback field ("What could be better?")
  - Rating scale (1-5) for response quality
  - "This was helpful" / "This was not helpful" quick actions
- **Implicit feedback signals**:
  - User rephrases the same question → previous response was unclear
  - User immediately asks a follow-up correction → response had errors
  - User accepts output without modification → response was good
  - User copies agent output → high value response
  - Response time before next message → processing/satisfaction indicator
- **Storage**: `feedback (id, session_id, message_id, type, rating, text, implicit_signals JSON, created_at)`

### 2. Feedback Analysis Engine
- **Pattern extraction**: Identify recurring feedback themes
  - "Agent is too verbose" → reduce response length
  - "Code examples don't work" → improve code generation prompts
  - "Wrong tool selection" → adjust tool selection heuristics
- **Sentiment tracking**: Aggregate satisfaction over time
- **Topic-feedback correlation**: Which topics get the most negative feedback?
- **Agent-feedback correlation**: If multi-agent (v2-07), which agent types perform best?

### 3. Learning Application
- **Prompt adjustment**: Feed feedback patterns into system prompt modifications
  - Negative patterns → add explicit instructions to avoid
  - Positive patterns → reinforce in prompts
- **Preference model**: Build user preference profile
  - Response length preference (concise vs. detailed)
  - Code style preference (commented vs. clean)
  - Interaction style (formal vs. casual)
- **Tool selection bias**: Adjust tool selection weights based on success feedback
- **Memory integration**: Store learned preferences in memory system (v2-01)

### 4. Feedback Loop Metrics
- **Tracked metrics**:
  - Overall satisfaction score (rolling average)
  - Improvement trend (is the agent getting better?)
  - Feedback coverage (what % of responses get feedback?)
  - Top improvement opportunities (most common negative themes)
- **Alerting**: Notify if satisfaction drops below threshold

### 5. Feedback UI
- **Location**: Inline on every agent response + dedicated Feedback page
- **Inline features**:
  - Thumbs up/down (minimal friction)
  - Expandable text feedback field
  - Quick-tag options (too long, too short, wrong, helpful)
- **Feedback dashboard**:
  - Satisfaction trend chart
  - Feedback theme word cloud or list
  - Most improved / most problematic areas
  - User preference profile summary
  - Export feedback data for external analysis

### 6. Feedback API
- `POST /api/feedback` — submit feedback for a response
- `GET /api/feedback?session=...&from=...&to=...` — query feedback history
- `GET /api/feedback/analytics` — feedback statistics and trends
- `GET /api/feedback/themes` — extracted feedback themes
- `GET /api/feedback/preferences` — current learned user preferences
- `PUT /api/feedback/preferences` — manually adjust preferences

### Backend Architecture
- `src/services/feedback/capture.ts` — feedback collection and implicit signal detection
- `src/services/feedback/analyzer.ts` — pattern extraction and sentiment analysis
- `src/services/feedback/learner.ts` — preference model and prompt adjustment
- `src/webui/routes/feedback.ts` — API endpoints

### Implementation Steps

1. Design feedback storage schema
2. Implement explicit feedback capture (thumbs up/down, text, rating)
3. Implement implicit feedback signal detection
4. Build feedback analysis engine with pattern extraction
5. Create user preference model
6. Implement prompt adjustment based on feedback patterns
7. Integrate tool selection bias from feedback
8. Create feedback API endpoints
9. Build inline feedback UI and feedback dashboard
10. Add satisfaction alerting

### Files to Modify
- `src/services/feedback/` — new directory for feedback system
- `src/agent/runtime.ts` — integrate feedback-based prompt adjustments
- `src/webui/routes/` — add feedback endpoints
- `web/src/components/` — inline feedback buttons, feedback dashboard
- `web/src/pages/` — new feedback analytics page or section
- `config.example.yaml` — add feedback system config

### Notes
- **High complexity** — implicit feedback detection and preference modeling are nuanced
- Start with explicit feedback (thumbs up/down) — it's simple and immediately valuable
- Implicit feedback signals need careful calibration to avoid false positives
- Feedback-driven prompt changes should be conservative — small, incremental adjustments
- Store raw feedback for potential future model fine-tuning
- Privacy: feedback data may contain sensitive information; respect retention policies
- This feature synergizes with v2-10 (Self-Correcting Loop) and v2-20 (Adaptive Prompting)
