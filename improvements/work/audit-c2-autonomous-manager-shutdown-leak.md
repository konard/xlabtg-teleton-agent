---
title: "[AUDIT-C2] `AutonomousTaskManager` is never stopped on agent shutdown"
labels: ["bug", "audit-finding", "critical", "reliability", "autonomous"]
milestone: "v2.2 - Stability & Reliability"
severity: critical
category: reliability
effort: small
priority: P1
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-C2).

## Описание

`autonomousManager` объявлен как **локальная переменная внутри `startAgent()`**, передаётся в `WebUIServer` / `ApiServer`, после чего выходит из области видимости. В `stopAgent()` нет ссылки на менеджера и `stopAll()` никогда не вызывается.

В результате запущенные автономные циклы продолжают выполнять LLM-вызовы, вызовы инструментов и запись в SQLite **после того, как `agent.stop()` завершился** — а именно этот путь выполняется по SIGTERM.

## Местоположение

- `src/index.ts:333-414` — объявление `autonomousManager` как локальной переменной в `startAgent()`.
- `src/index.ts:1487-1583` — `stopAgent()` останавливает heartbeat, workflow scheduler, plugin watcher, bridge, но **не** autonomousManager.

## Влияние

- При shutdown in-flight шаги гонятся с закрытием БД и могут бросать `SqliteError: database is closed`.
- WebUI-сценарий "stop agent" + "start agent": старые циклы продолжают выполняться на старом DB-хендле, создаётся новый менеджер → **дублирование работы и порча состояния задач**.
- SIGTERM для автономных задач фактически работает как kill — чекпоинты могут быть записаны не полностью.

## Предложенное исправление

1. Сделать менеджера полем инстанса:
   ```ts
   private autonomousManager: AutonomousTaskManager | null = null;
   ```
2. В `stopAgent()`, перед `bridge.disconnect()`, добавить:
   ```ts
   if (this.autonomousManager) {
     this.autonomousManager.stopAll();
     this.autonomousManager = null;
   }
   ```
3. Опционально: `stopAllAndWait()` helper, возвращающий promise, который резолвится, когда `runningLoops` опустели (все `.finally` отработали).

## Критерии приёмки

- [ ] `autonomousManager` — поле инстанса (не локальная переменная).
- [ ] `stopAgent()` гарантированно вызывает `stopAll()` и (опционально) дожидается завершения циклов.
- [ ] Интеграционный тест: запуск агента → создание автономной задачи → `agent.stop()` → в логах нет `database is closed` и никаких записей после `stopAgent` завершился.
- [ ] Проверка на сценарии restart: stop + start не оставляет старых циклов в памяти.
- [ ] Добавлен регрессионный тест.

## Оценка

**Effort:** small (≈ 2–4 часа).
**Priority:** P1 — fix before re-enabling autonomous wallet mode.
