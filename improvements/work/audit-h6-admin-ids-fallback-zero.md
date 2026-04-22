---
title: "[AUDIT-H6] `admin_ids[0] ?? 0` silently escalates to non-existent user"
labels: ["bug", "audit-finding", "high", "security", "autonomous", "config"]
milestone: "v2.2 - Stability & Reliability"
severity: high
category: security
effort: small
priority: P2
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-H6).

## Описание

Когда `admin_ids` пустой, автономная задача стартует с `senderId = 0`. Некоторые инструменты проверяют `senderId` против `admin_ids` для гейта admin-only поведения; при `0` проверка беззвучно не проходит. Ошибки инструментов всплывают как общий "Tool execution failed", что затрудняет диагностику.

## Местоположение

- `src/autonomous/integration.ts:91`
  ```ts
  const adminSenderId = config.telegram.admin_ids[0] ?? 0;
  ```
- Аналогичный паттерн в `src/index.ts:839`, `src/index.ts:1436`.

## Влияние

- Admin-only инструменты никогда не срабатывают при пустом `admin_ids` — автономный режим выглядит сломанным без внятной ошибки.
- Логи / audit trail атрибутируют действия на user ID 0 — это реальный ID Telegram-бота самого себя, потенциальная коллизия.

## Предложенное исправление

1. Если `admin_ids` пустой — **отказать в старте** autonomous manager с чёткой ошибкой:
   ```ts
   if (config.telegram.admin_ids.length === 0) {
     throw new Error(
       "Cannot start autonomous manager: config.telegram.admin_ids is empty. " +
       "Autonomous tasks require at least one admin user for escalation."
     );
   }
   ```
2. Либо ввести явный маркер `"system"` в типе `senderId`, который инструменты обрабатывают иначе.
3. В пути heartbeat (`src/index.ts:839`) логировать warning вместо молчаливого пропуска.

## Критерии приёмки

- [ ] Autonomous manager отказывает в старте при пустом `admin_ids` с внятной ошибкой.
- [ ] `startAgent()` не падает молча: либо выбрасывает ошибку, либо не стартует autonomous-слой вовсе.
- [ ] Heartbeat логирует предупреждение вместо silent-skip.
- [ ] Юнит-тест: `createAutonomousManager` бросает ошибку при `admin_ids = []`.
- [ ] Юнит-тест: `createAutonomousManager` успешно стартует при `admin_ids = [123]`.
- [ ] Документация: требование непустого `admin_ids` явно указано.

## Оценка

**Effort:** small (≈ 2 часа).
**Priority:** P2 — next minor release.
