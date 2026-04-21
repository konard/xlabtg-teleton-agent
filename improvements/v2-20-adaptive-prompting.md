# Adaptive Prompting Engine

## Current State

The Soul Editor allows manual editing of system prompts stored as markdown files. Prompts are static — once written, they don't change based on performance or user feedback. The existing template system (PR #42) provides starting points, but there is no optimization loop that improves prompts over time.

## Problem

- Prompts are static and manually maintained
- No data-driven optimization of prompt effectiveness
- A/B testing of different prompts requires manual setup
- Cannot adapt prompts to individual user communication styles
- Performance variations across prompt versions are not measured
- Soul file changes are trial-and-error with no metrics

## What to Implement

### 1. Prompt Variant Management
- **Variant system**: Multiple versions of each prompt section, tracked with metrics
- **Storage**: `prompt_variants (id, section, version, content, active, metrics JSON, created_at)`
- **Sections**: System prompt can be split into independently optimizable sections:
  - Persona / role definition
  - Instructions / guidelines
  - Tool usage guidance
  - Response format rules
  - Safety guardrails
- **Activation**: One active variant per section, rest are candidates

### 2. A/B Testing Framework
- **Experiment definition**: Compare variant A vs. B for a section over N interactions
- **Traffic splitting**: Configurable percentage split (e.g., 80/20 existing/new)
- **Metrics tracked per variant**:
  - User satisfaction (from v2-19 feedback)
  - Task success rate
  - Response quality score (from v2-10 self-evaluation)
  - Token usage efficiency
  - Error rate
- **Statistical significance**: Minimum sample size before declaring a winner
- **Auto-promotion**: Winning variant automatically becomes the active version

### 3. AI-Powered Prompt Optimization
- **Optimization pipeline**:
  1. Collect performance metrics for current prompt
  2. Analyze failure patterns and low-scoring responses
  3. Generate improved prompt variant using LLM meta-prompting
  4. Validate variant against test cases
  5. Deploy as A/B test candidate
- **Meta-prompting**: Use an LLM to analyze prompt weaknesses and suggest improvements
- **Guard rails**: Generated variants must pass safety validation before deployment

### 4. Context-Adaptive Prompts
- **Dynamic sections**: Prompt sections that change based on context:
  - User experience level → adjust explanation depth
  - Conversation topic → activate domain-specific instructions
  - Time of day → adjust formality level
  - Feedback history → avoid known user pet peeves
- **Template variables**: `{user_preference_style}`, `{current_context}`, `{active_tools}`
- **Integration**: Pull context from memory (v2-01), feedback (v2-19), temporal engine (v2-11)

### 5. Prompt Optimization UI
- **Location**: Enhance Soul Editor page
- **Features**:
  - Variant manager: list, create, activate, deactivate variants
  - A/B test dashboard: experiment status, metrics comparison, significance indicators
  - Performance history per section: how each section has improved over time
  - AI optimization panel: "Suggest improvement" button with preview and deploy
  - Prompt diff viewer: compare variants side-by-side
  - Test case manager: define inputs and expected outputs for validation

### 6. Adaptive Prompting API
- `GET /api/prompts/sections` — list prompt sections with active variants
- `GET /api/prompts/sections/:section/variants` — list variants for a section
- `POST /api/prompts/sections/:section/variants` — create new variant
- `PUT /api/prompts/sections/:section/variants/:id/activate` — activate a variant
- `POST /api/prompts/experiments` — create A/B test experiment
- `GET /api/prompts/experiments/:id` — experiment status and metrics
- `POST /api/prompts/optimize` — trigger AI optimization for a section
- `GET /api/prompts/performance` — overall prompt performance metrics

### Backend Architecture
- `src/services/prompts/variant-manager.ts` — variant CRUD and activation
- `src/services/prompts/ab-testing.ts` — experiment management and traffic splitting
- `src/services/prompts/optimizer.ts` — AI-powered prompt generation and validation
- `src/services/prompts/context-adapter.ts` — dynamic context injection
- `src/webui/routes/prompts.ts` — API endpoints

### Implementation Steps

1. Design prompt variant and experiment schemas
2. Implement variant manager with activation logic
3. Build A/B testing framework with traffic splitting
4. Integrate metric collection from feedback and self-evaluation systems
5. Implement statistical significance calculation
6. Build AI-powered prompt optimization pipeline
7. Implement context-adaptive prompt assembly
8. Create prompt optimization API endpoints
9. Build Soul Editor UI enhancements (variant manager, A/B dashboard)
10. Add auto-promotion logic for winning variants

### Files to Modify
- `src/services/prompts/` — new directory for prompt optimization
- `src/soul/` — integrate variant system with soul file loading
- `src/agent/runtime.ts` — use adaptive prompt assembly
- `src/webui/routes/` — add prompt optimization endpoints
- `web/src/pages/Soul.tsx` — add variant manager and optimization UI
- `config.example.yaml` — add prompt optimization config

### Notes
- **Very High complexity** — A/B testing infrastructure and AI optimization are substantial
- Start with manual variant management before adding AI optimization
- A/B testing requires sufficient traffic volume — may not be viable for low-usage deployments
- Safety guardrails are critical — AI-generated prompts must be reviewed before production use
- Prompt optimization is a feedback loop: feedback → analysis → variant → test → promote
- Depends on v2-19 (Feedback Learning) for quality metrics and v2-10 (Self-Correcting) for evaluation
