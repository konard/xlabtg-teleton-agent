---
title: "[AUDIT-M5] Escalated/paused tasks have no auto-timeout"
labels: ["audit-finding", "medium", "ux", "autonomous"]
milestone: "v2.2 - Stability & Reliability"
severity: medium
category: ux
effort: small
priority: P3
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-M5).

## Описание

Если пользователь никогда не возобновляет эскалированную задачу, она бесконечно висит в статусе `paused`. Это не ломает runtime (`runningLoops` не занимает слот после pause), но БД-строка остаётся `paused` навсегда и копится мусор.

## Местоположение

`src/autonomous/loop.ts:197-209`

## Влияние

- Засорение таблицы `autonomous_tasks`.
- Путаница пользователя при массовых эскалациях (непонятно, что это, пока не почистишь вручную).

## Предложенное исправление

1. Добавить `pausedAt` timestamp при паузе.
2. В retention-job (`src/memory/retention.ts`) авто-отменять задачи с `pausedAt < now - 24h` со статусом `cancelled` и reason `"timeout-paused"`.
3. Значение TTL вынести в конфиг (`autonomous.pauseTimeoutHours`, default 24).

## Критерии приёмки

- [ ] В схеме `autonomous_tasks` есть поле `paused_at` (миграция).
- [ ] `pauseTask()` / policy-эскалация проставляют `paused_at = now()`.
- [ ] Retention-job авто-отменяет задачи, зависшие в pause дольше TTL.
- [ ] Юнит-тест: задача с `paused_at` > TTL авто-отменяется.
- [ ] Юнит-тест: задача с `paused_at` < TTL остаётся.
- [ ] Конфиг-опция `autonomous.pauseTimeoutHours` задокументирована.

## Оценка

**Effort:** small (≈ 3–4 часа с миграцией).
**Priority:** P3 — opportunistic.
