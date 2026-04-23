---
title: "[AUDIT-FULL-M7] `WorkflowScheduler.tick()` has no per-workflow dedupe; slow workflows duplicate"
labels: ["bug", "audit-finding-full", "medium", "reliability", "financial", "scheduler"]
milestone: "v3.0 - Production Ready"
severity: medium
category: reliability
effort: small
priority: P2
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-M7).

## Описание

`setInterval(..., 60_000)` дёргает `tick()` вне зависимости от того, закончили ли работу workflow-ы предыдущего tick-а. Workflow с `execute > 60 с` инвокируется на следующем tick-е. `cronMatches` сравнивает `getUTCMinutes()`, поэтому два tick-а в одной минуте могут оба выстрелить для `* * * * *`.

## Местоположение

- `src/services/workflow-scheduler.ts:73-84,86-95`.

## Влияние

Дубликаты TON-переводов для любого cron-workflow, включающего `ton_send`; дубликаты уведомлений; «заcтрявшие» webhook-и с двойным вызовом.

## Предложенное исправление

Отслеживать `runningWorkflowIds: Set<string>` и `lastFiredBucket = Math.floor(Date.now() / 60_000)`; скипать дубли в обоих измерениях. Персистить `last-fired` в БД, чтобы рестарты не ре-файрили пропущенные cron-ы.

## Критерии приёмки

- [ ] `runningWorkflowIds` отслеживает запущенные workflow-ы.
- [ ] `lastFiredBucket` блокирует дубли в ту же минуту.
- [ ] `last_fired` персистится в БД.
- [ ] Регрессионный тест: workflow с `execute > 60s` выполняется ровно один раз в отрезок.
- [ ] Регрессионный тест: `* * * * *` не удваивается при совпадении tick-ов.

## Оценка

**Effort:** small (≈ 3–4 часа).
**Priority:** P2 — next maintenance.
