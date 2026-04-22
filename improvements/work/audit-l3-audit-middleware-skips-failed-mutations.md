---
title: "[AUDIT-L3] Audit middleware skips failed (4xx/5xx) mutations"
labels: ["audit-finding", "low", "security", "webui", "audit-log"]
milestone: "v2.2 - Stability & Reliability"
severity: low
category: security
effort: small
priority: P3
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-L3).

## Описание

Audit-middleware пропускает 4xx/5xx мутации (заблокированные записи, ошибки валидации). Злоумышленник, зондирующий запрещённые эндпоинты, **не оставляет следов** — проблема для forensics и IDS.

## Местоположение

`src/webui/middleware/audit.ts:70-74`

## Влияние

Отсутствие записи неудачных попыток мутаций: нельзя расследовать брут-форс, нельзя настраивать алерты по частоте отказов.

## Предложенное исправление

Логировать **все** мутации (POST/PUT/PATCH/DELETE), независимо от итогового статуса. В самом audit-событии указывать `status` и `error`, чтобы читатель мог отличить успешные и неудачные.

```ts
await audit.log({
  actor,
  method,
  path,
  status: res.statusCode,
  error: res.statusCode >= 400 ? responseBody : undefined,
  ts: new Date(),
});
```

## Критерии приёмки

- [ ] Audit-middleware записывает все мутации, включая 4xx/5xx.
- [ ] Поле `status` в audit-событии корректно.
- [ ] Юнит-тест: 403 на PUT записывается в audit log.
- [ ] Юнит-тест: 500 на POST записывается с error.

## Оценка

**Effort:** small (≈ 1 час).
**Priority:** P3 — opportunistic.
