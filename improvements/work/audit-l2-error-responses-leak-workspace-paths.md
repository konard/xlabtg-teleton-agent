---
title: "[AUDIT-L2] Error responses leak workspace absolute paths"
labels: ["audit-finding", "low", "security", "webui"]
milestone: "v2.2 - Stability & Reliability"
severity: low
category: security
effort: small
priority: P3
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-L2).

## Описание

`WorkspaceSecurityError` в `src/webui/routes/workspace.ts:116` включает `inputPath` в message. Этот message возвращается клиенту в теле 403/404, раскрывая абсолютные пути на сервере.

## Местоположение

`src/webui/routes/workspace.ts:116`

## Влияние

Утечка информации о файловой системе сервера: абсолютные пути, имена пользователей в `/home/<user>/...`, структура проекта. Полезно атакующему для следующих этапов.

## Предложенное исправление

1. Возвращать клиенту дженерик-сообщение: `"Workspace path is not allowed"`.
2. Логировать детали (`inputPath`, `resolvedPath`, `allowedRoot`) на сервере с соответствующим уровнем (`warn`).

```ts
log.warn({ inputPath, resolvedPath }, "workspace path rejected");
return res.status(403).json({ error: "Workspace path is not allowed" });
```

## Критерии приёмки

- [ ] Клиент получает дженерик-сообщение без абсолютных путей.
- [ ] Сервер логирует детали.
- [ ] Юнит-тест: ответ API не содержит подстрок `/home/`, `/tmp/`, `C:\`.

## Оценка

**Effort:** small (≈ 1 час).
**Priority:** P3 — opportunistic.
