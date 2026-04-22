---
title: "[AUDIT-M4] `requiresEscalation` without recorded violation yields empty reason"
labels: ["bug", "audit-finding", "medium", "ux", "autonomous"]
milestone: "v2.2 - Stability & Reliability"
severity: medium
category: ux
effort: small
priority: P2
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-M4).

## Описание

Когда restricted-инструмент триггерит `requiresEscalation`, но violation не записан, fallback сообщение эскалации — дженерик `"Requires confirmation"`. Реальная причина эскалации (какой именно инструмент, какой лимит) скрыта от пользователя.

## Местоположение

- `src/autonomous/loop.ts:192-201`
- `src/autonomous/policy-engine.ts:117-123`

## Влияние

Пользователь не понимает, что именно он подтверждает, и не может принять осознанное решение. Ухудшает human-in-the-loop UX.

## Предложенное исправление

Всегда пушить информативный violation при `requiresEscalation`:

```ts
if (restrictedTools.includes(action.tool)) {
  violations.push({
    type: "restricted-tool",
    severity: "info",
    message: `Tool "${action.tool}" is restricted and requires user confirmation`,
    context: { tool: action.tool, args: action.args },
  });
  requiresEscalation = true;
}
```

Сообщение в `notify()` формировать из конкретных violations, не из fallback.

## Критерии приёмки

- [ ] При любом `requiresEscalation` есть минимум один violation с понятным message.
- [ ] `notify()` формирует сообщение пользователю на основе violations, не fallback.
- [ ] Юнит-тест: эскалация на restricted-tool содержит имя инструмента в сообщении.
- [ ] Интеграция с AUDIT-H2 (escalations reach the user) — сообщения доставляются с реальной причиной.

## Оценка

**Effort:** small (≈ 2 часа).
**Priority:** P2 — next minor release.
