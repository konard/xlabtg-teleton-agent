---
title: "[AUDIT-H5] Unbounded `task_checkpoints` growth for active tasks"
labels: ["bug", "audit-finding", "high", "tech-debt", "autonomous", "storage"]
milestone: "v2.2 - Stability & Reliability"
severity: high
category: technical-debt
effort: small
priority: P2
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-H5).

## Описание

`saveCheckpoint` выполняется раз в итерацию и **не имеет per-task лимита**. `cleanOldCheckpoints()` (7-day TTL) **пропускает активные задачи** и никогда не вызывается автоматически.

## Местоположение

- `src/autonomous/loop.ts:306-320` — вызов `saveCheckpoint` каждый шаг.
- `src/memory/agent/autonomous-tasks.ts:359-368` — `cleanOldCheckpoints` с условием на статус.

## Влияние

Долгоживущие задачи накапливают десятки тысяч строк. `getLastCheckpoint` проиндексирован и остаётся быстрым, но:
- **backup / export** становятся медленными;
- **`listCheckpoints`** деградирует;
- **использование диска** непредсказуемо растёт.

## Предложенное исправление

1. Ввести параметр `keepLastN` (default 20) в `saveCheckpoint`. Удалять старые чекпоинты в той же транзакции:
   ```sql
   DELETE FROM task_checkpoints
   WHERE task_id = ?
     AND id NOT IN (
       SELECT id FROM task_checkpoints
       WHERE task_id = ?
       ORDER BY created_at DESC
       LIMIT ?
     );
   ```
2. Планировать `cleanOldCheckpoints()` из того же cron/interval, что и остальные retention jobs (`src/memory/retention.ts`).
3. Опционально: включить опцию `keepMilestonesEvery = 50` — оставлять каждый 50-й чекпоинт для долгосрочной истории.

## Критерии приёмки

- [ ] `saveCheckpoint` принимает `keepLastN` и удаляет старые в той же транзакции.
- [ ] `cleanOldCheckpoints()` запускается из retention jobs по расписанию.
- [ ] Юнит-тест: после 100 итераций в таблице ≤ `keepLastN + 1` строк для активной задачи.
- [ ] Юнит-тест: `getLastCheckpoint` по-прежнему возвращает самую свежую.
- [ ] Нет регрессий производительности в `saveCheckpoint` (транзакция + индекс).

## Оценка

**Effort:** small (≈ 3–5 часов).
**Priority:** P2 — next minor release.
