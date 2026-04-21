# Self-Correcting Execution Loop

## Current State

The agent runtime (`src/agent/runtime.ts`) has basic retry logic for server errors (overloaded, internal server error, api_error, rate limits). However, retries are blind — the same request is repeated without analysis of why it failed. There is no mechanism for the agent to evaluate its own output quality, detect mistakes, and iteratively improve.

## Problem

- Retry logic is blind — same request repeated without adjustment
- Agent cannot detect when its output is wrong or low quality
- No self-evaluation or reflection step after generating a response
- Failed tool calls are retried identically, not adapted
- No iterative improvement loop for complex tasks
- Users must manually identify and correct agent mistakes

## What to Implement

### 1. Output Evaluation
- **Self-critique prompt**: After generating a response, optionally run a second LLM call to evaluate quality
- **Evaluation criteria**:
  - Completeness: Does the response address all parts of the request?
  - Correctness: Are facts, code, and reasoning accurate?
  - Tool usage: Were the right tools used? Did they return expected results?
  - Formatting: Does the output match the expected format?
- **Score**: 0.0–1.0 quality score with specific feedback

### 2. Correction Loop
- **Flow**: Generate → Evaluate → (if score < threshold) → Reflect → Regenerate
- **Reflection step**: Analyze what went wrong and create an explicit correction plan
- **Max iterations**: Configurable limit (default: 3) to prevent infinite loops
- **Escalation**: If max iterations reached without acceptable quality, flag for human review
- **Configurable**: `config.yaml` → `self_correction.enabled: true`, `self_correction.threshold: 0.7`

### 3. Tool Error Recovery
- **Error classification**: Categorize tool failures (auth error, timeout, invalid input, resource not found)
- **Recovery strategies per error type**:
  - Auth error → refresh credentials and retry
  - Timeout → retry with longer timeout or simpler parameters
  - Invalid input → analyze error message, adjust parameters
  - Resource not found → try alternative resources or inform user
- **Parameter adaptation**: Modify tool call parameters based on error feedback

### 4. Learning from Corrections
- **Correction log**: Store each correction cycle `(original, evaluation, corrected, improvement_delta)`
- **Pattern detection**: Identify recurring mistakes for the prediction engine (v2-04)
- **Prompt improvement**: Feed correction patterns into adaptive prompting (v2-20)
- **Storage**: `correction_logs (id, task_id, iteration, original_output, evaluation, corrected_output, score_delta, created_at)`

### 5. Correction Monitoring UI
- **Location**: Expandable section in session/task detail views
- **Features**:
  - Correction iteration timeline (attempt 1 → evaluation → attempt 2 → ...)
  - Side-by-side diff of original vs corrected output
  - Quality score trend per iteration
  - Tool error recovery log
  - "Skip correction" manual override button

### Backend Architecture
- `src/agent/self-correction/evaluator.ts` — output quality evaluation
- `src/agent/self-correction/reflector.ts` — mistake analysis and correction planning
- `src/agent/self-correction/recovery.ts` — tool error recovery strategies
- `src/agent/self-correction/logger.ts` — correction log storage and analysis

### Implementation Steps

1. Implement output evaluator with structured LLM critique
2. Build correction loop with configurable iterations and threshold
3. Implement reflection step that produces explicit correction instructions
4. Add tool error classification and recovery strategies
5. Create correction logging and storage
6. Integrate correction loop into `src/agent/runtime.ts`
7. Build correction monitoring UI components
8. Add configuration options for thresholds and limits

### Files to Modify
- `src/agent/self-correction/` — new directory for correction engine
- `src/agent/runtime.ts` — integrate correction loop after response generation
- `src/webui/routes/` — add correction log endpoints
- `web/src/pages/Sessions.tsx` — add correction detail view
- `web/src/pages/Tasks.tsx` — add correction indicators
- `config.example.yaml` — add self-correction config

### Notes
- **High complexity** — self-evaluation via LLM doubles (or triples) the cost per request
- Make correction optional and off-by-default for cost-sensitive deployments
- The evaluation LLM call should use a smaller/cheaper model if possible
- Avoid correction loops on simple queries — only activate for complex tasks
- Track correction rate as a metric: high correction rate suggests systemic prompt issues
- This feature synergizes with v2-19 (Feedback Learning) and v2-20 (Adaptive Prompting)
