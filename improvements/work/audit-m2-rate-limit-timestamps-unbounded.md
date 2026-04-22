---
title: "[AUDIT-M2] Rate-limit timestamps only pruned during `checkAction()`"
labels: ["bug", "audit-finding", "medium", "reliability", "autonomous", "memory-leak"]
milestone: "v2.2 - Stability & Reliability"
severity: medium
category: reliability
effort: small
priority: P2
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-M2).

## Описание

`recordToolCall()` / `recordApiCall()` добавляют timestamp в массив **без границ**. Фильтрация (удаление старых записей) выполняется только на следующем `checkAction()`. Между вызовами `checkAction` массив может неограниченно расти.

## Местоположение

- `src/autonomous/policy-engine.ts:142-156` — `recordToolCall`.
- `src/autonomous/policy-engine.ts:179-185` — `recordApiCall`.

## Влияние

Утечка памяти, пропорциональная количеству вызовов между `checkAction`. Для долгоживущих задач с низкой частотой проверок — заметный рост RAM.

## Предложенное исправление

Вариант A: прунить в `record*`:
```ts
recordToolCall(): void {
  const now = Date.now();
  this.toolCallTimestamps.push(now);
  this.toolCallTimestamps = this.toolCallTimestamps.filter(
    (t) => now - t < HOUR_MS
  );
}
```

Вариант B: ограничить по длине (ring buffer / slice).

Вариант C: использовать `deque` (две очереди) или `RingBuffer` из utils, если он есть.

## Критерии приёмки

- [ ] Массивы `toolCallTimestamps` / `apiCallTimestamps` не превышают разумного размера (например, 2 × rate-limit cap) между проверками.
- [ ] Функциональность rate-limit не изменилась (все существующие юнит-тесты проходят).
- [ ] Юнит-тест: после 10 000 `recordToolCall` без вызова `checkAction` размер массива ограничен.

## Оценка

**Effort:** small (≈ 1 час).
**Priority:** P2 — next minor release.
