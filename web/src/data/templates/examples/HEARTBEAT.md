---
name: "HEARTBEAT.md Example"
description: "Minimal working example for HEARTBEAT.md"
category: "example"
---
# Heartbeat

This file defines the agent's periodic background tasks and health checks.

## Schedule

| Task | Interval | Description |
|------|----------|-------------|
| Status check | Every 5 minutes | Verify all connected services are reachable |
| Memory sync | Every 30 minutes | Flush new memory entries to persistent storage |
| Log rotation | Daily at 00:00 UTC | Archive logs older than 7 days |

## Health Checks

On each heartbeat, verify:
- [ ] API endpoint is responsive (< 2s latency)
- [ ] No critical errors in the last interval
- [ ] Memory usage within acceptable bounds

## Alert Conditions

Trigger an alert if:
- Any health check fails twice in a row.
- An unhandled exception occurs.
- A task takes more than 3× its expected duration.

## On Alert

1. Log the full error with timestamp and context.
2. Notify the configured channel (see settings).
3. Attempt one automatic recovery; if it fails, pause and wait for human review.
