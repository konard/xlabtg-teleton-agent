---
title: "[AUDIT-FULL-H6] Management API `/v1/agent/restart` has no concurrency lock"
labels: ["bug", "audit-finding-full", "high", "reliability", "api"]
milestone: "v3.0 - Production Ready"
severity: high
category: reliability
effort: small
priority: P1
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-H6).

## Описание

Обработчик проверяет `state === "starting" || state === "stopping"` один раз, затем запускает `(async () => { stop(); start(); })()` без мьютекса. Два клиента, выпустивших `/restart` в одну миллисекунду, оба видят `running`, оба проходят guard, и оба планируют параллельные `stop() → start()` циклы. Второй `stop()` исполняется, пока первый `start()` всё ещё поднимает БД, что приводит к `better-sqlite3: database is closed` или double-open.

## Местоположение

- `src/api/routes/agent.ts:11-35`.

## Влияние

Агент может остаться в `stopped`, тогда как API считает, что он `starting`. В автономном режиме чекпоинты могут писаться против наполовину инициализированного lifecycle.

## Предложенное исправление

Добавить `restartInFlight` флаг на module scope, либо выставить `lifecycle.restart()`, сериализующий внутренне. Возвращать `409 Conflict` на второй параллельный запрос.

## Критерии приёмки

- [ ] Параллельные запросы на `/v1/agent/restart` не приводят к двум одновременным циклам stop/start.
- [ ] Второй запрос получает `409 Conflict`.
- [ ] Регрессионный тест: 2 параллельных `POST /v1/agent/restart` → один 202, один 409.
- [ ] Существующие lifecycle-тесты проходят.

## Оценка

**Effort:** small (≈ 2–3 часа).
**Priority:** P1 — до v3.0.
