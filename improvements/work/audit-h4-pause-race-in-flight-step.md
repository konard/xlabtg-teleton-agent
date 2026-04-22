---
title: "[AUDIT-H4] Race between `pauseTask()` and in-flight loop's `.finally`"
labels: ["bug", "audit-finding", "high", "reliability", "autonomous", "race-condition"]
milestone: "v2.2 - Stability & Reliability"
severity: high
category: reliability
effort: medium
priority: P2
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-H4).

## Описание

`pauseTask()` вызывает `loop.stop()`, удаляет запись из map'а и записывает `updateTaskStatus("paused")`. При этом `.then/.catch/.finally` на `loop.run(task)` выполняется **позже**: если текущий awaited-шаг (`executeTool` или `selfReflect`) резолвится или бросает исключение раньше, чем loop увидит `abortController.aborted`, loop всё ещё может вызвать `updateTaskStatus("failed", { error })` (`loop.ts:150`) — **после** того, как pause уже записал `paused`. Аналогично, если шаг успешно завершается и loop проходит проверку аборта в начале while-цикла, он выполняет ещё один полный цикл.

## Местоположение

- `src/autonomous/manager.ts:84-118` — `pauseTask()` и гонка с `.finally`.
- `src/autonomous/loop.ts:150` — безусловный `updateTaskStatus("failed", { error })` в catch.
- `src/autonomous/loop.ts:115` — проверка aborted только в заголовке while.

## Влияние

- Задача в статусе `paused` может быть перезаписана в `failed` из-за отложенного `.finally` — путает пользователя и тесты.
- Задача может молчаливо продолжать выполнение ещё одной итерации после pause.
- Особенно заметно в тестах, вызывающих pause сразу после start.

## Предложенное исправление

1. Гейтить переходы статуса в `loop.run()` чтением текущего статуса из БД перед каждым `updateTaskStatus`: не перезаписывать `paused` или `cancelled`.
   ```ts
   const current = await deps.getTaskStatus(task.id);
   if (current === "paused" || current === "cancelled") return;
   await deps.updateTaskStatus("failed", { error });
   ```
2. Проверять `abortController.signal.aborted` **сразу после каждого `await`** внутри loop, а не только в заголовке while.
3. Добавить вспомогательный `throwIfAborted()` и вызывать его после каждого `await`.

## Критерии приёмки

- [ ] Переходы статуса в `loop.run()` защищены чтением текущего статуса.
- [ ] После каждого `await` в loop есть проверка `aborted`.
- [ ] Юнит-тест: `pauseTask()` вызывается в момент in-flight `executeTool` → статус остаётся `paused`, не `failed`.
- [ ] Юнит-тест: `pauseTask()` вызывается сразу после start → задача не выполняет ни одной полной итерации после pause.
- [ ] Регрессионный тест с искусственной задержкой (mock) в `executeTool`.

## Оценка

**Effort:** medium (≈ 1 день с тестами).
**Priority:** P2 — next minor release.
