# Anomaly Detection

## Current State

The agent has basic error handling and retry logic in `src/agent/runtime.ts`. The analytics service tracks request metrics. The security center (`Security.tsx`) provides audit logging and rate limits. However, there is no automated detection of unusual behavior patterns, failure spikes, or security anomalies.

## Problem

- No automated alerting when error rates spike
- Cannot detect unusual usage patterns (potential abuse or compromised accounts)
- Failed tool executions go unnoticed unless manually reviewed
- Cost anomalies (unexpected token usage spikes) are not flagged
- No baseline of "normal" behavior to compare against

## What to Implement

### 1. Baseline Profiling
- **Metrics tracked**:
  - Requests per hour/day (volume)
  - Error rate (errors / total requests)
  - Average response latency
  - Token usage per request
  - Tool invocation distribution
  - Cost per hour/day
- **Baseline calculation**: Rolling 7-day moving average with standard deviation
- **Storage**: `anomaly_baselines (metric, mean, stddev, sample_count, period, updated_at)`

### 2. Anomaly Detection Engine
- **Algorithm**: Z-score based detection with configurable sensitivity
  - Anomaly if `|current - mean| > threshold * stddev`
  - Default threshold: 2.5 standard deviations
- **Detection types**:
  - **Volume spike**: Sudden increase in request count
  - **Error burst**: Error rate exceeds baseline
  - **Latency degradation**: Response times significantly slower
  - **Cost spike**: Token/cost usage jumps unexpectedly
  - **Behavioral anomaly**: Unusual tool usage pattern or new unseen patterns
- **Configurable**: `config.yaml` → `anomaly_detection.enabled: true`, `anomaly_detection.sensitivity: 2.5`

### 3. Alert System
- **Alert channels**:
  - In-app notifications (via existing notification center from PR #34)
  - Telegram message to admin chat
  - Webhook to external URL (Slack, PagerDuty, etc.)
- **Alert format**: Type, severity (warning/critical), metric name, current value, expected range, timestamp
- **Deduplication**: Same anomaly type is not re-alerted within a configurable cooldown (default: 15 minutes)

### 4. Anomaly API
- `GET /api/anomalies?period=24h&severity=critical` — list detected anomalies
- `GET /api/anomalies/baselines` — current baseline values for all metrics
- `POST /api/anomalies/:id/acknowledge` — mark anomaly as reviewed
- `GET /api/anomalies/stats` — detection statistics

### 5. Anomaly Dashboard
- **Location**: New section on Analytics page or standalone "Monitoring" page
- **Features**:
  - Timeline of detected anomalies with severity color coding
  - Baseline vs actual charts for each metric
  - Alert configuration panel
  - Acknowledged vs unacknowledged anomaly management

### Backend Architecture
- `src/services/anomaly-detector.ts` — baseline calculation and anomaly detection
- `src/services/alerting.ts` — multi-channel alert dispatch
- `src/webui/routes/anomalies.ts` — API endpoints

### Implementation Steps

1. Design `anomaly_baselines` and `anomaly_events` tables
2. Implement baseline profiling with rolling statistics
3. Implement Z-score anomaly detection engine
4. Create alert dispatch system with deduplication
5. Integrate with existing notification center
6. Add Telegram and webhook alert channels
7. Create anomaly API endpoints
8. Build anomaly dashboard UI
9. Add configuration options

### Files to Modify
- `src/services/` — new anomaly detection and alerting services
- `src/services/analytics.ts` — feed metrics into anomaly detector
- `src/agent/runtime.ts` — report metrics to detector on each request
- `src/webui/routes/` — add anomaly endpoints
- `web/src/pages/Analytics.tsx` — add anomaly section
- `config.example.yaml` — add anomaly detection config

### Notes
- **Medium complexity** — Z-score detection is simple; multi-channel alerting is the complex part
- Needs a warm-up period (7+ days of data) before baselines are meaningful
- False positives are annoying — start with high thresholds and let users tune down
- Consider time-of-day normalization (weekend vs weekday baselines)
- Integrate with the Security Center for security-specific anomalies
