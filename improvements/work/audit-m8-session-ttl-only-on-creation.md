---
title: "[AUDIT-M8] Setup Telegram sessions validate TTL only on creation"
labels: ["bug", "audit-finding", "medium", "security", "webui", "setup"]
milestone: "v2.2 - Stability & Reliability"
severity: medium
category: security
effort: small
priority: P3
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-M8).

## Описание

`getSession()` проверяет TTL, но некоторые request-handler'ы читают сессию напрямую, минуя `getSession()` — в итоге expired-сессия живёт до тех пор, пока не отработает `setTimeout` очистки.

## Местоположение

`src/webui/setup-auth.ts:463-469`

## Влияние

Окно, в котором expired-сессия может быть использована — зависит от таймера очистки. В худшем случае (taймер был задержан event loop'ом) это минуты.

## Предложенное исправление

Роутить **все** обращения к сессии через `getSession()`, который уже валидирует TTL. Найти и исправить места, которые читают `sessions.get(id)` напрямую.

Дополнительно: добавить ESLint-правило или комментарий, запрещающий прямой доступ к map-у sessions.

## Критерии приёмки

- [ ] Все handler'ы читают сессию через `getSession()`.
- [ ] `sessions.get(...)` напрямую вызывается только внутри `getSession`.
- [ ] Юнит-тест: expired-сессия не возвращается `getSession`.
- [ ] Юнит-тест: handler'ы с expired-сессией отвечают 401.
- [ ] Опционально: lint-правило или eslint-disable barrier.

## Оценка

**Effort:** small (≈ 1–2 часа).
**Priority:** P3 — opportunistic.
