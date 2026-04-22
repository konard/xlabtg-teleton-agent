---
title: "[AUDIT-C3] Pause/resume resets rate-limits and loop-detection (policy bypass)"
labels: ["bug", "audit-finding", "critical", "security", "autonomous"]
milestone: "v2.2 - Stability & Reliability"
severity: critical
category: security
effort: medium
priority: P1
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-C3).

## Описание

`AutonomousTaskManager.runLoop()` конструирует **новый** `AutonomousLoop` как на старте, так и на resume (`new AutonomousLoop(...)` в line 85). Новый loop создаёт новый `PolicyEngine` с пустыми `toolCallTimestamps`, `apiCallTimestamps`, `recentActions`, `consecutiveUncertainCount` — ничто из этого не персистится.

В результате любая последовательность `pauseTask()` + `resumeTask()`:
- Обнуляет `toolCallTimestamps` / `apiCallTimestamps` → лимиты `rateLimit.toolCallsPerHour` и `apiCallsPerMinute` сбрасываются.
- Обнуляет `recentActions` → детектор цикла `loopDetection.maxIdenticalActions` сбрасывается.
- Обнуляет `consecutiveUncertainCount` → эскалация по неопределённости сбрасывается.

## Местоположение

- `src/autonomous/manager.ts:84-126` — `runLoop()` создаёт новый `AutonomousLoop` на каждый запуск/resume.
- `src/autonomous/loop.ts:68-80` — конструктор `AutonomousLoop` создаёт свежий `PolicyEngine`.

## Влияние

- Пользователь или баг в вызывающем коде может обойти лимит **100 вызовов/час** и детектор 5-идентичных-действий скриптованием pause/resume.
- На практике это также отключает эскалатор неопределённости — застрявший агент может продолжать жечь API-кредиты.
- Security-чувствительная находка: это целенаправленный байпас policy engine, которая отвечает за безопасность автономного режима.

## Предложенное исправление

1. Персистить состояние rate-limit в новую таблицу `policy_state` (ключ `task_id`) или инлайнить в `task_checkpoints.state`.
2. В `runLoop()` на resume гидрировать `PolicyEngine` из хранилища вместо конструирования с нуля.
3. Добавить тест: N пауз/резюмов между двумя батчами вызовов инструментов — лимит всё ещё срабатывает.
4. Также сохранять `recentActions` и `consecutiveUncertainCount`, либо проксировать их через БД.

## Критерии приёмки

- [ ] Создана миграция / схема для таблицы `policy_state` (или выбран альтернативный подход с инлайнингом в checkpoints).
- [ ] `PolicyEngine` гидрируется из хранилища на resume; новое состояние персистится при любом `record*` вызове.
- [ ] Юнит-тест: 10 циклов pause/resume не сбрасывают `toolCallsPerHour`.
- [ ] Юнит-тест: детектор идентичных действий сохраняется через pause/resume.
- [ ] Юнит-тест: `consecutiveUncertainCount` не обнуляется.
- [ ] Регрессионный интеграционный тест в `src/autonomous/__tests__/`.

## Оценка

**Effort:** medium (≈ 1 день, включая миграцию и тесты).
**Priority:** P1 — fix before re-enabling autonomous wallet mode.
