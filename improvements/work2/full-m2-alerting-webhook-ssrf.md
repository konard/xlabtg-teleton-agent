---
title: "[AUDIT-FULL-M2] `AlertingService` webhook has no SSRF guard, no timeout, no body redaction"
labels: ["bug", "audit-finding-full", "medium", "security", "ssrf"]
milestone: "v3.0 - Production Ready"
severity: medium
category: security
effort: small
priority: P1
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-M2).

## Описание

`fetch(alerting.webhook_url, { method: "POST", body: <event> })` без allow-list схемы, без отсечения приватных IP-диапазонов, без таймаута. Оператор, указавший URL на `http://169.254.169.254/…`, `http://127.0.0.1:7778/v1/agent/stop` или `http://<internal-service>/…`, получает форвард anomaly-событий — классический SSRF, с вторичным потенциалом «остановить свой же агент».

## Местоположение

- `src/services/alerting.ts:114-132`.

## Влияние

Несанкционированное раскрытие внутренних событий (с потенциально секретной метаинформацией) через SSRF; возможность вызова внутренних ручек агента (например, `/v1/agent/stop`) через redirect-chaining.

## Предложенное исправление

1. Валидировать `webhook_url` при записи в конфиг: требовать `https:`, резолвить DNS и отвергать RFC-1918 / loopback / link-local.
2. Добавить 5-секундный `AbortController` на `fetch`.
3. Перед POST редактировать поля, похожие на секреты (`apiKey`, `authorization`, `token`, `mnemonic`).

## Критерии приёмки

- [ ] Валидация webhook URL на стадии записи конфига.
- [ ] `https:` обязателен (или `http://localhost` с явным флагом).
- [ ] Таймаут 5 с через `AbortController`.
- [ ] Редактирование секретов в теле события.
- [ ] Регрессионный тест: `http://169.254.169.254/` отклоняется.
- [ ] Регрессионный тест: тело с `apiKey` не содержит этого значения после redact.

## Оценка

**Effort:** small (≈ 3–4 часа).
**Priority:** P1 — до v3.0.
