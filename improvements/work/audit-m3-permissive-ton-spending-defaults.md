---
title: "[AUDIT-M3] `DEFAULT_POLICY_CONFIG.tonSpending` defaults are permissive"
labels: ["audit-finding", "medium", "security", "autonomous", "config"]
milestone: "v2.2 - Stability & Reliability"
severity: medium
category: security
effort: small
priority: P3
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-M3).

## Описание

Дефолтные лимиты для автономной TON-траты агрессивны для кошелек-связанного агента:
- `perTask: 1 TON`
- `daily: 5 TON`
- `requireConfirmationAbove: 0.5 TON`

При типичных ценах 1 TON — это денежный риск, особенно для пользователей, которые не меняют дефолты.

## Местоположение

`src/autonomous/policy-engine.ts:28-33`

## Влияние

Пользователи, не читающие конфиг, подвержены относительно большим автоматическим тратам без подтверждения, если вдобавок сработали другие находки (например, AUDIT-C1 — restrictedTools не матчат).

## Предложенное исправление

1. Уменьшить дефолты на порядок:
   ```ts
   tonSpending: {
     perTask: 0.1,
     daily: 0.5,
     requireConfirmationAbove: 0.05,
   }
   ```
2. Документировать эти параметры в `config.example.yaml` с комментариями и безопасными vs. «агрессивными» пресетами.
3. Опционально: валидация конфига — предупреждать, если `perTask > 1 TON`.

## Критерии приёмки

- [ ] Дефолты `tonSpending` уменьшены до безопасных значений.
- [ ] `config.example.yaml` обновлён с комментариями.
- [ ] Юнит-тест `DEFAULT_POLICY_CONFIG.tonSpending` соответствует новым значениям.
- [ ] Changelog / migration note для пользователей, которые зависят от старых дефолтов.

## Оценка

**Effort:** small (≈ 1 час).
**Priority:** P3 — opportunistic.
