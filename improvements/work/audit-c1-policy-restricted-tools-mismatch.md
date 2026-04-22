---
title: "[AUDIT-C1] Policy `restrictedTools` list does not match any real tool name"
labels: ["bug", "audit-finding", "critical", "security", "autonomous"]
milestone: "v2.2 - Stability & Reliability"
severity: critical
category: security
effort: small
priority: P1
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-C1).

## Описание

`DEFAULT_POLICY_CONFIG.restrictedTools` перечисляет имена инструментов в формате `"wallet:send"`, `"contract:deploy"`, `"system:exec"` — такие имена **не существуют** в реестре инструментов. Реальные TON-инструменты регистрируются в snake_case: `ton_send`, `jetton_send`, `exec`.

В результате проверка `PolicyEngine.checkAction()` никогда не матчит ни один реальный инструмент из этого списка и **никогда не устанавливает `requiresEscalation`** для TON-переводов.

## Местоположение

- `src/autonomous/policy-engine.ts:34`
  ```ts
  restrictedTools: ["wallet:send", "contract:deploy", "system:exec"],
  ```
- Реальные имена инструментов:
  - `src/agent/tools/ton/send.ts:16` → `name: "ton_send"`
  - `src/agent/tools/ton/jetton-send.ts:22` → `name: "jetton_send"`

## Влияние

- Автономные задачи могут вызывать `ton_send` / `jetton_send` **без подтверждения пользователя** до лимита `constraints.budgetTON` (по умолчанию `1 TON/task`, `5 TON/day`).
- Полностью обходится предусмотренный архитектурой human-in-the-loop safeguard для реальных денежных переводов.
- Это находка с **наивысшим влиянием** — проект работает с реальными средствами в TON.

## Предложенное исправление

1. Заменить дефолт на реальные имена инструментов:
   ```ts
   restrictedTools: ["ton_send", "jetton_send", "exec", "exec_run"],
   ```
2. Добавить регрессионный тест в `src/autonomous/__tests__/policy-engine.test.ts`, утверждающий, что вызов `ton_send` триггерит `requiresEscalation`.
3. Долгосрочно: ввести категории инструментов (например, `tool.category = "wallet_write"`) и матчить в policy engine по категории, а не точному имени. Это предотвратит регрессию при переименованиях.

## Критерии приёмки

- [ ] Исправлена корневая причина — в `DEFAULT_POLICY_CONFIG.restrictedTools` указаны реально зарегистрированные имена инструментов.
- [ ] Добавлен регрессионный юнит-тест, проверяющий, что `ton_send` и `jetton_send` триггерят эскалацию.
- [ ] Интеграционный тест: автономная задача, пытающаяся вызвать `ton_send`, пауза → эскалация, задача переходит в статус `paused` с `requiresEscalation = true`.
- [ ] Обновлена документация (если есть) со списком дефолтных ограниченных инструментов.
- [ ] Проверен lint/type-check; существующие тесты не сломаны.

## Оценка

**Effort:** small (≈ 2–4 часа).
**Priority:** P1 — fix before re-enabling autonomous wallet mode.
