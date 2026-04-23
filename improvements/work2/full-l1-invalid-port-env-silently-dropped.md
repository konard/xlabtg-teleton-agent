---
title: "[AUDIT-FULL-L1] `loadConfig` silently drops invalid `TELETON_WEBUI_PORT`/`TELETON_API_PORT`"
labels: ["bug", "audit-finding-full", "low", "config"]
milestone: "v3.0 - Production Ready"
severity: low
category: config
effort: small
priority: P3
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-L1).

## Описание

Неверный port-env молча игнорируется — это несогласовано с `TELETON_TG_API_ID` (throws) и `TELETON_BASE_URL` (throws). В hardened-развёртываниях опечатка ведёт к тому, что агент биндится на неожиданный порт, а firewall-правило оператора не совпадает.

## Местоположение

- `src/config/loader.ts:142-168`.

## Влияние

Тихая рассогласованность сетевой конфигурации; затрудняет диагностику «агент слушает не на том порту».

## Предложенное исправление

Ввести `parseEnvPort(name, fallback)`, бросающий при unparseable / out-of-range значении. Использовать единообразно для `TELETON_WEBUI_PORT`, `TELETON_API_PORT` и других port-env.

## Критерии приёмки

- [ ] `parseEnvPort` с throw-ами заменяет молчаливые дефолты.
- [ ] Регрессионный тест: `TELETON_WEBUI_PORT=abc` → throws.
- [ ] Регрессионный тест: `TELETON_WEBUI_PORT=99999` → throws.
- [ ] Регрессионный тест: `TELETON_WEBUI_PORT=8080` → 8080.
- [ ] Существующие config-тесты проходят.

## Оценка

**Effort:** small (≈ 1 час).
**Priority:** P3 — opportunistic.
