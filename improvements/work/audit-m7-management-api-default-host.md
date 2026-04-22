---
title: "[AUDIT-M7] Setup writes `api.host = \"0.0.0.0\"` by default"
labels: ["audit-finding", "medium", "security", "webui", "setup"]
milestone: "v2.2 - Stability & Reliability"
severity: medium
category: security
effort: small
priority: P3
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-M7).

## Описание

Management API в сгенерированном setup-конфиге по умолчанию биндится на `0.0.0.0`, то есть слушает на всех интерфейсах (LAN, VPN, docker bridge). Admin-surface становится доступен неявно всему сегменту сети.

## Местоположение

`src/webui/routes/setup.ts:602`

## Влияние

Потенциальная экспозиция admin-эндпоинтов наружу без осознанного действия пользователя. Для small-office/home LAN и shared-docker это реальный вектор атаки.

## Предложенное исправление

1. Дефолт — `"127.0.0.1"`.
2. Отдельный чекбокс в setup-wizard "Expose management API on LAN" с явным предупреждением.
3. Логировать при старте warning, если `api.host !== "127.0.0.1"`.

## Критерии приёмки

- [ ] Дефолт `api.host = "127.0.0.1"` в generate-конфиге.
- [ ] Setup-wizard имеет опцию expose LAN с warning-ом.
- [ ] При старте WebUI логируется warning при не-localhost binding.
- [ ] Юнит-тест: дефолт-конфиг содержит 127.0.0.1.
- [ ] Документация по setup обновлена.

## Оценка

**Effort:** small (≈ 1–2 часа).
**Priority:** P3 — opportunistic.
