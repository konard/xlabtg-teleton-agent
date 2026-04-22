---
title: "[AUDIT-L4] `maxParallelTasks` overflow throws instead of queuing"
labels: ["audit-finding", "low", "ux", "autonomous"]
milestone: "v2.2 - Stability & Reliability"
severity: low
category: ux
effort: medium
priority: P3
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-L4).

## Описание

Одиннадцатая параллельная задача (при дефолтном `maxParallelTasks = 10`) отклоняется с ошибкой. UX ожидает либо очередь, либо информативный отказ; сейчас это просто `throw`, и пользователь теряет задачу.

## Местоположение

`src/autonomous/manager.ts:58-64`

## Влияние

Пользователь теряет задачу без внятного фидбэка. Для workflow-сценариев с пачкой задач — отсекаются все сверх лимита.

## Предложенное исправление

Вариант A: простая FIFO-очередь, дренируемая в `.finally` `runLoop`:
```ts
private queue: Task[] = [];
// ...
if (this.runningLoops.size >= this.maxParallelTasks) {
  this.queue.push(task);
  return;
}
// runLoop(...)
this.runLoop(task).finally(() => {
  const next = this.queue.shift();
  if (next) this.runLoop(next);
});
```

Вариант B: вернуть пользователю ошибку с чётким message и `Retry-After`.

Предпочтителен A — сохраняет работу.

## Критерии приёмки

- [ ] 11-я задача не выбрасывает ошибку, а ставится в очередь.
- [ ] По завершении любой задачи автоматически стартует следующая из очереди.
- [ ] Юнит-тест: 15 задач создаются, все 15 в итоге выполняются.
- [ ] Лимит одновременной параллельности соблюдается (никогда > `maxParallelTasks` в runningLoops).
- [ ] WebUI показывает задачу в статусе `queued`.

## Оценка

**Effort:** medium (≈ 4–6 часов, с тестами и UI).
**Priority:** P3 — opportunistic.
