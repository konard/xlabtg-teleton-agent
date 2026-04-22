---
title: "[AUDIT-H1] `JSON.parse` in `rowTo*` has no try/catch — one bad row DoSes listing"
labels: ["bug", "audit-finding", "high", "reliability", "autonomous"]
milestone: "v2.2 - Stability & Reliability"
severity: high
category: reliability
effort: small
priority: P1
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-H1).

## Описание

В `rowToTask`, `rowToCheckpoint`, `rowToLogEntry` десять+ вызовов `JSON.parse(...)` без `try/catch`. Одна строка с некорректным JSON (ручная правка БД, падение при записи, баг бэкфилла) бросает исключение из `listTasks` / `getTask` / `getExecutionLogs` и полностью ломает страницу `/api/autonomous`.

## Местоположение

- `src/memory/agent/autonomous-tasks.ts:119-163` — 7 вызовов `JSON.parse` в `rowToTask`.
- `src/memory/agent/autonomous-tasks.ts` — 2 вызова в `rowToCheckpoint`.
- `src/memory/agent/autonomous-tasks.ts` — 1 вызов в `rowToLogEntry`.

## Влияние

Одна corrupt-строка в БД **DoSит** всю autonomous-панель. Диагностика проблемы требует прямого запроса в SQLite (у пользователя нет пути в UI, чтобы увидеть, что именно сломалось).

## Предложенное исправление

Ввести helper:

```ts
function safeJSONParse<T>(value: unknown, fallback: T, context?: Record<string, unknown>): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (err) {
    log.warn({ err, context, value: value.slice(0, 200) }, "failed to parse JSON column, using fallback");
    return fallback;
  }
}
```

Использовать его во всех `rowTo*` с дефолтами `{}`, `[]` или `undefined` в зависимости от поля. Логировать предупреждение с `taskId` / `checkpointId` для диагностики, но продолжать работу.

Опционально: добавить эндпоинт / CLI-команду, которая сканирует таблицу и помечает сломанные строки (`is_corrupted = 1`), чтобы admin мог их удалить.

## Критерии приёмки

- [ ] Все `JSON.parse` в `rowTo*` обёрнуты в `safeJSONParse` с безопасным фоллбэком.
- [ ] Юнит-тест: таблица с одной corrupt-строкой → `listTasks` возвращает **все остальные строки** и логирует warning, а не падает.
- [ ] Юнит-тест: `rowToTask` на corrupt `metadata` возвращает fallback `{}`.
- [ ] Юнит-тест: `rowToCheckpoint` на corrupt `state` возвращает fallback `{}`.
- [ ] Лог-строка содержит `taskId` для диагностики.

## Оценка

**Effort:** small (≈ 2–4 часа).
**Priority:** P1 — fix before re-enabling autonomous wallet mode.
