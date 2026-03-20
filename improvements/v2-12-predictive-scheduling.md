# Predictive Scheduling

## Current State

Tasks in the system are created and executed on-demand. The heartbeat mechanism (`HEARTBEAT.md` soul file) provides basic periodic behavior, but there is no intelligent task scheduling. Users must manually initiate all tasks, and there is no understanding of optimal timing or workload distribution.

## Problem

- All tasks are manual — no automatic scheduling based on patterns
- No workload balancing across time (tasks pile up during peak hours)
- Recurring tasks must be manually triggered each time
- No awareness of optimal execution windows (low-load periods)
- Cannot schedule tasks based on predicted user needs

## What to Implement

### 1. Smart Task Scheduler
- **Scheduling modes**:
  - **Cron-based**: Traditional cron expressions for fixed schedules
  - **Pattern-based**: Schedule based on detected time patterns from v2-11
  - **Predictive**: Automatically schedule tasks the user is predicted to request (v2-04)
  - **Adaptive**: Shift non-urgent tasks to low-load windows
- **Storage**: `scheduled_tasks (id, name, description, schedule_type, schedule_config JSON, agent_id, next_run, last_run, status, created_at)`

### 2. Workload Optimization
- **Load analysis**: Track agent utilization over time (requests per minute, queue depth)
- **Off-peak detection**: Identify periods with low activity
- **Task shifting**: Non-urgent scheduled tasks automatically move to off-peak windows
- **Priority levels**: Critical (run at exact time), Normal (±1 hour flexibility), Low (any off-peak)

### 3. Recurring Task Templates
- **Pre-built templates**:
  - Daily status summary
  - Weekly activity report
  - Database cleanup and optimization
  - Health check and monitoring
  - Log rotation and archival
- **Custom templates**: Users define their own recurring tasks with parameters
- **Template parameters**: Variable substitution (dates, counts, dynamic values)

### 4. Scheduling API
- `GET /api/schedule` — list all scheduled tasks with next run times
- `POST /api/schedule` — create a new scheduled task
- `PUT /api/schedule/:id` — update schedule
- `DELETE /api/schedule/:id` — remove scheduled task
- `POST /api/schedule/:id/run-now` — trigger immediate execution
- `GET /api/schedule/:id/history` — execution history for a scheduled task
- `GET /api/schedule/calendar?month=2026-03` — calendar view of upcoming tasks

### 5. Scheduling UI
- **Location**: New "Schedule" tab on Tasks page or standalone page
- **Features**:
  - Calendar view showing scheduled task distribution
  - Task scheduling wizard with template selection
  - Cron expression builder (visual, no manual cron syntax needed)
  - Workload heatmap showing busy vs. free periods
  - Drag-and-drop rescheduling on calendar
  - Execution history with success/failure indicators

### Backend Architecture
- `src/services/scheduler.ts` — scheduling engine with cron and adaptive modes
- `src/services/workload.ts` — load analysis and off-peak detection
- `src/webui/routes/schedule.ts` — API endpoints

### Implementation Steps

1. Design scheduled_tasks and schedule_history tables
2. Implement cron-based scheduler using existing timer infrastructure
3. Implement workload analysis and off-peak detection
4. Build adaptive scheduling that shifts tasks to low-load windows
5. Create recurring task templates
6. Integrate with prediction engine (v2-04) for predictive scheduling
7. Create scheduling API endpoints
8. Build calendar UI and scheduling wizard
9. Add schedule monitoring and alerting

### Files to Modify
- `src/services/` — new scheduler and workload services
- `src/agent/runtime.ts` — integrate scheduled task execution
- `src/webui/routes/` — add schedule endpoints
- `web/src/pages/Tasks.tsx` — add schedule tab
- `web/src/components/` — calendar, cron builder, schedule wizard
- `config.example.yaml` — add scheduling config

### Notes
- **High complexity** — adaptive scheduling and workload optimization require careful tuning
- Start with simple cron-based scheduling, then add adaptive/predictive features
- Cron expression builder UI avoids the need for users to learn cron syntax
- Be conservative with predictive scheduling — wrong predictions waste resources
- Scheduled tasks should respect the same security and audit trail as manual tasks
- Depends on v2-04 (Prediction Engine) and v2-11 (Temporal Context) for advanced features
