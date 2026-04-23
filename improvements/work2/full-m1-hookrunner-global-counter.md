---
title: "[AUDIT-FULL-M1] `HookRunner.hookDepth` is a single process-global counter; unrelated concurrent events are skipped"
labels: ["bug", "audit-finding-full", "medium", "reliability", "hooks"]
milestone: "v3.0 - Production Ready"
severity: medium
category: reliability
effort: small
priority: P1
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-M1).

## Описание

`createHookRunner` хранит `let hookDepth = 0`. Каждое обращение `runModifyingHook`/`runObservingHook` инкрементирует тот же счётчик. Пока одна async-hook ждёт, второе несвязанное событие входит в runner, видит `hookDepth > 0` и целиком скипается как «реентрант». Пользовательски-видимый эффект — silent hook-starvation; для security-хуков приоритета `-100` «skipped» означает, что проверка не запустилась.

## Местоположение

- `src/sdk/hooks/runner.ts:34-80`.

## Влияние

Даже при умеренной конкуренции (долгий tool-call + входящее Telegram-сообщение) hook-enforced инварианты — rate-limit, prompt-фильтрация, routing провайдеров — можно обойти для второго конкурентного события.

## Предложенное исправление

Отслеживать реентранси per-event-context через `AsyncLocalStorage` либо привязывать `__hookDepth` к самому объекту события. Глобальный счётчик оставить только для истинной синхронной реентранси.

## Критерии приёмки

- [ ] `hookDepth` считается per-context через `AsyncLocalStorage`.
- [ ] Конкурентные события больше не «съедают» друг друга.
- [ ] Регрессионный тест: два одновременных async hook-вызова — оба отрабатывают security-хук `-100` полностью.
- [ ] Существующие hook-тесты проходят.

## Оценка

**Effort:** small (≈ 3–4 часа).
**Priority:** P1 — до v3.0.
