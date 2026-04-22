---
title: "[AUDIT-M1] No global max-iteration safety cap in autonomous loop"
labels: ["bug", "audit-finding", "medium", "reliability", "autonomous"]
milestone: "v2.2 - Stability & Reliability"
severity: medium
category: reliability
effort: small
priority: P2
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-M1).

## Описание

Задача, созданная без `constraints.maxIterations`, не имеет жёсткой верхней границы итераций. Завершить её могут только:
- `evaluateSuccess` (self-reflection);
- policy engine (через rate-limits или эскалацию);
- ручной stop;
- uncertainty escalation.

При багах в reflection и отсутствии rate-limit триггеров цикл может выполняться бесконечно.

## Местоположение

- `src/autonomous/loop.ts:115` — заголовок `while`.
- `src/autonomous/policy-engine.ts:84-90` — проверка `maxIterations` только если она задана.

## Влияние

- Потенциально бесконечный цикл, расходующий API-кредиты и токены.
- В худшем случае — денежные траты (если policy не матчит TON-инструменты, см. AUDIT-C1).

## Предложенное исправление

Добавить в `AutonomousLoop.run()` жёсткий предохранитель:

```ts
const MAX_GLOBAL_ITERATIONS = 500;
// ...
if (iteration >= MAX_GLOBAL_ITERATIONS) {
  log.error({ taskId: task.id, iteration }, "hit global max-iteration safety cap");
  await deps.updateTaskStatus("failed", { error: "Global max-iteration cap exceeded" });
  return;
}
```

Значение вынести в константу или конфиг (`autonomous.globalMaxIterations`) для возможности тонкой настройки.

## Критерии приёмки

- [ ] В `AutonomousLoop.run()` есть проверка на `MAX_GLOBAL_ITERATIONS`.
- [ ] Константа вынесена и покрыта комментарием о назначении.
- [ ] Юнит-тест: задача без `constraints.maxIterations` не превышает global cap.
- [ ] Лог-строка чёткая, указывает на cap (не путается с обычным `maxIterations`).

## Оценка

**Effort:** small (≈ 1 час).
**Priority:** P2 — next minor release.
